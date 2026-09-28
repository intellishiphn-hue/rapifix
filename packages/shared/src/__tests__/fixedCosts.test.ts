import { describe, expect, it } from "vitest";
import {
  addMonths, allocateByShare, breakEvenRevenue, coverageDay, daysInMonth, fixedCostAppliesTo, fixedCostInstallments,
  fixedExpenseId, hnNoonMs, isMonthKey, payPendingExpenseSchema, projectMonthEnd, saveFinanceBudgetSchema, saveFixedCostSchema,
} from "../fixedCosts";
import { hnDayKey } from "../operations";

describe("fechas de gastos fijos", () => {
  it("días del mes, incluido febrero bisiesto", () => {
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-12")).toBe(31);
  });

  it("suma y resta meses cruzando el año", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", -3)).toBe("2026-06");
  });

  it("valida claves de mes", () => {
    expect(isMonthKey("2026-09")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-9")).toBe(false);
  });

  it("mensual: usa el día indicado o el último día si el mes es más corto", () => {
    expect(fixedCostInstallments({ frequency: "monthly", dayOfMonth: 5, amount: 1000 }, "2026-09")).toEqual([{ part: 1, day: 5, dayKey: "2026-09-05", amount: 1000 }]);
    expect(fixedCostInstallments({ frequency: "monthly", dayOfMonth: 31, amount: 1000 }, "2026-02")[0]!.dayKey).toBe("2026-02-28");
    expect(fixedCostInstallments({ frequency: "monthly", dayOfMonth: 31, amount: 1000 }, "2026-09")[0]!.day).toBe(30);
  });

  it("quincenal: dos pagos el 15 y el último día, la mitad cada uno", () => {
    const q = fixedCostInstallments({ frequency: "biweekly", dayOfMonth: 1, amount: 1_200_000 }, "2026-09");
    expect(q).toEqual([
      { part: 1, day: 15, dayKey: "2026-09-15", amount: 600_000 },
      { part: 2, day: 30, dayKey: "2026-09-30", amount: 600_000 },
    ]);
    const odd = fixedCostInstallments({ frequency: "biweekly", dayOfMonth: 1, amount: 1001 }, "2026-02");
    expect(odd.map((x) => x.amount)).toEqual([500, 501]);
    expect(odd[1]!.dayKey).toBe("2026-02-28");
  });

  it("aplica solo si está activo y dentro del rango de meses", () => {
    const fc = { active: true, startMonth: "2026-03", endMonth: "2026-10" };
    expect(fixedCostAppliesTo(fc, "2026-02")).toBe(false);
    expect(fixedCostAppliesTo(fc, "2026-03")).toBe(true);
    expect(fixedCostAppliesTo(fc, "2026-10")).toBe(true);
    expect(fixedCostAppliesTo(fc, "2026-11")).toBe(false);
    expect(fixedCostAppliesTo({ ...fc, endMonth: null }, "2030-01")).toBe(true);
    expect(fixedCostAppliesTo({ ...fc, active: false }, "2026-05")).toBe(false);
  });

  it("ids determinísticos", () => {
    expect(fixedExpenseId("abc", "2026-09", 1)).toBe("fc_abc_2026-09_1");
    expect(fixedExpenseId("abc", "2026-09", 2)).toBe("fc_abc_2026-09_2");
  });

  it("mediodía de Honduras cae en el mismo día", () => {
    expect(hnDayKey(hnNoonMs("2026-09-30"))).toBe("2026-09-30");
    expect(hnDayKey(hnNoonMs("2026-01-01"))).toBe("2026-01-01");
  });
});

describe("punto de equilibrio y proyección", () => {
  it("ventas necesarias = fijos / margen bruto", () => {
    expect(breakEvenRevenue(40_000_00, 40)).toBe(100_000_00);
    expect(breakEvenRevenue(0, 40)).toBe(0);
    expect(breakEvenRevenue(40_000_00, 0)).toBeNull();
    expect(breakEvenRevenue(40_000_00, -5)).toBeNull();
    expect(breakEvenRevenue(40_000_00, null)).toBeNull();
  });

  it("proyecta a fin de mes por ritmo diario", () => {
    expect(projectMonthEnd(30_000, 10, 30)).toBe(90_000);
    expect(projectMonthEnd(30_000, 30, 30)).toBe(30_000);
    expect(projectMonthEnd(30_000, 0, 30)).toBe(30_000);
  });

  it("día en que lo acumulado alcanza la meta", () => {
    expect(coverageDay([10, 10, 10, 10], 25)).toBe(3);
    expect(coverageDay([10, 10], 25)).toBeNull();
    expect(coverageDay([5], 0)).toBe(1);
  });

  it("reparte proporcional y la suma es exacta", () => {
    const r = allocateByShare(1000, { shop: 2, carwash: 1 });
    expect(r.shop + r.carwash).toBe(1000);
    expect(r.shop).toBe(667);
    expect(allocateByShare(1001, { shop: 0, carwash: 0 })).toEqual({ shop: 501, carwash: 500 });
    expect(allocateByShare(0, { shop: 5, carwash: 5 })).toEqual({ shop: 0, carwash: 0 });
  });
});

describe("esquemas", () => {
  const base = {
    name: "Alquiler del local", category: "Alquiler", amount: 25_000_00, frequency: "monthly", dayOfMonth: 5, unit: "general",
    employeeName: "", defaultMethod: "transfer", notes: "", active: true, startMonth: "2026-09",
  };
  it("gasto fijo válido", () => expect(saveFixedCostSchema.safeParse(base).success).toBe(true));
  it("rechaza categoría desconocida, monto 0 y mes final antes del inicial", () => {
    expect(saveFixedCostSchema.safeParse({ ...base, category: "Fiestas" }).success).toBe(false);
    expect(saveFixedCostSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(saveFixedCostSchema.safeParse({ ...base, endMonth: "2026-08" }).success).toBe(false);
    expect(saveFixedCostSchema.safeParse({ ...base, dayOfMonth: 32 }).success).toBe(false);
  });
  it("marcar pagado por transferencia exige banco", () => {
    const pay = { expenseId: "fc_a_2026-09_1", amount: 100, date: Date.now(), method: "transfer", reference: "" };
    expect(payPendingExpenseSchema.safeParse(pay).success).toBe(false);
    expect(payPendingExpenseSchema.safeParse({ ...pay, bank: "BAC" }).success).toBe(true);
    expect(payPendingExpenseSchema.safeParse({ ...pay, method: "cash" }).success).toBe(true);
  });
  it("presupuesto solo con categorías conocidas", () => {
    expect(saveFinanceBudgetSchema.safeParse({ budgets: { Publicidad: 5000 } }).success).toBe(true);
    expect(saveFinanceBudgetSchema.safeParse({ budgets: { Viajes: 5000 } }).success).toBe(false);
  });
});
