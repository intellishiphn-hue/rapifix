import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  col, computeQuote, formatMoney, newVersionSchema, orderCol, quoteCol, saveQuoteSchema, sendQuoteSchema,
  type Role, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { buildPortal } from "../lib/portal";

const DESK: Role[] = ["admin", "manager", "reception"];
/** Estados en los que enviar una cotización mueve la orden a "Cotización enviada". */
const PRE_APPROVAL: WorkOrderStatus[] = ["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE", "QUOTE_SENT", "AWAITING_APPROVAL"];

/** Crea o actualiza el borrador de cotización de una orden. Los totales los calcula el servidor. */
export const saveQuote = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(saveQuoteSchema, request.data);
  const tid = caller.tid;
  const orderRef = db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`);
  const order = await orderRef.get();
  if (!order.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (!order.get("isOpen")) throw new HttpsError("failed-precondition", "La orden está cerrada.");

  const settings = await db.doc(`${col.settings(tid)}/general`).get();
  const taxRate = Number(settings.get("taxRate") ?? 15);
  const { items, totals } = computeQuote(input.items, taxRate);
  const now = FieldValue.serverTimestamp();
  const o = order.data()!;

  if (input.quoteId) {
    const ref = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);
    const q = await ref.get();
    if (!q.exists || q.get("orderId") !== input.orderId) throw new HttpsError("not-found", "La cotización no existe.");
    if (q.get("status") !== "draft") throw new HttpsError("failed-precondition", "Solo se puede editar un borrador. Cree una nueva versión.");
    await ref.update({ items, totals, taxRate, notes: input.notes, validDays: input.validDays, technicianIds: o.technicianIds ?? [], updatedAt: now, updatedBy: caller.uid });
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
      number,
      code: `${prefix}-${String(number).padStart(4, "0")}`,
      version: 1,
      orderId: input.orderId,
      orderCode: o.code,
      customerId: o.customerId,
      customerName: o.customer.fullName,
      vehicleLabel: `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year}`,
      plate: o.vehicle.plate,
      technicianIds: o.technicianIds ?? [],
      status: "draft",
      items,
      taxRate,
      totals,
      notes: input.notes,
      validDays: input.validDays,
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
  return { quoteId: ref.id };
});

/** Envía la cotización al cliente: se congela, se publica en el portal y la orden avanza. */
export const sendQuote = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(sendQuoteSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);

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

  await buildPortal(tid, result.orderId);
  return result;
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
