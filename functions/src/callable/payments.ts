import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, formatMoney, orderCol, PAYMENT_METHOD_LABELS, registerPaymentSchema, voidPaymentSchema, type Role } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";

const CASHIERS: Role[] = ["admin", "manager", "reception", "seller"];

/** Registra un pago o abono sobre una orden o una venta. El saldo se recalcula en el servidor. */
export const registerPayment = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(registerPaymentSchema, request.data);
  const tid = caller.tid;
  if (!!input.orderId === !!input.saleId) throw new HttpsError("invalid-argument", "Indique la orden o la venta.");
  const name = await actorName(caller.uid, caller.email);
  const targetRef = input.orderId ? db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`) : db.doc(`${catalogCol.sales(tid)}/${input.saleId}`);
  const payRef = db.collection(catalogCol.payments(tid)).doc();

  return db.runTransaction(async (tx) => {
    const t = await tx.get(targetRef);
    if (!t.exists) throw new HttpsError("not-found", "La orden o venta no existe.");
    const counter = await readCounter(tx, tid, "payments");
    const total = Number(t.get("totals.total") ?? 0);
    const paid = Number(t.get("paid") ?? 0);
    const balance = total - paid;
    if (input.amount > balance) throw new HttpsError("failed-precondition", `El monto supera el saldo pendiente (${formatMoney(balance)}).`);
    const code = `REC-${pad(counter.next)}`;
    tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });
    const newPaid = paid + input.amount;
    const upd: Record<string, unknown> = { paid: newPaid, balance: total - newPaid };
    if (input.saleId) upd.status = total - newPaid <= 0 ? "paid" : "partial";
    tx.update(targetRef, upd);
    tx.set(payRef, {
      number: counter.next, code, amount: input.amount, method: input.method, reference: input.reference, status: "valid", voidReason: "",
      customerId: (t.get("customerId") as string | null) ?? null,
      customerName: (t.get("customer.fullName") as string) ?? (t.get("customerName") as string) ?? "Consumidor final",
      orderId: input.orderId ?? null, orderCode: input.orderId ? t.get("code") : null,
      saleId: input.saleId ?? null, saleCode: input.saleId ? t.get("code") : null,
      receivedBy: caller.uid, receivedByName: name, at: FieldValue.serverTimestamp(),
    });
    if (input.orderId) {
      tx.set(targetRef.collection("events").doc(), {
        type: "note", text: `Pago ${code} por ${formatMoney(input.amount)} (${PAYMENT_METHOD_LABELS[input.method]}). Saldo: ${formatMoney(total - newPaid)}`,
        visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null, actorId: caller.uid, actorName: name, at: FieldValue.serverTimestamp(),
      });
    }
    return { paymentId: payRef.id, code, balance: total - newPaid };
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
