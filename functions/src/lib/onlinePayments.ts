import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, formatMoney, orderCol } from "@rapifix/shared";
import { db } from "./admin";
import { pad, readCounter } from "./counters";
import { buildPortal } from "./portal";
import { toCents, type RokiPayment } from "./roki";

/**
 * Registra en RAPIFIX un pago confirmado por ROKI (por webhook o por consulta directa).
 * Idempotente: si el cobro en línea ya estaba registrado, no hace nada.
 */
export async function applyOnlinePayment(tid: string, onlinePaymentId: string, p: RokiPayment): Promise<"applied" | "already" | "missing"> {
  const opRef = db.doc(`${catalogCol.onlinePayments(tid)}/${onlinePaymentId}`);
  const result = await db.runTransaction(async (tx) => {
    const op = await tx.get(opRef);
    if (!op.exists) return { r: "missing" as const, orderId: null };
    if (op.get("status") === "paid") return { r: "already" as const, orderId: op.get("orderId") as string };
    const orderRef = db.doc(`${orderCol.workOrders(tid)}/${op.get("orderId")}`);
    const order = await tx.get(orderRef);
    const counter = await readCounter(tx, tid, "payments");

    // Se registra el monto base que pidió el taller; la comisión (si se trasladó) es de ROKI.
    const amount = toCents(p.amount);
    const fee = toCents(p.service_fee_amount ?? 0);
    const code = `REC-${pad(counter.next)}`;
    const payRef = db.collection(catalogCol.payments(tid)).doc();
    tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });

    const total = Number(order.get("totals.total") ?? 0);
    const paid = Number(order.get("paid") ?? 0) + amount;
    tx.update(orderRef, { paid, balance: total - paid, updatedAt: FieldValue.serverTimestamp() });
    tx.set(payRef, {
      number: counter.next, code, amount, method: "online", reference: `ROKI ${p.transaction_id ?? p.id}`,
      status: "valid", voidReason: "",
      customerId: (order.get("customerId") as string) ?? null, customerName: (order.get("customer.fullName") as string) ?? "Cliente",
      orderId: orderRef.id, orderCode: order.get("code"), saleId: null, saleCode: null,
      receivedBy: "roki", receivedByName: "Pago en línea (ROKI)", at: FieldValue.serverTimestamp(),
      rokiPaymentId: p.id, rokiTransactionId: p.transaction_id,
    });
    tx.update(opRef, {
      status: "paid", transactionId: p.transaction_id, serviceFee: fee, paymentId: payRef.id,
      paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    const over = total - paid < 0;
    tx.set(orderRef.collection("events").doc(), {
      type: "customer_update",
      text: `Pago en línea recibido: ${formatMoney(amount)} (${code}). ¡Gracias!`,
      visibleToCustomer: true, channels: ["portal"], fromStatus: null, toStatus: null,
      actorId: "roki", actorName: "Pago en línea", at: FieldValue.serverTimestamp(),
    });
    if (over) {
      tx.set(orderRef.collection("events").doc(), {
        type: "note", text: `Revisar: el pago en línea dejó un saldo a favor del cliente de ${formatMoney(paid - total)}.`,
        visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null,
        actorId: "roki", actorName: "Sistema", at: FieldValue.serverTimestamp(),
      });
    }
    return { r: "applied" as const, orderId: orderRef.id };
  });
  if (result.orderId) await buildPortal(tid, result.orderId);
  logger.info("ROKI pago aplicado", { tid, onlinePaymentId, result: result.r, rokiId: p.id });
  return result.r;
}

/** Actualiza el estado de un cobro en línea que no se pagó (vencido, fallido, anulado, reembolsado). */
export async function markOnlinePayment(tid: string, onlinePaymentId: string, status: string, p?: RokiPayment) {
  const opRef = db.doc(`${catalogCol.onlinePayments(tid)}/${onlinePaymentId}`);
  const op = await opRef.get();
  if (!op.exists) return;
  await opRef.update({ status, transactionId: p?.transaction_id ?? op.get("transactionId") ?? null, updatedAt: FieldValue.serverTimestamp() });

  // Anulado o reembolsado en ROKI: se anula también el pago registrado en RAPIFIX.
  const paymentId = op.get("paymentId") as string | null;
  if ((status === "voided" || status === "refunded") && paymentId) {
    const payRef = db.doc(`${catalogCol.payments(tid)}/${paymentId}`);
    await db.runTransaction(async (tx) => {
      const pay = await tx.get(payRef);
      if (!pay.exists || pay.get("status") === "voided") return;
      const orderRef = db.doc(`${orderCol.workOrders(tid)}/${pay.get("orderId")}`);
      const order = await tx.get(orderRef);
      const amount = Number(pay.get("amount"));
      const paid = Math.max(0, Number(order.get("paid") ?? 0) - amount);
      tx.update(payRef, { status: "voided", voidReason: status === "voided" ? "Anulado en ROKI" : "Reembolsado en ROKI", voidedAt: FieldValue.serverTimestamp(), voidedBy: "roki" });
      tx.update(orderRef, { paid, balance: Number(order.get("totals.total") ?? 0) - paid });
      tx.set(orderRef.collection("events").doc(), {
        type: "note", text: `Pago en línea ${pay.get("code")} ${status === "voided" ? "anulado" : "reembolsado"} en ROKI (${formatMoney(amount)}).`,
        visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null, actorId: "roki", actorName: "Sistema", at: FieldValue.serverTimestamp(),
      });
    });
    await buildPortal(tid, op.get("orderId"));
  }
}
