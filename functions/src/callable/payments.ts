import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, formatMoney, orderCol, registerPaymentSchema, voidPaymentSchema, attachPaymentReceiptSchema, type Role } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { paymentExtras } from "../lib/paymentExtras";
import { readPaymentTarget, writePaymentToTarget } from "../lib/payments";

const CASHIERS: Role[] = ["admin", "manager", "reception", "seller"];

/** Registra un pago o abono sobre una orden o una venta. El saldo se recalcula en el servidor. */
export const registerPayment = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(registerPaymentSchema, request.data);
  const tid = caller.tid;
  if (!!input.orderId === !!input.saleId) throw new HttpsError("invalid-argument", "Indique la orden o la venta.");
  const name = await actorName(caller.uid, caller.email);

  return db.runTransaction(async (tx) => {
    const r = await readPaymentTarget(tx, tid, { orderId: input.orderId, saleId: input.saleId });
    return writePaymentToTarget(tx, r, {
      amount: input.amount, method: input.method, reference: input.reference, bank: input.bank, receiptPath: input.receiptPath,
      uid: caller.uid, byName: name,
    });
  });
});

/** Anula un pago (nunca se borra). Solo administración y gerencia. */
export const voidPayment = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(voidPaymentSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const payRef = db.doc(`${catalogCol.payments(tid)}/${input.paymentId}`);

  return db.runTransaction(async (tx) => {
    const p = await tx.get(payRef);
    if (!p.exists) throw new HttpsError("not-found", "El pago no existe.");
    if (p.get("status") === "voided") throw new HttpsError("failed-precondition", "El pago ya está anulado.");
    const orderId = p.get("orderId") as string | null;
    const saleId = p.get("saleId") as string | null;
    const targetRef = orderId ? db.doc(`${orderCol.workOrders(tid)}/${orderId}`) : saleId ? db.doc(`${catalogCol.sales(tid)}/${saleId}`) : null;
    const t = targetRef ? await tx.get(targetRef) : null;
    const amount = Number(p.get("amount"));
    tx.update(payRef, { status: "voided", voidReason: input.reason, voidedAt: FieldValue.serverTimestamp(), voidedBy: caller.uid });
    if (targetRef && t?.exists) {
      const total = Number(t.get("totals.total") ?? 0);
      const paid = Math.max(0, Number(t.get("paid") ?? 0) - amount);
      const upd: Record<string, unknown> = { paid, balance: total - paid };
      if (saleId) upd.status = total - paid <= 0 ? "paid" : "partial";
      tx.update(targetRef, upd);
      if (orderId) {
        tx.set(targetRef.collection("events").doc(), {
          type: "note", text: `Pago ${p.get("code")} anulado (${formatMoney(amount)}). Motivo: ${input.reason}`,
          visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null, actorId: caller.uid, actorName: name, at: FieldValue.serverTimestamp(),
        });
      }
    }
    return { ok: true };
  });
});

/** Agrega o reemplaza el banco/terminal y el comprobante de un pago válido. */
export const attachPaymentReceipt = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(attachPaymentReceiptSchema, request.data);
  const tid = caller.tid;
  const payRef = db.doc(`${catalogCol.payments(tid)}/${input.paymentId}`);
  const p = await payRef.get();
  if (!p.exists) throw new HttpsError("not-found", "El pago no existe.");
  if (p.get("status") === "voided") throw new HttpsError("failed-precondition", "El pago está anulado.");
  const method = String(p.get("method"));
  if (method === "cash" || method === "online") throw new HttpsError("failed-precondition", "Este tipo de pago no lleva comprobante bancario.");
  const extras = paymentExtras(tid, { method, bank: input.bank ?? p.get("bank"), receiptPath: input.receiptPath ?? p.get("receiptPath") });
  if ((method === "transfer" || method === "deposit") && !extras.bank) throw new HttpsError("invalid-argument", "Indique el banco o la cuenta.");
  await payRef.update({ ...extras, receiptBy: caller.uid, receiptAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
