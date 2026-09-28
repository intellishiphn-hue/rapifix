import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, formatMoney, orderCol } from "@rapifix/shared";
import { db } from "./admin";
import { pad, readCounter } from "./counters";
import { buildPortal } from "./portal";
import { toCents, type RokiPayment } from "./roki";
import { loadCarwashConfig, readWashCharge, writeWashCharge } from "./carwash";
import { buildPublicWash } from "./publicWash";

const ROKI_ACTOR = { uid: "roki", byName: "Pago en línea (ROKI)" };

/**
 * Pago en línea de un lavado del carwash: registra el cobro con la misma lógica de chargeWash
 * (venta del carwash + pago "online" + sello de lealtad), en transacción e idempotente.
 * Si algo no cuadra (lavado ya cobrado, cancelado u otro total) el dinero igual se registra y el cobro queda "por revisar".
 */
async function applyWashOnlinePayment(tid: string, onlinePaymentId: string, p: RokiPayment): Promise<"applied" | "already" | "missing"> {
  const opRef = db.doc(`${catalogCol.onlinePayments(tid)}/${onlinePaymentId}`);
  const cfg = await loadCarwashConfig(tid);
  const amount = toCents(p.amount);
  const fee = toCents(p.service_fee_amount ?? 0);
  const payment = { amount, method: "online" as const, reference: `ROKI ${p.transaction_id ?? p.id}`, extra: { rokiPaymentId: p.id, rokiTransactionId: p.transaction_id } };
  const result = await db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const op = await tx.get(opRef);
    if (!op.exists) return { r: "missing" as const, washId: null };
    const washId = String(op.get("washId") ?? "");
    if (op.get("status") === "paid") return { r: "already" as const, washId };
    const r = await readWashCharge(tx, tid, washId);
    const w = r.wash;
    const saleId = w.exists ? ((w.get("saleId") as string | null) ?? null) : null;
    const saleRef = saleId ? db.doc(`${catalogCol.sales(tid)}/${saleId}`) : null;
    const sale = saleRef ? await tx.get(saleRef) : null;

    // ---------- escrituras ----------
    const opPatch: Record<string, unknown> = {
      status: "paid", transactionId: p.transaction_id, serviceFee: fee, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    if (!w.exists) {
      tx.update(opRef, { ...opPatch, paymentId: null, needsReview: true, reviewNote: "El lavado ya no existe: el pago no se registró. Revise un reembolso en ROKI." });
      return { r: "applied" as const, washId: null };
    }
    if (saleRef && sale?.exists) {
      // Ya estaba cobrado (en caja u otro link): el cliente pagó dos veces. Se registra el pago en esa venta.
      const payRef = db.collection(catalogCol.payments(tid)).doc();
      const salePaid = Number(sale.get("paid") ?? 0) + amount;
      const saleTotal = Number(sale.get("totals.total") ?? 0);
      tx.set(r.payCounter.ref, { next: r.payCounter.next + 1 }, { merge: true });
      tx.update(saleRef, { paid: salePaid, balance: saleTotal - salePaid });
      tx.set(payRef, {
        number: r.payCounter.next, code: `REC-${pad(r.payCounter.next)}`, amount, method: "online", reference: `${payment.reference} (pago doble: revisar)`,
        bank: "", receiptPath: null, receiptType: null, status: "valid", voidReason: "",
        customerId: (w.get("customerId") as string | null) ?? null, customerName: String(w.get("customerName") || "Consumidor final"),
        orderId: null, orderCode: null, saleId: saleRef.id, saleCode: sale.get("code"),
        receivedBy: ROKI_ACTOR.uid, receivedByName: ROKI_ACTOR.byName, at: FieldValue.serverTimestamp(), ...payment.extra,
      });
      tx.update(opRef, {
        ...opPatch, paymentId: payRef.id, needsReview: true,
        reviewNote: `El lavado ya estaba cobrado (${sale.get("code")}): el cliente pagó dos veces ${formatMoney(amount)}. Revise un reembolso en ROKI.`,
      });
      return { r: "applied" as const, washId };
    }
    const res = writeWashCharge(tx, r, { cfg, uid: ROKI_ACTOR.uid, byName: ROKI_ACTOR.byName, discount: 0, payments: [payment], mode: "online" });
    const notes: string[] = [];
    if (w.get("status") === "cancelled") notes.push("El lavado estaba cancelado.");
    if (res.paidTotal !== res.total) notes.push(`Pagó ${formatMoney(res.paidTotal)} y el lavado es de ${formatMoney(res.total)}.`);
    tx.update(opRef, { ...opPatch, paymentId: res.paymentIds[0] ?? null, ...(notes.length ? { needsReview: true, reviewNote: notes.join(" ") } : {}) });
    return { r: "applied" as const, washId };
  });
  if (result.washId) await buildPublicWash(tid, result.washId).catch(() => null);
  logger.info("ROKI pago de lavado aplicado", { tid, onlinePaymentId, result: result.r, rokiId: p.id });
  return result.r;
}

/**
 * Registra en RAPIFIX un pago confirmado por ROKI (por webhook o por consulta directa).
 * Idempotente: si el cobro en línea ya estaba registrado, no hace nada.
 */
export async function applyOnlinePayment(tid: string, onlinePaymentId: string, p: RokiPayment): Promise<"applied" | "already" | "missing"> {
  const opRef = db.doc(`${catalogCol.onlinePayments(tid)}/${onlinePaymentId}`);
  // Cobros de lavados (target "wash"). Los de órdenes no tienen target (se crearon antes) o tienen "order".
  const target = (await opRef.get()).get("target");
  if (target === "wash") return applyWashOnlinePayment(tid, onlinePaymentId, p);
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
    const label = status === "voided" ? "anulado" : "reembolsado";
    const touched = await db.runTransaction(async (tx) => {
      const pay = await tx.get(payRef);
      if (!pay.exists || pay.get("status") === "voided") return null;
      const orderId = (pay.get("orderId") as string | null) ?? null;
      const saleId = (pay.get("saleId") as string | null) ?? null;
      const targetRef = orderId ? db.doc(`${orderCol.workOrders(tid)}/${orderId}`) : saleId ? db.doc(`${catalogCol.sales(tid)}/${saleId}`) : null;
      const t = targetRef ? await tx.get(targetRef) : null;
      const amount = Number(pay.get("amount"));
      tx.update(payRef, { status: "voided", voidReason: status === "voided" ? "Anulado en ROKI" : "Reembolsado en ROKI", voidedAt: FieldValue.serverTimestamp(), voidedBy: "roki" });
      if (targetRef && t?.exists) {
        const total = Number(t.get("totals.total") ?? 0);
        const paid = Math.max(0, Number(t.get("paid") ?? 0) - amount);
        const upd: Record<string, unknown> = { paid, balance: total - paid };
        if (saleId && t.get("status") !== "voided") upd.status = total - paid <= 0 ? "paid" : "partial";
        tx.update(targetRef, upd);
        if (orderId) {
          tx.set(targetRef.collection("events").doc(), {
            type: "note", text: `Pago en línea ${pay.get("code")} ${label} en ROKI (${formatMoney(amount)}).`,
            visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null, actorId: "roki", actorName: "Sistema", at: FieldValue.serverTimestamp(),
          });
        }
      }
      if (!orderId) {
        // Lavado: el pago se anula en la venta; caja revisa si el lavado debe volver a cobrarse
        tx.update(opRef, { needsReview: true, reviewNote: `Pago ${pay.get("code")} ${label} en ROKI (${formatMoney(amount)}). Revise la venta ${pay.get("saleCode") ?? ""} del lavado.`.trim() });
      }
      return { orderId };
    });
    if (touched?.orderId) await buildPortal(tid, touched.orderId);
  }
}
