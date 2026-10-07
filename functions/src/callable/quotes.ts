import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  col, computeQuote, convertQuoteSchema, diffQuotes, discardRevisionSchema, formatMoney, newVersionSchema, OPEN_QUOTE_STATUSES, orderCol, quoteCol, recordDecisionSchema, saveQuoteSchema, sendQuoteSchema,
  type Role, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import type { DiffItem, QuoteStatus, Totals } from "@rapifix/shared";
import { actorName } from "../lib/actors";
import { buildPortal, buildQuotePortal } from "../lib/portal";
import { applyDecision } from "../lib/quoteDecision";
import { insertWorkOrder } from "../lib/orders";
import { secureToken } from "../lib/token";

const DESK: Role[] = ["admin", "manager", "reception"];
/** Estados en los que enviar una cotización mueve la orden a "Cotización enviada". */
const PRE_APPROVAL: WorkOrderStatus[] = ["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE", "QUOTE_SENT", "AWAITING_APPROVAL"];

const versionLabel = (d: FirebaseFirestore.DocumentData) => `${d.code}${(d.version ?? 1) > 1 ? ` v${d.version}` : ""}`;
const isOpenQuote = (status: unknown) => OPEN_QUOTE_STATUSES.includes(status as QuoteStatus);

/**
 * ¿Se puede trabajar la cotización de esta orden?
 * Orden abierta: recepción, gerencia y administración. Orden entregada o cerrada: solo se permite
 * MODIFICAR la cotización aprobada, y solo gerencia o administración. Cancelada: nunca.
 */
function assertOrderEditable(order: FirebaseFirestore.DocumentSnapshot, role: Role, isRevision: boolean) {
  if (!order.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (order.get("isOpen")) return;
  if (order.get("status") === "CANCELLED") throw new HttpsError("failed-precondition", "La orden está cancelada: su cotización ya no se puede cambiar.");
  if (!isRevision) throw new HttpsError("failed-precondition", "La orden está cerrada.");
  if (role !== "admin" && role !== "manager") {
    throw new HttpsError("permission-denied", "La orden ya fue entregada: solo gerencia o administración pueden modificar su cotización.");
  }
}

/** Crea o actualiza el borrador de cotización de una orden. Los totales los calcula el servidor. */
export const saveQuote = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(saveQuoteSchema, request.data);
  const tid = caller.tid;
  const settings = await db.doc(`${col.settings(tid)}/general`).get();
  const taxRate = Number(settings.get("taxRate") ?? 15);
  const { items, totals } = computeQuote(input.items, taxRate);
  const now = FieldValue.serverTimestamp();

  // Contexto: orden existente o cotización directa (vehículo sin orden)
  const existing = input.quoteId ? await db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`).get() : null;
  if (existing && !existing.exists) throw new HttpsError("not-found", "La cotización no existe.");
  let ctx: Record<string, unknown>;
  if (input.orderId) {
    const order = await db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`).get();
    assertOrderEditable(order, caller.role, !!existing?.get("revisionOf"));
    const o = order.data()!;
    ctx = {
      source: "order", orderId: input.orderId, orderCode: o.code, vehicleId: o.vehicleId, customerId: o.customerId,
      customerName: o.customer.fullName, customerPhone: o.customer.whatsapp || o.customer.phone,
      vehicleLabel: `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year}`, plate: o.vehicle.plate, technicianIds: o.technicianIds ?? [],
    };
  } else {
    if (!input.vehicleId) throw new HttpsError("invalid-argument", "Seleccione el vehículo.");
    const vehicle = await db.doc(`${col.vehicles(tid)}/${input.vehicleId}`).get();
    if (!vehicle.exists) throw new HttpsError("not-found", "El vehículo no existe.");
    const v = vehicle.data()!;
    const customer = await db.doc(`${col.customers(tid)}/${v.customerId}`).get();
    if (!customer.exists) throw new HttpsError("not-found", "El cliente no existe.");
    const c = customer.data()!;
    ctx = {
      source: "direct", orderId: null, orderCode: null, vehicleId: input.vehicleId, customerId: v.customerId,
      customerName: c.fullName, customerPhone: c.whatsapp || c.phone,
      vehicleLabel: `${v.make} ${v.model} ${v.year}`, plate: v.plate, technicianIds: [],
    };
  }

  if (input.quoteId) {
    const ref = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);
    const q = existing!;
    if ((q.get("orderId") ?? null) !== (ctx.orderId ?? null)) throw new HttpsError("failed-precondition", "La cotización pertenece a otra orden.");
    if (q.get("status") !== "draft") throw new HttpsError("failed-precondition", "Solo se puede editar un borrador. Cree una nueva versión.");
    await ref.update({ ...ctx, items, totals, taxRate, notes: input.notes, validDays: input.validDays, updatedAt: now, updatedBy: caller.uid });
    return { quoteId: ref.id };
  }

  const prefix = (settings.get("quotePrefix") as string) || "COT";
  const counterRef = db.doc(`${col.counters(tid)}/quotes`);
  const ref = db.collection(quoteCol.quotes(tid)).doc();
  await db.runTransaction(async (tx) => {
    const c = await tx.get(counterRef);
    const number = (c.exists ? (c.get("next") as number) : 1) || 1;
    tx.set(counterRef, { next: number + 1 }, { merge: true });
    tx.set(ref, {
      ...ctx,
      number,
      code: `${prefix}-${String(number).padStart(4, "0")}`,
      version: 1,
      publicToken: ctx.orderId ? null : secureToken(),
      status: "draft",
      items, taxRate, totals,
      notes: input.notes, validDays: input.validDays,
      validUntil: null, sentAt: null, viewedAt: null, decision: null, questions: [],
      createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid,
    });
  });
  return { quoteId: ref.id };
});

/** Envía la cotización al cliente: se congela, se publica en el portal y la orden avanza. */
export const sendQuote = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(sendQuoteSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);

  // Cotización directa (sin orden): se congela y se publica en su propio link
  const pre = await quoteRef.get();
  if (!pre.exists) throw new HttpsError("not-found", "La cotización no existe.");
  if (!pre.get("orderId")) {
    await db.runTransaction(async (tx) => {
      const q = await tx.get(quoteRef);
      if (q.get("status") !== "draft") throw new HttpsError("failed-precondition", "Esta cotización ya fue enviada.");
      const baseId = (q.get("revisionOf") as string | null) ?? null;
      if (baseId) {
        const base = await tx.get(db.doc(`${quoteCol.quotes(tid)}/${baseId}`));
        assertRevisionSendable(base, q);
      }
      const validUntil = Timestamp.fromMillis(Date.now() + (q.get("validDays") as number) * 86400000);
      tx.update(quoteRef, { status: "sent", sentAt: FieldValue.serverTimestamp(), validUntil, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    });
    const token = await buildQuotePortal(tid, quoteRef.id);
    return { orderId: null, token };
  }

  const result = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    if (q.get("status") !== "draft") throw new HttpsError("failed-precondition", "Esta cotización ya fue enviada.");
    const orderRef = db.doc(`${orderCol.workOrders(tid)}/${q.get("orderId")}`);
    const order = await tx.get(orderRef);
    if (!order.exists) throw new HttpsError("failed-precondition", "La orden no existe o está cerrada.");

    // ¿Es una modificación de una cotización ya aprobada? (por su marca, o porque la orden ya tiene otra aprobada vigente)
    const activeId = (order.get("activeQuoteId") as string | null) ?? null;
    const baseId = (q.get("revisionOf") as string | null) ?? (activeId && activeId !== quoteRef.id ? activeId : null);
    const base = baseId ? await tx.get(db.doc(`${quoteCol.quotes(tid)}/${baseId}`)) : null;
    const isRevision = !!q.get("revisionOf") || (!!base?.exists && base.get("status") === "approved");
    assertOrderEditable(order, caller.role, isRevision);

    const validUntil = Timestamp.fromMillis(Date.now() + (q.get("validDays") as number) * 86400000);
    const sent = { status: "sent", sentAt: FieldValue.serverTimestamp(), validUntil, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
    const totals = q.get("totals");

    if (isRevision && base) {
      // La aprobada sigue vigente: la orden (total, saldo, estado) NO cambia hasta que el cliente apruebe.
      assertRevisionSendable(base, q);
      tx.update(quoteRef, q.get("revisionOf") ? sent : { ...sent, revisionOf: base.id, revisionReason: "Cambios en la cotización", revisionBy: caller.uid, revisionByName: name });
      if (!base.get("openRevisionId")) tx.update(base.ref, { openRevisionId: quoteRef.id });
      tx.set(orderRef.collection("events").doc(), {
        type: "section",
        text: `Actualización de cotización ${versionLabel(q.data()!)} enviada: nuevo total ${formatMoney(totals.total)} (antes ${formatMoney((base.get("totals") as Totals).total)})`,
        visibleToCustomer: true, channels: [], fromStatus: null, toStatus: null,
        actorId: caller.uid, actorName: name, at: FieldValue.serverTimestamp(),
      });
      return { orderId: orderRef.id };
    }

    tx.update(quoteRef, sent);
    const paid = (order.get("paid") as number) ?? 0;
    const from = order.get("status") as WorkOrderStatus;
    const update: Record<string, unknown> = {
      activeQuoteId: quoteRef.id,
      totals,
      balance: totals.total - paid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    };
    if (PRE_APPROVAL.includes(from) && from !== "QUOTE_SENT") {
      update.status = "QUOTE_SENT";
      update.statusChangedAt = FieldValue.serverTimestamp();
      update.statusChangedBy = caller.uid;
    }
    tx.update(orderRef, update);
    tx.set(orderRef.collection("events").doc(), {
      type: "section",
      text: `Cotización ${q.get("code")} enviada por ${formatMoney(totals.total)}`,
      visibleToCustomer: true,
      channels: [],
      fromStatus: update.status ? from : null,
      toStatus: update.status ?? null,
      actorId: caller.uid,
      actorName: name,
      at: FieldValue.serverTimestamp(),
    });
    return { orderId: orderRef.id };
  });

  const token = await buildPortal(tid, result.orderId);
  return { ...result, token };
});

/** Una modificación solo se puede enviar si su cotización aprobada sigue vigente y de verdad cambia algo. */
function assertRevisionSendable(base: FirebaseFirestore.DocumentSnapshot, q: FirebaseFirestore.DocumentSnapshot) {
  if (!base.exists || base.get("status") !== "approved") {
    throw new HttpsError("failed-precondition", "La cotización que se quería modificar ya no está vigente. Descarte esta modificación y cree una nueva.");
  }
  const d = diffQuotes(
    { items: base.get("items") as DiffItem[], totals: base.get("totals") as Totals },
    { items: q.get("items") as DiffItem[], totals: q.get("totals") as Totals },
  );
  if (!d.hasChanges) throw new HttpsError("failed-precondition", "La modificación no tiene cambios respecto a la cotización aprobada.");
}

/**
 * Crea una nueva versión editable.
 * - De una cotización enviada sin aprobar: la anterior expira (como siempre).
 * - De una cotización APROBADA: abre una "modificación". La aprobada sigue vigente (orden, saldo, cobros)
 *   hasta que el cliente apruebe la nueva; solo puede haber una modificación abierta a la vez.
 */
export const newQuoteVersion = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(newVersionSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const quotes = db.collection(quoteCol.quotes(tid));
  const oldRef = quotes.doc(input.quoteId);
  const newRef = quotes.doc();
  const res = await db.runTransaction(async (tx) => {
    const q = await tx.get(oldRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    const d = q.data()!;
    if (d.status === "draft") throw new HttpsError("failed-precondition", "El borrador ya se puede editar.");
    if (d.status === "superseded") throw new HttpsError("failed-precondition", "Esta versión ya fue reemplazada. Modifique la cotización aprobada vigente.");

    const orderRef = d.orderId ? db.doc(`${orderCol.workOrders(tid)}/${d.orderId}`) : null;
    const order = orderRef ? await tx.get(orderRef) : null;

    // Cotización aprobada sobre la que se trabaja (si la hay)
    let base: FirebaseFirestore.DocumentSnapshot | null = null;
    if (d.status === "approved") base = q;
    else if (d.revisionOf) {
      base = await tx.get(quotes.doc(d.revisionOf as string));
      if (!base.exists || base.get("status") !== "approved") {
        throw new HttpsError("failed-precondition", "La cotización que se modificaba ya no está vigente. Modifique la cotización aprobada actual.");
      }
    } else if (order?.exists) {
      const activeId = order.get("activeQuoteId") as string | null;
      if (activeId && activeId !== oldRef.id) {
        const active = await tx.get(quotes.doc(activeId));
        if (active.exists && active.get("status") === "approved") base = active;
      }
    }
    if (order && base) assertOrderEditable(order, caller.role, true);

    let reason: string | null = null;
    if (base) {
      reason = (input.reason?.trim() || (d.status !== "approved" ? String(d.revisionReason ?? "") : "")).slice(0, 300);
      if (reason.length < 3) throw new HttpsError("invalid-argument", "Escriba el motivo de la modificación.");
      // Una sola modificación abierta: si ya hay una, se devuelve esa
      const openId = base.get("openRevisionId") as string | null;
      if (openId && openId !== oldRef.id) {
        const open = await tx.get(quotes.doc(openId));
        if (open.exists && isOpenQuote(open.get("status"))) return { quoteId: openId, existing: true, rebuild: null };
      }
    }
    const siblings = d.number != null ? await tx.get(quotes.where("number", "==", d.number)) : null;
    const version = Math.max(d.version ?? 1, ...(siblings?.docs.map((s) => Number(s.get("version") ?? 1)) ?? [])) + 1;

    const wasOpen = ["sent", "viewed"].includes(d.status);
    if (wasOpen) tx.update(oldRef, { status: "expired", updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const now = FieldValue.serverTimestamp();
    tx.set(newRef, {
      ...d,
      version,
      status: "draft",
      validUntil: null,
      sentAt: null,
      viewedAt: null,
      decision: null,
      questions: [],
      revisionOf: base?.id ?? null,
      revisionReason: reason,
      revisionBy: base ? caller.uid : null,
      revisionByName: base ? name : null,
      openRevisionId: null,
      supersededBy: null,
      supersededAt: null,
      discardedAt: null,
      discardedByName: null,
      discardReason: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    });
    if (base) {
      tx.update(base.ref, { openRevisionId: newRef.id });
      if (orderRef && order?.exists) {
        tx.set(orderRef.collection("events").doc(), {
          type: "note",
          text: `Se abrió una modificación de la cotización ${d.code} v${version}. Motivo: ${reason}`,
          visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null,
          actorId: caller.uid, actorName: name, at: FieldValue.serverTimestamp(),
        });
      }
    }
    // Si la modificación anterior ya estaba en el link del cliente, hay que quitarla de ahí
    return { quoteId: newRef.id, existing: false, rebuild: base && wasOpen ? { orderId: (d.orderId as string | null) ?? null, baseId: base.id } : null };
  });
  if (res.rebuild) {
    if (res.rebuild.orderId) await buildPortal(tid, res.rebuild.orderId);
    else await buildQuotePortal(tid, res.rebuild.baseId);
  }
  return { quoteId: res.quoteId, existing: res.existing };
});

/** Descarta una modificación abierta (borrador o enviada). La cotización aprobada sigue vigente. */
export const discardQuoteRevision = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(discardRevisionSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const quotes = db.collection(quoteCol.quotes(tid));
  const ref = quotes.doc(input.quoteId);
  const res = await db.runTransaction(async (tx) => {
    const q = await tx.get(ref);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    const d = q.data()!;
    if (!d.revisionOf) throw new HttpsError("failed-precondition", "Esta cotización no es una modificación de una aprobada.");
    if (!isOpenQuote(d.status)) throw new HttpsError("failed-precondition", "Esta modificación ya fue respondida o descartada.");
    const base = await tx.get(quotes.doc(d.revisionOf as string));
    const orderRef = d.orderId ? db.doc(`${orderCol.workOrders(tid)}/${d.orderId}`) : null;
    const order = orderRef ? await tx.get(orderRef) : null;
    if (order?.exists && !order.get("isOpen") && caller.role !== "admin" && caller.role !== "manager") {
      throw new HttpsError("permission-denied", "La orden ya fue entregada: solo gerencia o administración pueden cambiar su cotización.");
    }
    const reason = input.reason?.trim() ?? "";
    tx.update(ref, {
      status: "expired", discardedAt: FieldValue.serverTimestamp(), discardedBy: caller.uid, discardedByName: name, discardReason: reason,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    if (base.exists && base.get("openRevisionId") === ref.id) tx.update(base.ref, { openRevisionId: null });
    if (orderRef && order?.exists) {
      tx.set(orderRef.collection("events").doc(), {
        type: "note",
        text: `Se descartó la modificación ${versionLabel(d)}; sigue vigente la cotización aprobada${reason ? `. Motivo: ${reason}` : ""}`,
        visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null,
        actorId: caller.uid, actorName: name, at: FieldValue.serverTimestamp(),
      });
    }
    return { orderId: (d.orderId as string | null) ?? null, baseId: d.revisionOf as string };
  });
  if (res.orderId) await buildPortal(tid, res.orderId);
  else await buildQuotePortal(tid, res.baseId);
  return { ok: true };
});

/** Devuelve (y construye si hace falta) el link del portal de una orden. */
export const ensurePortal = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "reception", "technician", "warehouse", "seller"]);
  const orderId = String((request.data as { orderId?: string })?.orderId ?? "");
  if (!orderId) throw new HttpsError("invalid-argument", "Falta la orden.");
  const token = await buildPortal(caller.tid, orderId);
  if (!token) throw new HttpsError("not-found", "La orden no existe.");
  return { token };
});

/** El taller registra la aprobación o rechazo del cliente (por teléfono, en persona o WhatsApp). */
export const recordQuoteDecision = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(recordDecisionSchema, request.data);
  const staffName = await actorName(caller.uid, caller.email);
  const q = await db.doc(`${quoteCol.quotes(caller.tid)}/${input.quoteId}`).get();
  if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
  return applyDecision(caller.tid, input.quoteId, {
    approved: input.action === "approve",
    name: input.name?.trim() || (q.get("customerName") as string) || "Cliente",
    comment: input.comment?.trim() ?? "",
    channel: input.channel,
    ip: null,
    userAgent: null,
    recordedBy: caller.uid,
    recordedByName: staffName,
  });
});

/**
 * Convierte una cotización directa aprobada en orden de trabajo cuando llega el vehículo.
 * La orden nace en "Aprobado" con los totales de la cotización y conserva el mismo link del cliente.
 */
export const convertQuoteToOrder = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(convertQuoteSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);
  const q = await quoteRef.get();
  if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
  if (q.get("orderId")) throw new HttpsError("already-exists", `Esta cotización ya tiene la orden ${q.get("orderCode")}.`);
  if (q.get("status") === "superseded") throw new HttpsError("failed-precondition", "Esta versión fue reemplazada por una más reciente. Convierta la cotización aprobada vigente.");
  if (q.get("status") !== "approved") throw new HttpsError("failed-precondition", "Primero registre la aprobación del cliente.");
  const vehicleId = q.get("vehicleId") as string | undefined;
  if (!vehicleId) throw new HttpsError("failed-precondition", "La cotización no tiene vehículo.");

  const { orderId, code } = await insertWorkOrder(caller, name, {
    vehicleId,
    reason: input.reason,
    type: input.type,
    priority: input.priority,
    technicianIds: input.technicianIds,
    promisedAt: input.promisedAt,
    reception: input.reception,
    status: "APPROVED",
    portalToken: (q.get("publicToken") as string | null) ?? undefined,
    fromQuote: { id: quoteRef.id, code: q.get("code") as string, totals: q.get("totals") },
  });
  await quoteRef.update({ orderId, orderCode: code, source: "direct", updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  // Si tenía una modificación abierta, pasa a la orden junto con la aprobada
  const openId = q.get("openRevisionId") as string | null;
  if (openId) {
    const open = await db.doc(`${quoteCol.quotes(tid)}/${openId}`).get();
    if (open.exists && isOpenQuote(open.get("status"))) await open.ref.update({ orderId, orderCode: code, source: "direct", updatedAt: FieldValue.serverTimestamp() });
  }
  await buildPortal(tid, orderId);
  return { orderId, code };
});
