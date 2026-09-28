import {
  addMonths, allocateByShare, breakEvenRevenue, coverageDay, daysInMonth, hnDayKey,
  type Expense, type Payment, type SupplierPayment,
} from "@rapifix/shared";
import { toDate } from "@/lib/format";
import { hnDate, hnParts } from "@/features/reports/period";
import { pct, type Core } from "./data";

/**
 * Cierre del mes (estado de resultados gerencial). Lógica sin interfaz: recibe lo ya cargado por data.ts
 * (loadCore, gastos, pagos) y arma las cifras de un mes.
 */

export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: hnDate(y, m, 1), end: hnDate(y, m + 1, 1) };
}

const monthOf = (d: Date | null | undefined) => (d ? hnDayKey(d).slice(0, 7) : "");
const dayOf = (d: Date | null | undefined) => (d ? Number(hnDayKey(d).slice(8, 10)) : 0);
const isCarwash = (e: { unit?: string | null }) => e.unit === "carwash";
const isShop = (e: { unit?: string | null }) => e.unit === "shop";
const isGeneral = (e: { unit?: string | null }) => !e.unit || e.unit === "general";

export interface MonthFigures {
  month: string;
  /** órdenes entregadas */
  shopRevenue: number;
  /** ventas del POS del taller (unit shop o sin unidad) */
  counterRevenue: number;
  carwashRevenue: number;
  revenue: number;
  shopCost: number;
  carwashCost: number;
  cost: number;
  gross: number;
  grossMargin: number | null;
  fixedPaid: number;
  fixedPending: number;
  fixed: number;
  variable: number;
  net: number;
  netMargin: number | null;
  orders: number;
  sales: number;
  missingLines: number;
  /** utilidad bruta por día (índice 0 = día 1) */
  dailyGross: number[];
}

export function monthFigures(core: Core, month: string, fixedExpenses: Expense[], validExpenses: Expense[]): MonthFigures {
  const dim = daysInMonth(month);
  const dailyGross = new Array<number>(dim).fill(0);
  let shopRevenue = 0, counterRevenue = 0, carwashRevenue = 0, shopCost = 0, carwashCost = 0, orders = 0, sales = 0, missing = 0;
  for (const o of core.orders) {
    if (monthOf(o.at) !== month) continue;
    shopRevenue += o.revenue;
    shopCost += o.cost;
    orders++;
    missing += o.missingLines;
    dailyGross[dayOf(o.at) - 1]! += o.profit;
  }
  for (const s of core.sales) {
    if (monthOf(s.at) !== month) continue;
    if (s.sale.unit === "carwash") {
      carwashRevenue += s.revenue;
      carwashCost += s.cost;
    } else {
      counterRevenue += s.revenue;
      shopCost += s.cost;
    }
    sales++;
    missing += s.missingLines;
    dailyGross[dayOf(s.at) - 1]! += s.profit;
  }
  const fx = fixedExpenses.filter((e) => e.period === month);
  const fixedPaid = fx.filter((e) => e.status === "valid").reduce((a, e) => a + e.amount, 0);
  const fixedPending = fx.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount, 0);
  const variable = validExpenses.filter((e) => !e.fixedCostId && monthOf(toDate(e.date)) === month).reduce((a, e) => a + e.amount, 0);
  const revenue = shopRevenue + counterRevenue + carwashRevenue;
  const cost = shopCost + carwashCost;
  const gross = revenue - cost;
  const fixed = fixedPaid + fixedPending;
  const net = gross - fixed - variable;
  return {
    month, shopRevenue, counterRevenue, carwashRevenue, revenue, shopCost, carwashCost, cost, gross, grossMargin: pct(gross, revenue),
    fixedPaid, fixedPending, fixed, variable, net, netMargin: pct(net, revenue), orders, sales, missingLines: missing, dailyGross,
  };
}

/** Promedio simple de varios meses (para comparar). */
export function averageFigures(list: MonthFigures[]): Pick<MonthFigures, "shopRevenue" | "counterRevenue" | "carwashRevenue" | "revenue" | "cost" | "gross" | "grossMargin" | "fixed" | "variable" | "net" | "netMargin"> {
  const n = list.length || 1;
  const avg = (f: (m: MonthFigures) => number) => Math.round(list.reduce((a, m) => a + f(m), 0) / n);
  const revenue = avg((m) => m.revenue);
  const gross = avg((m) => m.gross);
  const net = avg((m) => m.net);
  return {
    shopRevenue: avg((m) => m.shopRevenue), counterRevenue: avg((m) => m.counterRevenue), carwashRevenue: avg((m) => m.carwashRevenue),
    revenue, cost: avg((m) => m.cost), gross, grossMargin: pct(gross, revenue), fixed: avg((m) => m.fixed), variable: avg((m) => m.variable),
    net, netMargin: pct(net, revenue),
  };
}

// ---------------- Punto de equilibrio ----------------
export interface BreakEven {
  /** ventas necesarias para cubrir los fijos (null si no hay margen bruto positivo) */
  target: number | null;
  progress: number | null;
  /** día en que la utilidad bruta acumulada cubrió los gastos fijos */
  coveredDay: number | null;
  isCurrent: boolean;
  daysElapsed: number;
  daysTotal: number;
  projectedRevenue: number | null;
  projectedNet: number | null;
}

export function breakEven(f: MonthFigures, currentMonth: string): BreakEven {
  const daysTotal = daysInMonth(f.month);
  const isCurrent = f.month === currentMonth;
  const daysElapsed = isCurrent ? hnParts().d : f.month < currentMonth ? daysTotal : 0;
  const target = breakEvenRevenue(f.fixed, f.grossMargin);
  const coveredDay = f.fixed > 0 ? coverageDay(f.dailyGross.slice(0, daysElapsed), f.fixed) : null;
  let projectedRevenue: number | null = null;
  let projectedNet: number | null = null;
  if (isCurrent && daysElapsed > 0 && daysElapsed < daysTotal) {
    const k = daysTotal / daysElapsed;
    projectedRevenue = Math.round(f.revenue * k);
    projectedNet = Math.round(f.gross * k) - f.fixed - Math.round(f.variable * k);
  }
  return { target, progress: target ? (f.revenue / target) * 100 : null, coveredDay, isCurrent, daysElapsed, daysTotal, projectedRevenue, projectedNet };
}

// ---------------- Por unidad de negocio ----------------
export interface UnitFigures {
  unit: "shop" | "carwash";
  label: string;
  revenue: number;
  cost: number;
  gross: number;
  fixedOwn: number;
  variableOwn: number;
  /** parte de los gastos generales (fijos y variables sin negocio), repartida según ingresos */
  generalShare: number;
  net: number;
}

export function unitFigures(f: MonthFigures, fixedExpenses: Expense[], validExpenses: Expense[]): { rows: UnitFigures[]; general: number; hasCarwash: boolean } {
  const fx = fixedExpenses.filter((e) => e.period === f.month);
  const vx = validExpenses.filter((e) => !e.fixedCostId && monthOf(toDate(e.date)) === f.month);
  const sum = (l: Expense[]) => l.reduce((a, e) => a + e.amount, 0);
  const general = sum(fx.filter(isGeneral)) + sum(vx.filter(isGeneral));
  const shopRev = f.shopRevenue + f.counterRevenue;
  const alloc = allocateByShare(general, { shop: shopRev, carwash: f.carwashRevenue });
  const mk = (unit: "shop" | "carwash", label: string, revenue: number, cost: number, own: (e: Expense) => boolean): UnitFigures => {
    const fixedOwn = sum(fx.filter(own));
    const variableOwn = sum(vx.filter(own));
    const gross = revenue - cost;
    return { unit, label, revenue, cost, gross, fixedOwn, variableOwn, generalShare: alloc[unit], net: gross - fixedOwn - variableOwn - alloc[unit] };
  };
  const rows = [mk("shop", "Taller (órdenes y mostrador)", shopRev, f.shopCost, isShop), mk("carwash", "Carwash", f.carwashRevenue, f.carwashCost, isCarwash)];
  const hasCarwash = f.carwashRevenue > 0 || rows[1]!.fixedOwn > 0 || rows[1]!.variableOwn > 0;
  return { rows, general, hasCarwash };
}

// ---------------- Flujo de caja ----------------
export interface CashFlow {
  collected: number;
  expensesPaid: number;
  suppliersPaid: number;
  net: number;
}

export function cashFlow(month: string, payments: Payment[], validExpenses: Expense[], supplierPayments: SupplierPayment[]): CashFlow {
  const collected = payments.filter((p) => monthOf(toDate(p.at)) === month).reduce((a, p) => a + p.amount, 0);
  const expensesPaid = validExpenses.filter((e) => monthOf(toDate(e.date)) === month).reduce((a, e) => a + e.amount, 0);
  const suppliersPaid = supplierPayments.filter((p) => monthOf(toDate(p.at)) === month).reduce((a, p) => a + p.amount, 0);
  return { collected, expensesPaid, suppliersPaid, net: collected - expensesPaid - suppliersPaid };
}

/** Los 3 meses anteriores al mes dado, del más antiguo al más reciente. */
export const previousMonths = (month: string, n = 3) => Array.from({ length: n }, (_, i) => addMonths(month, i - n));
