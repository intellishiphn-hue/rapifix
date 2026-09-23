import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, col, computeQuote, createSaleSchema } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";

/** Venta de mostrador: descuenta inventario y registra los pagos en una sola transacción. */
export const createSale = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "reception", "seller"]);
  const input = parseInput(createSaleSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const settings = await db.doc(`${col.settings(tid)}/general`).get();
  const taxRate = Number(settings.get("taxRate") ?? 15);

  let customerName = "Consumidor final";
  if (input.customerId) {
    const c = await db.doc(`${col.customers(tid)}/${input.customerId}`).get();
    if (!c.exists) throw new HttpsError("not-found", "El cliente no existe.");
    customerName = c.get("fullName");
  }
  let vehicleLabel = "";
  if (input.vehicleId) {
    const v = await db.doc(`${col.vehicles(tid)}/${input.vehicleId}`).get();
    if (v.exists) vehicleLabel = `${v.get("make")} ${v.get("model")} ${v.get("year")} (${v.get("plate")})`;
  }

  const computed = computeQuote(
    input.items.map((i) => ({ id: i.id, type: "other" as const, description: i.description, qty: i.qty, unitCost: 0, unitPrice: i.unitPrice, discount: i.discount, taxable: i.taxable })),
    taxRate,
  );
  const totals = computed.totals;
  const paidTotal = input.payments.reduce((a, p) => a + p.amount, 0);
  if (paidTotal > totals.total) throw new HttpsError("failed-precondition", "Los pagos superan el total de la venta.");

  const saleRef = db.collection(catalogCol.sales(tid)).doc();
  const productLines = input.items.filter((i) => i.kind === "product" && i.refId);

  return db.runTransaction(async (tx) => {
    // --- lecturas ---
    const saleCounter = await readCounter(tx, tid, "sales");
    const payCounter = input.payments.length ? await readCounter(tx, tid, "payments") : null;
    const products = await Promise.all(productLines.map((l) => tx.get(db.doc(`${catalogCol.products(tid)}/${l.refId}`))));
    const costs = await Promise.all(productLines.map((l) => tx.get(db.doc(`${catalogCol.productCosts(tid)}/${l.refId}`))));
    const stockLeft = new Map<string, number>();
    products.forEach((p, idx) => {
      if (!p.exists) throw new HttpsError("not-found", `El producto "${productLines[idx]!.description}" ya no existe.`);
      const current = stockLeft.get(p.id) ?? Number(p.get("stock") ?? 0);
      const after = current - productLines[idx]!.qty;
      if (after < 0) throw new HttpsError("failed-precondition", `No hay suficiente existencia de ${p.get("name")} (hay ${current}).`);
      stockLeft.set(p.id, after);
    });

    // --- escrituras ---
    const code = `V-${pad(saleCounter.next)}`;
    tx.set(saleCounter.ref, { next: saleCounter.next + 1 }, { merge: true });
    tx.set(saleRef, {
      number: saleCounter.next, code,
      customerId: input.customerId ?? null, customerName, vehicleId: input.vehicleId ?? null, vehicleLabel,
      items: input.items.map((i, idx) => ({ ...i, refId: i.refId ?? null, lineTotal: computed.items[idx]!.lineTotal })),
      taxRate, totals, paid: paidTotal, balance: totals.total - paidTotal,
      status: totals.total - paidTotal <= 0 ? "paid" : "partial",
      by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
    });

    const running = new Map<string, number>();
    productLines.forEach((l, idx) => {
      const p = products[idx]!;
      const before = running.get(p.id) ?? Number(p.get("stock") ?? 0);
      const after = before - l.qty;
      running.set(p.id, after);
      tx.set(db.collection(catalogCol.movements(tid)).doc(), {
        productId: p.id, productName: p.get("name"), sku: p.get("sku") ?? "", type: "out", qty: l.qty,
        unitCost: Number(costs[idx]!.get("avgCost") ?? costs[idx]!.get("cost") ?? 0), stockBefore: before, stockAfter: after,
        reason: `Venta ${code}`, orderId: null, orderCode: null, saleId: saleRef.id, saleCode: code,
        by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
      });
    });
    for (const [pid, stock] of running) {
      tx.update(db.doc(`${catalogCol.products(tid)}/${pid}`), { stock, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    }

    const paymentIds: string[] = [];
    if (payCounter) {
      input.payments.forEach((p, i) => {
        const ref = db.collection(catalogCol.payments(tid)).doc();
        paymentIds.push(ref.id);
        tx.set(ref, {
          number: payCounter.next + i, code: `REC-${pad(payCounter.next + i)}`, amount: p.amount, method: p.method, reference: p.reference,
          status: "valid", voidReason: "", customerId: input.customerId ?? null, customerName,
          orderId: null, orderCode: null, saleId: saleRef.id, saleCode: code,
          receivedBy: caller.uid, receivedByName: name, at: FieldValue.serverTimestamp(),
        });
      });
      tx.set(payCounter.ref, { next: payCounter.next + input.payments.length }, { merge: true });
    }
    return { saleId: saleRef.id, code, paymentIds, balance: totals.total - paidTotal };
  });
});
