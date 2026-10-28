import { describe, expect, it } from "vitest";
import { computeQuote, quoteItemInput, type QuoteItem } from "../quote";
import { computeOrderFinance } from "../orderFinance";
import { applyTechPayChanges, internalOnlyChanges, quoteProfit, techPayChangesText, updateQuoteCostsSchema } from "../quoteCosts";
import { isOperatingExpense } from "../finance";
import {
  computeTechPay, decideTechEarning, defaultShare, sanitizeTechPay, techPayBase, techPayDefaultLabel, techPayKey, techPaySharesSchema, type TechPayShare,
} from "../techPay";
import type { CouponRule } from "../coupons";

const line = (o: Partial<Parameters<typeof computeQuote>[0][number]>) => ({
  id: "1", type: "labor" as const, description: "Trabajo", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true, ...o,
});
const anthony = (o: Partial<TechPayShare> = {}): TechPayShare => ({ employeeId: "e1", employeeName: "Anthony", mode: "percent", percent: 30, ...o });
const luis = (o: Partial<TechPayShare> = {}): TechPayShare => ({ employeeId: "e2", employeeName: "Luis", mode: "percent", percent: 20, ...o });

describe("computeTechPay", () => {
  it("porcentaje sobre el neto de la línea", () => {
    const r = computeTechPay(computeQuote([line({ id: "a", unitPrice: 100000, techPay: [anthony()] })], 15).items);
    expect(r.total).toBe(30000);
    expect(r.byItem).toEqual({ a: 30000 });
    expect(r.byEmployee).toEqual([{ employeeId: "e1", employeeName: "Anthony", total: 30000, lines: [{ itemId: "a", description: "Trabajo", type: "labor", base: 100000, mode: "percent", percent: 30, amount: 30000 }] }]);
  });

  it("monto fijo por trabajo: no se multiplica por la cantidad", () => {
    const r = computeTechPay(computeQuote([line({ id: "a", type: "service", qty: 4, unitPrice: 25000, techPay: [anthony({ mode: "fixed", percent: null, amount: 50000 })] })], 15).items);
    expect(r.total).toBe(50000);
    expect(r.lines[0]!.shares[0]).toMatchObject({ mode: "fixed", percent: null, amount: 50000 });
  });

  it("reparte entre dos técnicos en la misma línea y suma por empleado entre líneas", () => {
    const items = computeQuote([
      line({ id: "a", unitPrice: 100000, techPay: [anthony({ percent: 15 }), luis({ percent: 15 })] }),
      line({ id: "b", type: "service", unitPrice: 40000, techPay: [anthony({ mode: "fixed", percent: null, amount: 10000 })] }),
    ], 15).items;
    const r = computeTechPay(items);
    expect(r.lines.map((l) => l.total)).toEqual([30000, 10000]);
    expect(r.total).toBe(40000);
    const a = r.byEmployee.find((e) => e.employeeId === "e1")!;
    const l = r.byEmployee.find((e) => e.employeeId === "e2")!;
    expect(a.total).toBe(25000);
    expect(a.lines).toHaveLength(2);
    expect(l.total).toBe(15000);
  });

  it("el descuento de la línea y el cupón reducen la base", () => {
    const coupon: CouponRule = { code: "X", name: "X", type: "fixed", value: 20000, maxDiscount: null, minPurchase: 0, appliesTo: "all" };
    const items = computeQuote([
      line({ id: "a", unitPrice: 100000, discount: 10000, techPay: [anthony({ percent: 10 })] }),
      line({ id: "p", type: "part", unitPrice: 100000 }),
    ], 15, coupon).items;
    const a = items.find((i) => i.id === "a")!;
    expect(a.couponDiscount).toBeGreaterThan(0);
    const base = 100000 - 10000 - (a.couponDiscount ?? 0);
    expect(techPayBase(a)).toBe(base);
    expect(base).toBe(a.lineTotal);
    expect(computeTechPay(items).total).toBe(Math.round(base * 0.1));
  });

  it("ignora repuestos y otros cargos aunque traigan pago", () => {
    const r = computeTechPay([
      { ...line({ id: "p", type: "part", unitPrice: 100000 }), techPay: [anthony()] },
      { ...line({ id: "o", type: "other", unitPrice: 100000 }), techPay: [anthony()] },
    ]);
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("el ISV no entra en la base", () => {
    const taxed = computeQuote([line({ id: "a", unitPrice: 100000, taxable: true, techPay: [anthony({ percent: 50 })] })], 15);
    expect(taxed.totals.total).toBe(115000);
    expect(computeTechPay(taxed.items).total).toBe(50000);
  });

  it("redondea a centavos por técnico y línea", () => {
    // 333.33 × 12.5 % = 41.66625 → 41.67 ; 333.33 × 33.33 % = 111.0989 → 111.10
    const items = computeQuote([line({ id: "a", unitPrice: 33333, techPay: [anthony({ percent: 12.5 }), luis({ percent: 33.33 })] })], 15).items;
    const r = computeTechPay(items);
    expect(r.lines[0]!.shares.map((s) => s.amount)).toEqual([4167, 11110]);
    expect(r.total).toBe(15277);
  });

  it("computeQuote conserva el pago a técnicos de cada línea (también con cupón)", () => {
    const coupon: CouponRule = { code: "X", name: "X", type: "percent", value: 10, maxDiscount: null, minPurchase: 0, appliesTo: "all" };
    const withCoupon = computeQuote([line({ id: "a", unitPrice: 100000, techPay: [anthony()] })], 15, coupon).items[0]!;
    expect(withCoupon.techPay).toEqual([anthony()]);
    expect(computeQuote([line({ id: "a", unitPrice: 100000, techPay: [anthony()] })], 15).items[0]!.techPay).toEqual([anthony()]);
  });
});

describe("validación y limpieza", () => {
  it("acepta hasta 3 técnicos, sin repetir", () => {
    expect(techPaySharesSchema.safeParse([anthony(), luis()]).success).toBe(true);
    expect(techPaySharesSchema.safeParse([anthony(), anthony()]).success).toBe(false);
    const four = [1, 2, 3, 4].map((n) => anthony({ employeeId: `e${n}` }));
    expect(techPaySharesSchema.safeParse(four).success).toBe(false);
  });

  it("porcentaje 0..100 con máximo 2 decimales; monto fijo en centavos enteros", () => {
    expect(techPaySharesSchema.safeParse([anthony({ percent: 12.5 })]).success).toBe(true);
    expect(techPaySharesSchema.safeParse([anthony({ percent: 101 })]).success).toBe(false);
    expect(techPaySharesSchema.safeParse([anthony({ percent: 12.555 })]).success).toBe(false);
    expect(techPaySharesSchema.safeParse([anthony({ mode: "fixed", percent: null, amount: 10.5 })]).success).toBe(false);
    expect(techPaySharesSchema.safeParse([anthony({ mode: "fixed", percent: null, amount: null })]).success).toBe(false);
  });

  it("quoteItemInput admite techPay y sanitizeTechPay lo quita de repuestos", () => {
    const parsed = quoteItemInput.parse({ ...line({ id: "p", type: "part" }), techPay: [anthony()] });
    expect(parsed.techPay).toHaveLength(1);
    const [clean] = sanitizeTechPay([parsed]);
    expect("techPay" in clean!).toBe(false);
    const [kept] = sanitizeTechPay([{ ...parsed, type: "labor" as const }]);
    expect(kept!.techPay).toEqual([anthony()]);
  });

  it("configuración por defecto", () => {
    expect(defaultShare({ id: "e1", displayName: "Anthony" }, { mode: "percent", percent: 30, fixedAmount: 0 })).toEqual(anthony());
    expect(defaultShare({ id: "e1", displayName: "Anthony" }, { mode: "none", percent: 0, fixedAmount: 0 })).toBeNull();
    expect(techPayDefaultLabel({ mode: "fixed", percent: 0, fixedAmount: 50000 })).toBe("L 500.00 por trabajo");
  });
});

describe("costo de la orden y utilidad", () => {
  const items = (): QuoteItem[] => computeQuote([
    line({ id: "a", unitPrice: 100000, unitCost: 0, techPay: [anthony()] }),
    line({ id: "p", type: "part", unitPrice: 50000, unitCost: 30000 }),
  ], 15).items;

  it("computeOrderFinance suma el pago a técnicos al costo (una sola vez)", () => {
    const q = { items: items(), totals: computeQuote(items(), 15).totals };
    const f = computeOrderFinance({ totals: q.totals }, q);
    expect(f.revenue).toBe(150000);
    expect(f.techPay).toBe(30000);
    expect(f.cost).toBe(60000); // 30,000 repuesto + 30,000 técnico
    expect(f.profit).toBe(90000);
    expect(f.lines.find((l) => l.item.id === "a")).toMatchObject({ cost: 30000, techPay: 30000 });
  });

  it("quoteProfit resta el pago a técnicos igual que Finanzas", () => {
    expect(quoteProfit(items())).toBe(90000);
  });

  it("el gasto del pago a técnicos no es gasto operativo (ya está en el costo)", () => {
    expect(isOperatingExpense({ techPayoutId: "x" })).toBe(false);
    expect(isOperatingExpense({ techPayoutId: null })).toBe(true);
    expect(isOperatingExpense({})).toBe(true);
  });
});

describe("editar pago a técnicos en cotizaciones aprobadas", () => {
  const items = (): QuoteItem[] => computeQuote([
    line({ id: "a", unitPrice: 100000 }),
    line({ id: "p", type: "part", unitPrice: 50000 }),
  ], 15).items;

  it("aplica el pago sin tocar precios ni totales", () => {
    const before = items();
    const r = applyTechPayChanges(before, [{ itemId: "a", techPay: [anthony()] }], { strict: true });
    expect(r.items[0]!.techPay).toEqual([anthony()]);
    expect(computeQuote(r.items, 15).totals).toEqual(computeQuote(before, 15).totals);
    expect(r.changes).toHaveLength(1);
    expect(techPayChangesText(r.changes)).toBe("Trabajo: pago a técnico sin pago → Anthony 30 % (L 300.00)");
  });

  it("null quita el pago; en repuestos es error en modo estricto", () => {
    const withPay = applyTechPayChanges(items(), [{ itemId: "a", techPay: [anthony()] }]).items;
    const r = applyTechPayChanges(withPay, [{ itemId: "a", techPay: null }], { strict: true });
    expect("techPay" in r.items[0]!).toBe(false);
    expect(() => applyTechPayChanges(items(), [{ itemId: "p", techPay: [anthony()] }], { strict: true })).toThrow();
  });

  it("onlyIfTechPay: no pisa un pago que la modificación ya cambió", () => {
    const rev = applyTechPayChanges(items(), [{ itemId: "a", techPay: [luis()] }]).items;
    const r = applyTechPayChanges(rev, [{ itemId: "a", techPay: [anthony()] }], { onlyIfTechPay: { a: techPayKey([]) } });
    expect(r.changes).toEqual([]);
  });

  it("la callable acepta solo pago a técnicos (sin costo)", () => {
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [{ itemId: "a", techPay: [anthony()] }] }).success).toBe(true);
  });

  it("internalOnlyChanges detecta modificación que solo cambia el pago a técnicos", () => {
    const base = items();
    const next = applyTechPayChanges(base, [{ itemId: "a", techPay: [anthony()] }]).items;
    expect(internalOnlyChanges(base, next)).toEqual({ costs: {}, techPay: { a: [anthony()] } });
    expect(internalOnlyChanges(base, next.map((it) => (it.id === "a" ? { ...it, unitPrice: 1 } : it)))).toBeNull();
  });
});

describe("decideTechEarning", () => {
  const computed = { lines: [{ itemId: "a", description: "x", type: "labor" as const, base: 100000, mode: "percent" as const, percent: 30, amount: 30000 }], total: 30000 };
  it("crea al quedar pagada; no hace nada si no cambió", () => {
    expect(decideTechEarning({ paidFull: true, existing: null, computed })).toEqual({ kind: "create" });
    expect(decideTechEarning({ paidFull: true, existing: { status: "pending", ...computed }, computed })).toEqual({ kind: "none" });
  });
  it("pendiente: recalcula si cambió y se elimina si la orden vuelve a tener saldo o se quita el pago", () => {
    const changed = { ...computed, total: 20000, lines: [{ ...computed.lines[0]!, percent: 20, amount: 20000 }] };
    expect(decideTechEarning({ paidFull: true, existing: { status: "pending", ...computed }, computed: changed })).toEqual({ kind: "recalc" });
    expect(decideTechEarning({ paidFull: false, existing: { status: "pending", ...computed }, computed })).toEqual({ kind: "delete" });
    expect(decideTechEarning({ paidFull: true, existing: { status: "pending", ...computed }, computed: null })).toEqual({ kind: "delete" });
  });
  it("pagado: no se toca, queda para revisión una sola vez", () => {
    const changed = { ...computed, total: 1 };
    expect(decideTechEarning({ paidFull: true, existing: { status: "paid", ...computed }, computed: changed }).kind).toBe("flag");
    expect(decideTechEarning({ paidFull: false, existing: { status: "paid", ...computed }, computed }).kind).toBe("flag");
    expect(decideTechEarning({ paidFull: false, existing: { status: "paid", needsReview: true, ...computed }, computed })).toEqual({ kind: "none" });
    expect(decideTechEarning({ paidFull: true, existing: { status: "paid", ...computed }, computed })).toEqual({ kind: "none" });
  });
  it("sin pago a técnico y sin registro: nada", () => {
    expect(decideTechEarning({ paidFull: true, existing: null, computed: null })).toEqual({ kind: "none" });
  });
});
