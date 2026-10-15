import { describe, expect, it } from "vitest";
import {
  couponAmount, couponDayLabel, couponState, customerKeysFor, describeCoupon, distributeDiscount, evaluateCoupon, generateCouponCode,
  normalizeCouponCode, saveCouponSchema, type Coupon, type CouponContext,
} from "../coupons";
import { computeQuote, diffQuotes, lineBeforeCoupon } from "../quote";
import { computeWashCharge, netOf } from "../carwash";

// 15 de octubre de 2026, 10:00 hora de Honduras
const NOW = Date.UTC(2026, 9, 15, 16, 0, 0);

const coupon = (o: Partial<Coupon> = {}): Coupon => ({
  id: "PROMO10", code: "PROMO10", name: "Promo 10%", description: "", type: "percent", value: 10, maxDiscount: null, minPurchase: 0,
  appliesTo: "all", units: ["shop", "carwash", "pos"], validFrom: "2026-01-01", validUntil: null, maxUses: null, maxUsesPerCustomer: 1,
  firstVisitOnly: false, customerApplicable: true, companyId: null, excludeCompanies: true, active: true, usesCount: 0, usesReserved: 0,
  discountGiven: 0, createdAt: null as never, updatedAt: null as never, createdBy: "a", updatedBy: "a", ...o,
});
const ctx = (o: Partial<CouponContext> = {}): CouponContext => ({
  unit: "shop", nowMs: NOW, lines: [{ kind: "labor", amount: 100000 }, { kind: "parts", amount: 200000 }],
  hasIdentity: true, customerUses: 0, isFirstVisit: null, companyId: null, ...o,
});

describe("códigos", () => {
  it("normaliza a mayúsculas sin espacios", () => expect(normalizeCouponCode(" promo 10 ")).toBe("PROMO10"));
  it("genera códigos válidos y sin letras confusas", () => {
    let i = 0;
    const code = generateCouponCode(() => i++ % 32, 6, "rapi fix");
    expect(code).toMatch(/^RAPIFIX-[A-Z2-9]{6}$/);
    expect(generateCouponCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it("el esquema valida código, porcentaje y fechas", () => {
    const base = {
      editing: false, code: "verano-26", name: "Verano", description: "", type: "percent", value: 15, maxDiscount: 50000, minPurchase: 0, appliesTo: "labor",
      units: ["shop"], validFrom: "2026-10-01", validUntil: "2026-12-31", maxUses: null, maxUsesPerCustomer: 1, firstVisitOnly: false,
      customerApplicable: true, companyId: null, excludeCompanies: true, active: true,
    };
    const ok = saveCouponSchema.safeParse(base);
    expect(ok.success && ok.data.code).toBe("VERANO-26");
    expect(saveCouponSchema.safeParse({ ...base, code: "AB" }).success).toBe(false);
    expect(saveCouponSchema.safeParse({ ...base, code: "ÑANDÚ" }).success).toBe(false);
    expect(saveCouponSchema.safeParse({ ...base, value: 120 }).success).toBe(false);
    expect(saveCouponSchema.safeParse({ ...base, validUntil: "2026-09-01" }).success).toBe(false);
    expect(saveCouponSchema.safeParse({ ...base, units: [] }).success).toBe(false);
  });
});

describe("identidad del cliente", () => {
  it("arma claves de cliente, teléfono y placa", () => {
    expect(customerKeysFor({ customerId: "c1", phone: "9999-8888", plate: "hab 1234" })).toEqual(["c:c1", "p:+50499998888", "v:HAB1234"]);
    expect(customerKeysFor({ phone: "+1 305 555 1234" })).toEqual(["p:+13055551234"]);
    expect(customerKeysFor({})).toEqual([]);
  });
});

describe("couponAmount", () => {
  it("porcentaje sobre todo, con tope", () => {
    expect(couponAmount(coupon(), ctx().lines).discount).toBe(30000);
    expect(couponAmount(coupon({ maxDiscount: 20000 }), ctx().lines).discount).toBe(20000);
  });
  it("solo líneas elegibles", () => {
    const r = couponAmount(coupon({ appliesTo: "labor", value: 15 }), ctx().lines);
    expect(r).toMatchObject({ ok: true, eligible: 100000, discount: 15000 });
  });
  it("monto fijo no excede el subtotal elegible", () => {
    expect(couponAmount(coupon({ type: "fixed", value: 500000, appliesTo: "labor" }), ctx().lines).discount).toBe(100000);
    expect(couponAmount(coupon({ type: "fixed", value: 25000 }), ctx().lines).discount).toBe(25000);
  });
  it("compra mínima y sin líneas elegibles", () => {
    const r = couponAmount(coupon({ minPurchase: 400000 }), ctx().lines);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Compra mínima L 4,000.00 (sin ISV).");
    const none = couponAmount(coupon({ appliesTo: "services" }), ctx().lines);
    expect(none.reason).toContain("solo en servicios");
  });
  it("redondea el porcentaje al centavo", () => {
    expect(couponAmount(coupon({ value: 15 }), [{ kind: "labor", amount: 333 }]).discount).toBe(50);
  });
});

describe("distributeDiscount", () => {
  it("reparte en proporción y suma exacto", () => {
    const s = distributeDiscount([100000, 200000, 50000], [true, true, false], 10001);
    expect(s[2]).toBe(0);
    expect(s[0]! + s[1]!).toBe(10001);
    expect(s[0]).toBe(3334);
    expect(s[1]).toBe(6667);
  });
  it("nunca supera la línea ni el total elegible", () => {
    expect(distributeDiscount([1, 1, 1], [true, true, true], 10)).toEqual([1, 1, 1]);
    expect(distributeDiscount([0, 0], [true, true], 100)).toEqual([0, 0]);
    const s = distributeDiscount([333, 333, 334], [true, true, true], 100);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("evaluateCoupon", () => {
  it("aplica un cupón válido", () => expect(evaluateCoupon(coupon(), ctx())).toEqual({ ok: true, discount: 30000, eligible: 300000, reason: null }));
  it("inactivo", () => expect(evaluateCoupon(coupon({ active: false }), ctx()).reason).toBe("Este cupón ya no está activo."));
  it("vigencia en hora de Honduras (inclusive)", () => {
    expect(evaluateCoupon(coupon({ validUntil: "2026-10-15" }), ctx()).ok).toBe(true);
    expect(evaluateCoupon(coupon({ validUntil: "2026-10-14" }), ctx()).reason).toBe("Este cupón venció el 14 de octubre.");
    // 15 oct 23:30 en Honduras = 16 oct 05:30 UTC: todavía es 15 en Honduras
    expect(evaluateCoupon(coupon({ validUntil: "2026-10-15" }), ctx({ nowMs: Date.UTC(2026, 9, 16, 5, 30) })).ok).toBe(true);
    expect(evaluateCoupon(coupon({ validUntil: "2025-12-31" }), ctx()).reason).toBe("Este cupón venció el 31 de diciembre de 2025.");
    expect(evaluateCoupon(coupon({ validFrom: "2026-11-01" }), ctx()).reason).toBe("Este cupón es válido a partir del 1 de noviembre.");
  });
  it("unidad de negocio", () => {
    expect(evaluateCoupon(coupon({ units: ["carwash"] }), ctx()).reason).toBe("Este cupón no aplica en taller (solo en carwash).");
    expect(evaluateCoupon(coupon({ units: ["pos", "shop"] }), ctx({ unit: "pos" })).ok).toBe(true);
  });
  it("usos totales (cuenta reservados y usados)", () => {
    expect(evaluateCoupon(coupon({ maxUses: 5, usesReserved: 5 }), ctx()).reason).toBe("Este cupón ya se agotó.");
    expect(evaluateCoupon(coupon({ maxUses: 5, usesReserved: 4 }), ctx()).ok).toBe(true);
  });
  it("una vez por cliente (por cualquiera de sus identidades)", () => {
    expect(evaluateCoupon(coupon(), ctx({ customerUses: 1 })).reason).toBe("Este cupón ya fue usado por este cliente.");
    expect(evaluateCoupon(coupon({ maxUsesPerCustomer: 3 }), ctx({ customerUses: 3 })).reason).toContain("3 veces");
    expect(evaluateCoupon(coupon({ maxUsesPerCustomer: 0 }), ctx({ customerUses: 50, hasIdentity: false })).ok).toBe(true);
    expect(evaluateCoupon(coupon(), ctx({ hasIdentity: false })).reason).toContain("indique el cliente");
  });
  it("solo primera visita", () => {
    expect(evaluateCoupon(coupon({ firstVisitOnly: true }), ctx({ isFirstVisit: false })).reason).toContain("clientes nuevos");
    expect(evaluateCoupon(coupon({ firstVisitOnly: true }), ctx({ isFirstVisit: true })).ok).toBe(true);
  });
  it("empresas", () => {
    expect(evaluateCoupon(coupon(), ctx({ companyId: "emp1" })).reason).toContain("vehículos de empresa");
    expect(evaluateCoupon(coupon({ excludeCompanies: false }), ctx({ companyId: "emp1" })).ok).toBe(true);
    expect(evaluateCoupon(coupon({ companyId: "emp1", companyName: "INTELLISHIP" }), ctx({ companyId: "emp2" })).reason).toBe("Este cupón es solo para vehículos de INTELLISHIP.");
    expect(evaluateCoupon(coupon({ companyId: "emp1" }), ctx({ companyId: "emp1" })).ok).toBe(true);
  });
  it("desde el link del cliente solo si está permitido", () => {
    expect(evaluateCoupon(coupon({ customerApplicable: false }), ctx({ byCustomer: true })).ok).toBe(false);
    expect(evaluateCoupon(coupon({ customerApplicable: false }), ctx()).ok).toBe(true);
  });
  it("compra mínima en el mensaje", () => {
    expect(evaluateCoupon(coupon({ minPurchase: 100000 }), ctx({ lines: [{ kind: "labor", amount: 99999 }] })).reason).toBe("Compra mínima L 1,000.00 (sin ISV).");
  });
});

describe("estado y descripción", () => {
  it("estado", () => {
    expect(couponState(coupon(), NOW)).toBe("active");
    expect(couponState(coupon({ active: false }), NOW)).toBe("inactive");
    expect(couponState(coupon({ validUntil: "2026-10-01" }), NOW)).toBe("expired");
    expect(couponState(coupon({ maxUses: 2, usesReserved: 2 }), NOW)).toBe("exhausted");
    expect(couponState(coupon({ validFrom: "2026-12-01" }), NOW)).toBe("scheduled");
  });
  it("vista previa en palabras", () => {
    expect(describeCoupon(coupon({ value: 15, appliesTo: "labor", maxDiscount: 50000, validUntil: "2026-12-31" })))
      .toBe("15% de descuento en mano de obra, máximo L 500.00, una vez por cliente, hasta el 31/12/2026");
    expect(couponDayLabel("2026-10-30", "2026-10-15")).toBe("30 de octubre");
  });
});

const qline = (o: Partial<Parameters<typeof computeQuote>[0][number]>) => ({
  id: "1", type: "part" as const, description: "x", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true, ...o,
});
const rule = (o: Partial<Coupon> = {}) => ({ code: "X", name: "X", type: "percent" as const, value: 10, maxDiscount: null, minPurchase: 0, appliesTo: "all" as const, ...o });

describe("computeQuote con cupón", () => {
  it("sin cupón no cambia nada", () => {
    const r = computeQuote([qline({ unitPrice: 100000 })], 15);
    expect(r.totals).toEqual({ subtotal: 100000, discount: 0, tax: 15000, total: 115000 });
    expect("couponDiscount" in r.items[0]!).toBe(false);
  });
  it("el cupón se resta antes del ISV y se reparte entre líneas elegibles", () => {
    const r = computeQuote(
      [qline({ id: "a", type: "labor", unitPrice: 100000 }), qline({ id: "b", type: "part", unitPrice: 200000, discount: 20000 }), qline({ id: "c", type: "labor", unitPrice: 50000, taxable: false })],
      15,
      rule({ value: 20, appliesTo: "labor" }),
    );
    // elegible: 100000 + 50000 = 150000 -> 30000
    expect(r.items.map((i) => i.couponDiscount)).toEqual([20000, 0, 10000]);
    expect(r.items.map((i) => i.lineTotal)).toEqual([80000, 180000, 40000]);
    expect(r.totals).toEqual({ subtotal: 350000, discount: 50000, couponDiscount: 30000, tax: Math.round(((80000 + 180000) * 15) / 100), total: 300000 + 39000 });
    expect(lineBeforeCoupon(r.items[0]!)).toBe(100000);
  });
  it("redondeo de centavos e ISV", () => {
    const r = computeQuote([qline({ id: "a", unitPrice: 333 }), qline({ id: "b", unitPrice: 333 }), qline({ id: "c", unitPrice: 334 })], 15, rule({ type: "fixed", value: 100 }));
    expect(r.items.reduce((a, i) => a + (i.couponDiscount ?? 0), 0)).toBe(100);
    expect(r.totals.discount).toBe(100);
    expect(r.totals.tax).toBe(135);
    expect(r.totals.total).toBe(1035);
  });
  it("si ya no cumple la compra mínima, no descuenta y dice por qué", () => {
    const r = computeQuote([qline({ unitPrice: 50000 })], 15, rule({ minPurchase: 100000 }));
    expect(r.totals.couponDiscount).toBe(0);
    expect(r.couponIssue).toContain("Compra mínima");
  });
  it("diffQuotes compara las líneas sin el cupón", () => {
    const a = computeQuote([qline({ id: "a", type: "labor", unitPrice: 100000 })], 15, rule());
    const b = computeQuote([qline({ id: "a", type: "labor", unitPrice: 100000 }), qline({ id: "b", type: "labor", unitPrice: 100000 })], 15, rule());
    const d = diffQuotes(a, b);
    expect(d.changed).toHaveLength(0);
    expect(d.added[0]!.lineTotal).toBe(100000);
    expect(d.difference).toBe(b.totals.total - a.totals.total);
  });
});

describe("computeWashCharge con cupón", () => {
  it("sin ISV y ISV sumado: cupón exacto", () => {
    const r = computeWashCharge([25000, 4000], 15, "exempt", 0, 2900);
    expect(r.totals.total).toBe(26100);
    expect(r.totals.couponDiscount).toBe(2900);
    expect(r.lines.map((l) => l.discount)).toEqual([2500, 400]);
    const add = computeWashCharge([25000], 15, "add", 0, 2500);
    expect(add.totals).toMatchObject({ subtotal: 25000, discount: 2500, couponDiscount: 2500, tax: 3375, total: 25875 });
  });
  it("precios con ISV incluido: el total baja exactamente lo del cupón", () => {
    const base = computeWashCharge([25000, 4000], 15, "included");
    const r = computeWashCharge([25000, 4000], 15, "included", 0, 2900);
    expect(r.totals.total).toBe(base.totals.total - 2900);
    expect(r.totals.couponDiscount).toBeGreaterThan(0);
    expect(r.totals.couponDiscount!).toBeLessThanOrEqual(r.totals.discount);
    expect(netOf(r.totals)).toBe(r.totals.subtotal - r.totals.discount);
  });
  it("cupón y descuento manual juntos", () => {
    const r = computeWashCharge([25000, 4000], 15, "exempt", 1000, 2900);
    expect(r.totals.total).toBe(29000 - 3900);
    expect(r.totals.couponDiscount).toBe(2900);
  });
  it("sin cupón no agrega el campo", () => {
    expect("couponDiscount" in computeWashCharge([25000], 15, "included").totals).toBe(false);
  });
});
