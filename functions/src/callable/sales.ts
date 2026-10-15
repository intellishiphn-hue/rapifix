import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, col, computeQuote, couponRuleOf, createSaleSchema, normalizeCouponCode, saleKindToCouponKind, type CouponRule, type QuoteItemType } from "@rapifix/shared";
import { assertCoupon, couponData, couponDoc, identityKeys, isFirstVisit, readCouponForUse, writeReservation, type CouponIdentity } from "../lib/coupons";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";
import { paymentExtras } from "../lib/paymentExtras";

/** Tipo de línea para el cálculo (decide qué líneas cubre un cupón: productos = repuestos). */
const saleItemQuoteType = (k: string): QuoteItemType => (k === "product" ? "part" : k === "service" ? "service" : "other");

/** Teléfono y placa del cliente/vehículo de la venta, y la empresa del vehículo (para el cupón). */
export async function saleCouponContext(tid: string, customerId: string | null, vehicleId: string | null) {
  const [c, v] = await Promise.all([
    customerId ? db.doc(`${col.customers(tid)}/${customerId}`).get() : Promise.resolve(null),
    vehicleId ? db.doc(`${col.vehicles(tid)}/${vehicleId}`).get() : Promise.resolve(null),
  ]);
  return {
    identity: {
      customerId: c?.exists ? c.id : null, customerName: String(c?.get("fullName") ?? ""),
      phone: (c?.get("phone") as string | undefined) || null, plate: v?.exists ? String(v.get("plate") ?? "") || null : null,
    } as CouponIdentity,
    companyId: v?.exists ? ((v.get("companyId") as string | undefined) || null) : null,
  };
}

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

  const lines = input.items.map((i) => ({ id: i.id, type: saleItemQuoteType(i.kind), description: i.description, qty: i.qty, unitCost: 0, unitPrice: i.unitPrice, discount: i.discount, taxable: i.taxable }));
  const paidTotal = input.payments.reduce((a, p) => a + p.amount, 0);
  if (!input.couponCode && paidTotal > computeQuote(lines, taxRate).totals.total) throw new HttpsError("failed-precondition", "Los pagos superan el total de la venta.");

  // Cupón: identidad del cliente (cliente, teléfono, placa) y empresa del vehículo
  const couponCode = input.couponCode ? normalizeCouponCode(input.couponCode) : "";
  let identity: CouponIdentity = { customerId: input.customerId ?? null, customerName, phone: null, plate: null };
  let companyId: string | null = null;
  let firstVisit: boolean | null = null;
  if (couponCode) {
    const ctx = await saleCouponContext(tid, input.customerId ?? null, input.vehicleId ?? null);
    identity = { ...ctx.identity, customerName };
    companyId = ctx.companyId;
    const pre = await couponDoc(tid, couponCode).get();
    if (pre.get("firstVisitOnly") === true) firstVisit = await isFirstVisit(tid, identity, {});
  }

  const saleRef = db.collection(catalogCol.sales(tid)).doc();
  const productLines = input.items.filter((i) => i.kind === "product" && i.refId);

  return db.runTransaction(async (tx) => {
    // --- lecturas ---
    const saleCounter = await readCounter(tx, tid, "sales");
    const payCounter = input.payments.length ? await readCounter(tx, tid, "payments") : null;
    const products = await Promise.all(productLines.map((l) => tx.get(db.doc(`${catalogCol.products(tid)}/${l.refId}`))));
    const costs = await Promise.all(productLines.map((l) => tx.get(db.doc(`${catalogCol.productCosts(tid)}/${l.refId}`))));
    const couponRead = couponCode ? await readCouponForUse(tx, tid, couponCode, identityKeys(identity)) : null;
    let computed = computeQuote(lines, taxRate);
    let rule: CouponRule | null = null;
    if (couponRead) {
      assertCoupon(couponRead, { unit: "pos", lines: input.items.map((i, idx) => ({ kind: saleKindToCouponKind(i.kind), amount: computed.items[idx]!.lineTotal })), byCustomer: false, isFirstVisit: firstVisit, companyId });
      rule = couponRuleOf(couponData(couponRead));
      computed = computeQuote(lines, taxRate, rule);
    }
    const totals = computed.totals;
    if (paidTotal > totals.total) throw new HttpsError("failed-precondition", "Los pagos superan el total de la venta.");
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
    const coupon = couponRead
      ? writeReservation(tx, tid, couponRead, {
          status: "used", unit: "pos", target: { kind: "sale", id: saleRef.id, code }, saleId: saleRef.id, saleCode: code,
          identity, discount: totals.couponDiscount ?? 0, total: totals.total, firstVisit: firstVisit === true,
          appliedBy: name, appliedByUid: caller.uid, channel: "panel",
        })
      : null;
    tx.set(saleRef, {
      number: saleCounter.next, code,
      customerId: input.customerId ?? null, customerName, vehicleId: input.vehicleId ?? null, vehicleLabel,
      items: input.items.map((i, idx) => ({
        ...i, refId: i.refId ?? null, lineTotal: computed.items[idx]!.lineTotal,
        ...(coupon ? { couponDiscount: computed.items[idx]!.couponDiscount ?? 0 } : {}),
      })),
      ...(coupon ? { coupon } : {}),
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
          number: payCounter.next + i, code: `REC-${pad(payCounter.next + i)}`, amount: p.amount, method: p.method, reference: p.reference, ...paymentExtras(tid, p),
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
