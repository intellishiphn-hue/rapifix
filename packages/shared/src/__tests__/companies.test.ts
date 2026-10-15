import { describe, expect, it } from "vitest";
import {
  agingBucket, agingSummary, allocatePayment, commissionAmount, daysOverdue, decideCommission, isReferralActive, monthlyCutoffKey,
  orderDueKey, paymentTermsLabel, setReferralSchema, sortForAllocation, validateAllocations, registerCompanyPaymentSchema,
} from "../companies";
import { computeOrderFinance, movementCostMap, pickApprovedQuote, resolvePartCost } from "../orderFinance";
import type { QuoteItem } from "../quote";

/** Mediodía en Honduras (18:00 UTC) de ese día */
const hn = (key: string) => new Date(`${key}T18:00:00Z`).getTime();

describe("forma de pago: etiqueta y vencimiento", () => {
  it("etiquetas", () => {
    expect(paymentTermsLabel({ paymentTerms: "cash" })).toBe("Contado");
    expect(paymentTermsLabel({ paymentTerms: "credit", creditDays: 30 })).toBe("Crédito 30 días");
    expect(paymentTermsLabel({ paymentTerms: "monthly", cutoffDay: null })).toBe("Fin de mes");
    expect(paymentTermsLabel({ paymentTerms: "monthly", cutoffDay: 25 })).toBe("Fin de mes (corte día 25)");
  });
  it("contado vence el día de la entrega", () => {
    expect(orderDueKey({ paymentTerms: "cash" }, hn("2026-10-05"))).toBe("2026-10-05");
  });
  it("crédito vence N días después de la entrega", () => {
    expect(orderDueKey({ paymentTerms: "credit", creditDays: 30 }, hn("2026-10-05"))).toBe("2026-11-04");
    expect(orderDueKey({ paymentTerms: "credit", creditDays: 15 }, hn("2026-12-20"))).toBe("2027-01-04");
  });
  it("la entrega de noche en Honduras cuenta como ese día (no el siguiente en UTC)", () => {
    // 5 de octubre 11:30 p.m. en Honduras = 6 de octubre 05:30 UTC
    expect(orderDueKey({ paymentTerms: "cash" }, new Date("2026-10-06T05:30:00Z").getTime())).toBe("2026-10-05");
  });
  it("fin de mes: corte el último día del mes + N días", () => {
    expect(orderDueKey({ paymentTerms: "monthly", cutoffDay: null, monthlyDueDays: 15 }, hn("2026-10-05"))).toBe("2026-11-15");
    expect(orderDueKey({ paymentTerms: "monthly", cutoffDay: null, monthlyDueDays: 15 }, hn("2026-10-31"))).toBe("2026-11-15");
    expect(orderDueKey({ paymentTerms: "monthly", cutoffDay: null, monthlyDueDays: 15 }, hn("2027-02-10"))).toBe("2027-03-15");
  });
  it("fin de mes con día de corte: después del corte pasa al mes siguiente", () => {
    expect(monthlyCutoffKey("2026-10-20", 25)).toBe("2026-10-25");
    expect(monthlyCutoffKey("2026-10-25", 25)).toBe("2026-10-25");
    expect(monthlyCutoffKey("2026-10-26", 25)).toBe("2026-11-25");
    expect(monthlyCutoffKey("2026-12-28", 25)).toBe("2027-01-25");
    expect(orderDueKey({ paymentTerms: "monthly", cutoffDay: 25, monthlyDueDays: 10 }, hn("2026-10-26"))).toBe("2026-12-05");
  });
  it("orden sin entregar no vence", () => {
    expect(orderDueKey({ paymentTerms: "credit", creditDays: 30 }, null)).toBeNull();
  });
});

describe("antigüedad de saldos", () => {
  const today = "2026-10-15";
  it("días de atraso y tramo", () => {
    expect(daysOverdue("2026-10-15", today)).toBe(0);
    expect(agingBucket("2026-10-15", today)).toBe("current");
    expect(agingBucket("2026-10-20", today)).toBe("current");
    expect(agingBucket("2026-10-14", today)).toBe("d30");
    expect(agingBucket("2026-09-15", today)).toBe("d30"); // 30 días
    expect(agingBucket("2026-09-14", today)).toBe("d60"); // 31 días
    expect(agingBucket("2026-07-17", today)).toBe("d90"); // 90 días
    expect(agingBucket("2026-07-16", today)).toBe("d90plus");
    expect(agingBucket(null, today)).toBe("current");
  });
  it("resumen: total, vencido y por vencer", () => {
    const s = agingSummary([
      { balance: 1000, dueKey: "2026-10-20" },
      { balance: 2000, dueKey: "2026-10-01" },
      { balance: 3000, dueKey: "2026-08-01" },
      { balance: 0, dueKey: "2026-01-01" },
      { balance: 4000, dueKey: null },
    ], today);
    expect(s.total).toBe(10000);
    expect(s.current).toBe(5000);
    expect(s.overdue).toBe(5000);
    expect(s.buckets.d30).toBe(2000);
    expect(s.buckets.d90).toBe(3000);
    expect(s.count).toBe(4);
    expect(s.overdueCount).toBe(2);
  });
});

describe("reparto de un pago entre órdenes", () => {
  const orders = [
    { id: "c", balance: 30000, sortKey: "2026-10-10", number: 1003 },
    { id: "a", balance: 10000, sortKey: "2026-09-01", number: 1001 },
    { id: "b", balance: 20000, sortKey: "2026-09-01", number: 1002 },
    { id: "d", balance: 5000, sortKey: null, number: 1004 },
  ];
  it("ordena de la más vieja a la más nueva (abiertas al final)", () => {
    expect(sortForAllocation(orders).map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("cubre completas las más viejas y abona a la siguiente", () => {
    const r = allocatePayment(35000, orders);
    expect(r.allocations).toEqual([{ orderId: "a", amount: 10000 }, { orderId: "b", amount: 20000 }, { orderId: "c", amount: 5000 }]);
    expect(r.leftover).toBe(0);
  });
  it("lo que sobra se devuelve aparte", () => {
    const r = allocatePayment(70000, orders);
    expect(r.allocations.reduce((a, x) => a + x.amount, 0)).toBe(65000);
    expect(r.leftover).toBe(5000);
  });
  it("valida repartos hechos a mano", () => {
    const bal = { a: 10000, b: 20000 };
    expect(validateAllocations([{ orderId: "a", amount: 10000 }, { orderId: "b", amount: 500 }], bal)).toBeNull();
    expect(validateAllocations([{ orderId: "a", amount: 10001 }], bal)).toMatch(/supera/);
    expect(validateAllocations([{ orderId: "a", amount: 1 }, { orderId: "a", amount: 1 }], bal)).toMatch(/repetida/);
    expect(validateAllocations([{ orderId: "x", amount: 1 }], bal)).toMatch(/no es de esta empresa/);
    expect(validateAllocations([], bal)).toBeTruthy();
  });
  it("el esquema exige banco en transferencias y no repite órdenes", () => {
    const base = { companyId: "e1", method: "transfer", reference: "123", allocations: [{ orderId: "a", amount: 100 }] };
    expect(registerCompanyPaymentSchema.safeParse(base).success).toBe(false);
    expect(registerCompanyPaymentSchema.safeParse({ ...base, bank: "BAC" }).success).toBe(true);
    expect(registerCompanyPaymentSchema.safeParse({ ...base, bank: "BAC", allocations: [{ orderId: "a", amount: 1 }, { orderId: "a", amount: 2 }] }).success).toBe(false);
  });
});

describe("comisión por referido", () => {
  it("5% de la utilidad, redondeado al centavo", () => {
    expect(commissionAmount(100000, 5)).toBe(5000);
    expect(commissionAmount(12345, 5)).toBe(617); // 617.25
    expect(commissionAmount(12350, 5)).toBe(618); // 617.5 redondea hacia arriba
    expect(commissionAmount(10000, 2.5)).toBe(250);
  });
  it("utilidad negativa o cero = 0", () => {
    expect(commissionAmount(-5000, 5)).toBe(0);
    expect(commissionAmount(0, 5)).toBe(0);
    expect(commissionAmount(1000, 0)).toBe(0);
  });
  it("vigencia por día de Honduras (desde y hasta incluidos)", () => {
    const r = { startDate: "2026-10-01", endDate: "2026-12-31" };
    expect(isReferralActive(r, hn("2026-10-01"))).toBe(true);
    expect(isReferralActive(r, hn("2026-12-31"))).toBe(true);
    expect(isReferralActive(r, hn("2026-09-30"))).toBe(false);
    expect(isReferralActive(r, hn("2027-01-01"))).toBe(false);
    // 31 de diciembre 11 p.m. en Honduras sigue vigente aunque en UTC ya sea 1 de enero
    expect(isReferralActive(r, new Date("2027-01-01T05:00:00Z").getTime())).toBe(true);
    expect(isReferralActive({ startDate: "2026-01-01", endDate: null }, hn("2030-05-05"))).toBe(true);
    expect(isReferralActive(null, hn("2026-10-01"))).toBe(false);
  });
  it("el esquema no deja poner fin antes del inicio", () => {
    const ok = { target: "company", targetId: "e1", referral: { referrerId: "r1", pct: 5, basis: "profit", startDate: "2026-10-01", endDate: null } };
    expect(setReferralSchema.safeParse(ok).success).toBe(true);
    expect(setReferralSchema.safeParse({ ...ok, referral: { ...ok.referral, endDate: "2026-09-01" } }).success).toBe(false);
    expect(setReferralSchema.safeParse({ ...ok, referral: null }).success).toBe(true);
  });
});

describe("decisión idempotente de la comisión de una orden", () => {
  const now = { profit: 100000, revenue: 150000, cost: 50000 };
  const pending = { status: "pending" as const, amount: 5000, ...now };
  it("orden pagada con referido vigente: se crea", () => {
    expect(decideCommission({ paidFull: true, existing: null, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("create");
  });
  it("orden pagada sin referido: nada", () => {
    expect(decideCommission({ paidFull: true, existing: null, hasActiveReferral: false, now, recalcAmount: 0 }).kind).toBe("none");
  });
  it("el mismo evento dos veces no duplica ni cambia nada", () => {
    expect(decideCommission({ paidFull: true, existing: pending, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("none");
  });
  it("se anula un pago: la pendiente pasa a anulada; al volver a pagarse se recrea", () => {
    expect(decideCommission({ paidFull: false, existing: pending, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("void");
    const voided = { ...pending, status: "voided" as const, autoVoided: true };
    expect(decideCommission({ paidFull: false, existing: voided, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("none");
    expect(decideCommission({ paidFull: true, existing: voided, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("create");
  });
  it("anulada a mano no se recrea", () => {
    const manual = { ...pending, status: "voided" as const, autoVoided: false };
    expect(decideCommission({ paidFull: true, existing: manual, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("none");
  });
  it("cotización modificada: recalcula solo si sigue pendiente", () => {
    const changed = { profit: 120000, revenue: 170000, cost: 50000 };
    expect(decideCommission({ paidFull: true, existing: pending, hasActiveReferral: true, now: changed, recalcAmount: 6000 }).kind).toBe("recalc");
    const paid = { ...pending, status: "paid" as const };
    expect(decideCommission({ paidFull: true, existing: paid, hasActiveReferral: true, now: changed, recalcAmount: 6000 }).kind).toBe("flag");
    expect(decideCommission({ paidFull: true, existing: { ...paid, needsReview: true }, hasActiveReferral: true, now: changed, recalcAmount: 6000 }).kind).toBe("none");
  });
  it("pagada y la orden vuelve a tener saldo: no se toca, se avisa", () => {
    const paid = { ...pending, status: "paid" as const };
    expect(decideCommission({ paidFull: false, existing: paid, hasActiveReferral: true, now, recalcAmount: 5000 }).kind).toBe("flag");
  });
});

describe("utilidad de una orden (misma lógica que Finanzas)", () => {
  const item = (p: Partial<QuoteItem>): QuoteItem => ({
    id: "i", type: "labor", description: "x", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true, lineTotal: 0, ...p,
  });
  it("ingreso sin ISV, costo por línea y repuestos con su costo", () => {
    const q = {
      items: [
        item({ type: "labor", qty: 2, unitCost: 10000, lineTotal: 60000 }),
        item({ type: "part", productId: "p1", qty: 2, unitCost: 0, lineTotal: 40000 }),
        item({ type: "part", productId: "p2", qty: 1, unitCost: 0, lineTotal: 10000 }),
        item({ type: "part", productId: null, qty: 1, unitCost: 0, lineTotal: 5000 }),
      ],
      totals: { subtotal: 115000, discount: 0, tax: 17250, total: 132250 },
    };
    const f = computeOrderFinance({ totals: q.totals }, q, { movementCost: (pid) => (pid === "p1" ? 12000 : undefined), avgCost: (pid) => (pid === "p2" ? 7000 : undefined) });
    expect(f.revenue).toBe(115000);
    expect(f.tax).toBe(17250);
    expect(f.cost).toBe(20000 + 24000 + 7000);
    expect(f.profit).toBe(115000 - 51000);
    expect(f.missingLines).toBe(1);
    expect(f.lines[2]!.estimated).toBe(true);
  });
  it("sin cotización: subtotal menos descuento, sin costo", () => {
    const f = computeOrderFinance({ totals: { subtotal: 10000, discount: 1000, tax: 1350, total: 10350 } }, null);
    expect(f.revenue).toBe(9000);
    expect(f.profit).toBe(9000);
    expect(f.hasQuote).toBe(false);
  });
  it("costo de repuesto: línea, luego salida de inventario, luego promedio", () => {
    expect(resolvePartCost(500, "p", 300, 200)).toEqual({ unit: 500, missing: false, estimated: false });
    expect(resolvePartCost(0, "p", 300, 200)).toEqual({ unit: 300, missing: false, estimated: false });
    expect(resolvePartCost(0, "p", 0, 200)).toEqual({ unit: 200, missing: false, estimated: true });
    expect(resolvePartCost(0, "p", 0, 0).missing).toBe(true);
  });
  it("promedio ponderado de salidas por orden y producto", () => {
    const m = movementCostMap([
      { type: "out", qty: -1, unitCost: 100, productId: "p", orderId: "o1" },
      { type: "out", qty: -3, unitCost: 200, productId: "p", orderId: "o1" },
      { type: "in", qty: 5, unitCost: 999, productId: "p", orderId: "o1" },
    ], "orderId");
    expect(m.get("o1|p")).toBe(175);
  });
  it("cotización vigente: la activa si está aprobada; si no, la aprobada más reciente", () => {
    const ts = (n: number) => ({ toDate: () => new Date(n), toMillis: () => n });
    const qs = [
      { id: "q1", status: "approved", createdAt: ts(1) },
      { id: "q2", status: "approved", createdAt: ts(3) },
      { id: "q3", status: "superseded", createdAt: ts(5) },
    ];
    expect(pickApprovedQuote(qs, "q1")?.id).toBe("q1");
    expect(pickApprovedQuote(qs, "q3")?.id).toBe("q2");
    expect(pickApprovedQuote(qs, null)?.id).toBe("q2");
    expect(pickApprovedQuote([{ id: "x", status: "draft", createdAt: ts(1) }], null)).toBeNull();
  });
});
