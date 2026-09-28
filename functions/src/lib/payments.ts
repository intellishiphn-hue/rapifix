import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { carwashCol, catalogCol, formatMoney, orderCol, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@rapifix/shared";
import { db } from "./admin";
import { pad, readCounter } from "./counters";
import { paymentExtras } from "./paymentExtras";

/**
 * Pago o abono sobre una orden o una venta (lógica de registerPayment).
 * En una transacción: primero readPaymentTarget() (lecturas) y después writePaymentToTarget().
 */
export interface PaymentTargetRead {
  tid: string;
  orderId: string | null;
  saleId: string | null;
  ref: DocumentReference;
  target: DocumentSnapshot;
  counter: { ref: DocumentReference; next: number };
  /** lavado del carwash de la venta (si la venta es de un lavado) */
  wash: DocumentSnapshot | null;
}

export async function readPaymentTarget(tx: Transaction, tid: string, t: { orderId?: string | null; saleId?: string | null }): Promise<PaymentTargetRead> {
  const orderId = t.orderId ?? null;
  const saleId = t.saleId ?? null;
  if (!!orderId === !!saleId) throw new HttpsError("invalid-argument", "Indique la orden o la venta.");
  const ref = orderId ? db.doc(`${orderCol.workOrders(tid)}/${orderId}`) : db.doc(`${catalogCol.sales(tid)}/${saleId}`);
  const target = await tx.get(ref);
  if (!target.exists) throw new HttpsError("not-found", "La orden o venta no existe.");
  const washId = saleId ? (target.get("washId") as string | null | undefined) : null;
  const wash = washId ? await tx.get(db.doc(`${carwashCol.washes(tid)}/${washId}`)) : null;
  const counter = await readCounter(tx, tid, "payments");
  return { tid, orderId, saleId, ref, target, counter, wash };
}

export function writePaymentToTarget(
  tx: Transaction,
  r: PaymentTargetRead,
  p: {
    amount: number; method: PaymentMethod; reference: string; bank?: string | null; receiptPath?: string | null;
    uid: string; byName: string;
    /** texto extra para el historial interno de la orden */
    note?: string;
    /** mensaje visible para el cliente en su portal (orden) */
    customerText?: string;
    extra?: Record<string, unknown>;
  },
): { paymentId: string; code: string; balance: number } {
  const t = r.target;
  const total = Number(t.get("totals.total") ?? 0);
  const paid = Number(t.get("paid") ?? 0);
  const balance = total - paid;
  if (r.saleId && t.get("status") === "voided") throw new HttpsError("failed-precondition", "La venta está anulada.");
  if (p.amount > balance) throw new HttpsError("failed-precondition", `El monto supera el saldo pendiente (${formatMoney(balance)}).`);
  const payRef = db.collection(catalogCol.payments(r.tid)).doc();
  const code = `REC-${pad(r.counter.next)}`;
  tx.set(r.counter.ref, { next: r.counter.next + 1 }, { merge: true });
  const newPaid = paid + p.amount;
  const upd: Record<string, unknown> = { paid: newPaid, balance: total - newPaid };
  if (r.saleId) upd.status = total - newPaid <= 0 ? "paid" : "partial";
  tx.update(r.ref, upd);
  tx.set(payRef, {
    number: r.counter.next, code, amount: p.amount, method: p.method, reference: p.reference, ...paymentExtras(r.tid, p), status: "valid", voidReason: "",
    customerId: (t.get("customerId") as string | null) ?? null,
    customerName: (t.get("customer.fullName") as string) ?? (t.get("customerName") as string) ?? "Consumidor final",
    orderId: r.orderId, orderCode: r.orderId ? t.get("code") : null,
    saleId: r.saleId, saleCode: r.saleId ? t.get("code") : null,
    receivedBy: p.uid, receivedByName: p.byName, at: FieldValue.serverTimestamp(),
    ...(p.extra ?? {}),
  });
  if (r.orderId) {
    tx.set(r.ref.collection("events").doc(), {
      type: "note", text: `Pago ${code} por ${formatMoney(p.amount)} (${PAYMENT_METHOD_LABELS[p.method]}). Saldo: ${formatMoney(total - newPaid)}${p.note ? `. ${p.note}` : ""}`,
      visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null, actorId: p.uid, actorName: p.byName, at: FieldValue.serverTimestamp(),
    });
    if (p.customerText) {
      tx.set(r.ref.collection("events").doc(), {
        type: "customer_update", text: p.customerText, visibleToCustomer: true, channels: ["portal"], fromStatus: null, toStatus: null,
        actorId: p.uid, actorName: p.byName, at: FieldValue.serverTimestamp(),
      });
    }
  }
  // Venta de un lavado que quedó saldada (p. ej. después de un pago en línea incompleto): el lavado queda pagado
  const w = r.wash;
  if (w?.exists && w.get("saleId") === r.ref.id && !w.get("paid") && total - newPaid <= 0) {
    tx.update(w.ref, { paid: true, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: p.uid });
  }
  return { paymentId: payRef.id, code, balance: total - newPaid };
}
