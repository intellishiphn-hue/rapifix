import { FieldValue } from "firebase-admin/firestore";
import {
  catalogCol, col, commissionAmount, companyCol, computeOrderFinance, decideCommission, isReferralActive, movementCostMap, orderCol,
  pickApprovedQuote, quoteCol, type Quote, type Referral,
} from "@rapifix/shared";
import { db } from "./admin";

/**
 * Utilidad de una orden con la misma lógica de Finanzas: cotización aprobada vigente,
 * costo de repuestos (línea, salidas de inventario de la orden o costo promedio actual).
 */
export async function serverOrderFinance(tid: string, orderId: string, order: FirebaseFirestore.DocumentData) {
  const [quotesSnap, movsSnap] = await Promise.all([
    db.collection(quoteCol.quotes(tid)).where("orderId", "==", orderId).get(),
    db.collection(catalogCol.movements(tid)).where("orderId", "==", orderId).get(),
  ]);
  const quotes = quotesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Quote);
  const quote = pickApprovedQuote(quotes, (order.activeQuoteId as string | null | undefined) ?? null);
  const movs = movsSnap.docs.map((d) => d.data() as { type: string; qty: number; unitCost: number; productId: string; orderId?: string | null });
  const mov = movementCostMap(movs, "orderId");
  // Costo promedio actual solo de los repuestos que lo necesitan
  const needAvg = [...new Set((quote?.items ?? [])
    .filter((it) => it.type === "part" && it.productId && !(it.unitCost > 0) && !((mov.get(`${orderId}|${it.productId}`) ?? 0) > 0))
    .map((it) => it.productId as string))];
  const avg = new Map<string, number>();
  if (needAvg.length) {
    const snaps = await db.getAll(...needAvg.map((pid) => db.doc(`${catalogCol.productCosts(tid)}/${pid}`)));
    for (const s of snaps) if (s.exists) avg.set(s.id, Number(s.get("avgCost") || s.get("cost") || 0));
  }
  return computeOrderFinance(order as { totals?: { subtotal?: number; discount?: number; tax?: number } }, quote, {
    movementCost: (pid) => mov.get(`${orderId}|${pid}`),
    avgCost: (pid) => avg.get(pid),
  });
}

/** Referido vigente de la orden: primero el de la empresa; si no, el del cliente. */
async function activeReferral(tid: string, order: FirebaseFirestore.DocumentData, atMs: number) {
  if (order.companyId) {
    const c = await db.doc(`${companyCol.companies(tid)}/${order.companyId}`).get();
    const r = c.get("referral") as Referral | null | undefined;
    if (c.exists && r && isReferralActive(r, atMs)) return { referral: r, source: "company" as const, companyName: (c.get("name") as string) ?? "" };
  }
  if (order.customerId) {
    const cu = await db.doc(`${col.customers(tid)}/${order.customerId}`).get();
    const r = cu.get("referral") as Referral | null | undefined;
    if (cu.exists && r && isReferralActive(r, atMs)) return { referral: r, source: "customer" as const, companyName: "" };
  }
  return null;
}

const fingerprint = (o: FirebaseFirestore.DocumentData | undefined) =>
  o ? JSON.stringify([o.paid ?? 0, o.balance ?? null, o.totals?.total ?? 0, o.activeQuoteId ?? null, o.status ?? "", o.companyId ?? null, o.customerId ?? ""]) : "-";

/**
 * Crea, recalcula, anula o marca para revisión la comisión de una orden (commissions/{orderId}).
 * Idempotente: decide por el estado actual de la orden y de la comisión, no por el evento.
 * La escritura va en una transacción que confirma que la orden no cambió mientras se calculaba
 * (si cambió, se vuelve a calcular), así dos eventos seguidos no dejan un estado viejo.
 * `flagNote`: nota para una comisión ya pagada que queda en revisión (ej. corrección de costos internos).
 */
export async function syncOrderCommission(tid: string, orderId: string, opts: { flagNote?: string } = {}) {
  const orderRef = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
  const comRef = db.doc(`${companyCol.commissions(tid)}/${orderId}`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [orderSnap, comSnap] = await Promise.all([orderRef.get(), comRef.get()]);
    const order = orderSnap.data();
    const pre = comSnap.exists ? comSnap.data()! : null;
    const total = Number(order?.totals?.total ?? 0);
    const balance = order ? (typeof order.balance === "number" ? order.balance : total - Number(order.paid ?? 0)) : 0;
    const paidFull = !!order && total > 0 && balance <= 0 && order.status !== "CANCELLED";
    if (!paidFull && !pre) return; // lo más común: orden con saldo y sin comisión

    const fin = paidFull ? await serverOrderFinance(tid, orderId, order!) : null;
    const ref = paidFull && (!pre || (pre.status === "voided" && pre.autoVoided)) ? await activeReferral(tid, order!, Date.now()) : null;
    const seen = fingerprint(order);

    const done = await db.runTransaction(async (tx) => {
      const [o, c] = await Promise.all([tx.get(orderRef), tx.get(comRef)]);
      if (fingerprint(o.data()) !== seen) return false; // cambió mientras se calculaba: otra vuelta
      const existing = c.exists ? c.data()! : null;
      const ts = FieldValue.serverTimestamp();
      if (!o.exists) {
        // orden eliminada: una comisión pendiente se anula (no se recrea)
        if (existing?.status === "pending") tx.update(comRef, { status: "voided", autoVoided: false, voidReason: "La orden fue eliminada.", voidedAt: ts, updatedAt: ts });
        return true;
      }
      const action = decideCommission({
        paidFull,
        existing: existing as never,
        hasActiveReferral: !!ref,
        now: fin ? { profit: fin.profit, revenue: fin.revenue, cost: fin.cost } : { profit: existing?.profit ?? 0, revenue: existing?.revenue ?? 0, cost: existing?.cost ?? 0 },
        recalcAmount: fin && existing ? commissionAmount(fin.profit, Number(existing.pct ?? 0)) : 0,
      });
      if (action.kind === "create" && fin && ref) {
        const v = order!.vehicle ?? {};
        tx.set(comRef, {
          referrerId: ref.referral.referrerId, referrerName: ref.referral.referrerName,
          orderId, orderCode: order!.code ?? "",
          source: ref.source,
          companyId: order!.companyId || null, companyName: order!.companyName || ref.companyName || "",
          customerId: order!.customerId ?? "", customerName: order!.customer?.fullName ?? "",
          vehicleLabel: [v.make, v.model, v.year].filter(Boolean).join(" "), plate: v.plate ?? "",
          revenue: fin.revenue, cost: fin.cost, profit: fin.profit,
          pct: ref.referral.pct, basis: ref.referral.basis ?? "profit",
          amount: commissionAmount(fin.profit, ref.referral.pct),
          missingCostLines: fin.missingLines,
          status: "pending", earnedAt: ts, paidAt: null, payoutId: null,
          autoVoided: false, voidReason: "", voidedAt: null, needsReview: false, reviewNote: "",
          updatedAt: ts,
        });
      } else if (action.kind === "recalc" && fin && existing) {
        tx.update(comRef, {
          revenue: fin.revenue, cost: fin.cost, profit: fin.profit, missingCostLines: fin.missingLines,
          amount: commissionAmount(fin.profit, Number(existing.pct ?? 0)), updatedAt: ts,
        });
      } else if (action.kind === "void") {
        tx.update(comRef, { status: "voided", autoVoided: true, voidReason: action.reason, voidedAt: ts, updatedAt: ts });
      } else if (action.kind === "flag") {
        tx.update(comRef, { needsReview: true, reviewNote: (paidFull && opts.flagNote) || action.note, updatedAt: ts });
      }
      return true;
    });
    if (done) return;
  }
  console.warn("[comisiones] la orden cambió varias veces seguidas; se resolverá con el siguiente cambio", tid, orderId);
}

/** Recalcula saldo y órdenes abiertas de la empresa (se autocorrige siempre). */
export async function recountCompanyOrders(tid: string, companyId: string) {
  const ref = db.doc(`${companyCol.companies(tid)}/${companyId}`);
  const [company, orders] = await Promise.all([
    ref.get(),
    db.collection(orderCol.workOrders(tid)).where("companyId", "==", companyId).select("balance", "isOpen", "status").get(),
  ]);
  if (!company.exists) return;
  let balanceDue = 0;
  let openOrders = 0;
  for (const d of orders.docs) {
    if (d.get("status") === "CANCELLED") continue;
    balanceDue += Math.max(0, Number(d.get("balance") ?? 0));
    if (d.get("isOpen")) openOrders++;
  }
  if (company.get("balanceDue") !== balanceDue || company.get("openOrders") !== openOrders) {
    await ref.update({ balanceDue, openOrders });
  }
}

/** Cantidad de vehículos activos de la empresa. */
export async function recountCompanyVehicles(tid: string, companyId: string) {
  const ref = db.doc(`${companyCol.companies(tid)}/${companyId}`);
  const [company, count] = await Promise.all([
    ref.get(),
    db.collection(col.vehicles(tid)).where("companyId", "==", companyId).where("archived", "==", false).count().get(),
  ]);
  if (company.exists && company.get("vehicleCount") !== count.data().count) await ref.update({ vehicleCount: count.data().count });
}
