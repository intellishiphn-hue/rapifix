import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  col, computeQuote, convertQuoteSchema, formatMoney, newVersionSchema, orderCol, quoteCol, recordDecisionSchema, saveQuoteSchema, sendQuoteSchema,
  type Role, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { buildPortal, buildQuotePortal } from "../lib/portal";
import { applyDecision } from "../lib/quoteDecision";
import { insertWorkOrder } from "../lib/orders";
import { secureToken } from "../lib/token";

const DESK: Role[] = ["admin", "manager", "reception"];
/** Estados en los que enviar una cotización mueve la orden a "Cotización enviada". */
const PRE_APPROVAL: WorkOrderStatus[] = ["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE", "QUOTE_SENT", "AWAITING_APPROVAL"];

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
  let ctx: Record<string, unknown>;
  if (input.orderId) {
    const order = await db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`).get();
    if (!order.exists) throw new HttpsError("not-found", "La orden no existe.");
    if (!order.get("isOpen")) throw new HttpsError("failed-precondition", "La orden está cerrada.");
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
    const q = await ref.get();
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
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
    if (pre.get("status") !== "draft") throw new HttpsError("failed-precondition", "Esta cotización ya fue enviada.");
    const validUntil = Timestamp.fromMillis(Date.now() + (pre.get("validDays") as number) * 86400000);
    await quoteRef.update({ status: "sent", sentAt: FieldValue.serverTimestamp(), validUntil, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const token = await buildQuotePortal(tid, quoteRef.id);
    return { orderId: null, token };
  }

  const result = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    if (q.get("status") !== "draft") throw new HttpsError("failed-precondition", "Esta cotización ya fue enviada.");
    const orderRef = db.doc(`${orderCol.workOrders(tid)}/${q.get("orderId")}`);
    const order = await tx.get(orderRef);
    if (!order.exists || !order.get("isOpen")) throw new HttpsError("failed-precondition", "La orden no existe o está cerrada.");

    const validUntil = Timestamp.fromMillis(Date.now() + (q.get("validDays") as number) * 86400000);
    tx.update(quoteRef, { status: "sent", sentAt: FieldValue.serverTimestamp(), validUntil, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });

    const totals = q.get("totals");
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

/** Crea una nueva versión editable a partir de una cotización enviada (la anterior expira). */
export const newQuoteVersion = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(newVersionSchema, request.data);
  const tid = caller.tid;
  const oldRef = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);
  const newRef = db.collection(quoteCol.quotes(tid)).doc();
  await db.runTransaction(async (tx) => {
    const q = await tx.get(oldRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    const d = q.data()!;
    if (d.status === "draft") throw new HttpsError("failed-precondition", "El borrador ya se puede editar.");
    if (d.status === "approved") throw new HttpsError("failed-precondition", "Esta cotización ya fue aprobada por el cliente y no se puede volver a enviar.");
    if (["sent", "viewed"].includes(d.status)) tx.update(oldRef, { status: "expired", updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    const now = FieldValue.serverTimestamp();
    tx.set(newRef, {
      ...d,
      version: (d.version ?? 1) + 1,
      status: "draft",
      validUntil: null,
      sentAt: null,
      viewedAt: null,
      decision: null,
      questions: [],
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    });
  });
  return { quoteId: newRef.id };
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
  await buildPortal(tid, orderId);
  return { orderId, code };
});
