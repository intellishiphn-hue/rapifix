import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import { MANUAL_PAYMENT_METHODS, methodNeedsBank, type ManualPaymentMethod } from "./catalog";
import { EXPENSE_CATEGORIES, EXPENSE_UNITS, expenseReceiptPathRe, type ExpenseUnit } from "./finance";

/**
 * Gastos fijos: plantillas de gastos que se repiten cada mes (alquiler, salarios, luz, internet...).
 * Cada mes se generan como gastos "pendientes" (por pagar) en la colección de gastos.
 * El monto siempre es el total del MES; si es quincenal se divide en dos pagos.
 */

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const id = z.string().min(1).max(128);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);

export const FIXED_COST_FREQUENCIES = ["monthly", "biweekly"] as const;
export type FixedCostFrequency = (typeof FIXED_COST_FREQUENCIES)[number];
export const FIXED_COST_FREQUENCY_LABELS: Record<FixedCostFrequency, string> = {
  monthly: "Mensual",
  biweekly: "Quincenal",
};

export interface FixedCost extends BaseDoc {
  name: string;
  category: string;
  /** total del mes en centavos (quincenal = dos pagos de la mitad) */
  amount: number;
  frequency: FixedCostFrequency;
  /** día de pago para los mensuales (1-31; si el mes es más corto, el último día) */
  dayOfMonth: number;
  unit: ExpenseUnit;
  employeeId: string | null;
  employeeName: string;
  supplierId: string | null;
  supplierName: string;
  defaultMethod: ManualPaymentMethod;
  notes: string;
  active: boolean;
  /** primer mes que aplica "YYYY-MM" */
  startMonth: string;
  /** último mes que aplica (opcional) */
  endMonth: string | null;
}

/** financeMeta/fixedCosts */
export interface FixedCostsMeta {
  generated?: Record<string, boolean>;
  updatedAt?: TimestampLike;
}

/** financeMeta/budget: presupuesto mensual por categoría para gastos variables */
export interface FinanceBudget {
  budgets?: Record<string, number>;
  updatedAt?: TimestampLike;
  updatedBy?: string;
}

export const FINANCE_META_DOCS = { fixedCosts: "fixedCosts", budget: "budget" } as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonthKey = (m: unknown): m is string => typeof m === "string" && MONTH_RE.test(m);
export const monthKeySchema = z.string().regex(MONTH_RE, "Mes no válido");

export const saveFixedCostSchema = z
  .object({
    fixedCostId: id.nullish(),
    name: text(120).min(2, "Escriba el nombre del gasto"),
    category: z.enum(EXPENSE_CATEGORIES, { message: "Seleccione la categoría" }),
    amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
    frequency: z.enum(FIXED_COST_FREQUENCIES),
    dayOfMonth: z.number().int().min(1, "Día no válido").max(31, "Día no válido"),
    unit: z.enum(EXPENSE_UNITS),
    employeeId: id.nullish(),
    employeeName: text(80),
    supplierId: id.nullish(),
    defaultMethod: z.enum(MANUAL_PAYMENT_METHODS),
    notes: text(500),
    active: z.boolean(),
    startMonth: monthKeySchema,
    endMonth: monthKeySchema.nullish(),
  })
  .refine((d) => !d.endMonth || d.endMonth >= d.startMonth, { message: "El mes final no puede ser antes del mes inicial", path: ["endMonth"] });
export type SaveFixedCostInput = z.infer<typeof saveFixedCostSchema>;

export const generateFixedCostsSchema = z.object({ month: monthKeySchema });

/** Marcar pagado un gasto pendiente (generado desde un gasto fijo). */
export const payPendingExpenseSchema = z
  .object({
    expenseId: id,
    amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
    date: z.number().int().min(0),
    method: z.enum(MANUAL_PAYMENT_METHODS),
    reference: text(80),
    bank: text(60).nullish(),
    receiptPath: z.string().max(300).regex(expenseReceiptPathRe, "Comprobante no válido").nullish(),
  })
  .refine((p) => !methodNeedsBank(p.method) || !!p.bank?.trim(), { message: "Indique el banco o la cuenta de donde salió el dinero", path: ["bank"] });
export type PayPendingExpenseInput = z.infer<typeof payPendingExpenseSchema>;

/** Cambiar el monto (o la fecha) de un gasto pendiente de este mes, p. ej. la luz vino más cara. */
export const adjustPendingExpenseSchema = z.object({
  expenseId: id,
  amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  dueDate: z.number().int().min(0).nullish(),
});
export type AdjustPendingExpenseInput = z.infer<typeof adjustPendingExpenseSchema>;

const CATEGORY_SET: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);
export const saveFinanceBudgetSchema = z.object({
  budgets: z
    .record(z.string().max(60), cents)
    .refine((b) => Object.keys(b).every((k) => CATEGORY_SET.has(k)), "Categoría no válida"),
});
export type SaveFinanceBudgetInput = z.infer<typeof saveFinanceBudgetSchema>;

// ---------------- Lógica pura (fechas, cuotas, punto de equilibrio) ----------------

/** Días del mes "YYYY-MM". */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Mes siguiente/anterior de "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** ¿La plantilla aplica en ese mes? (activa y dentro de su rango de meses) */
export function fixedCostAppliesTo(fc: Pick<FixedCost, "active" | "startMonth" | "endMonth">, month: string): boolean {
  return !!fc.active && fc.startMonth <= month && (!fc.endMonth || month <= fc.endMonth);
}

export interface Installment {
  /** 1 = mensual o primera quincena, 2 = segunda quincena */
  part: 1 | 2;
  day: number;
  /** "YYYY-MM-DD" */
  dayKey: string;
  amount: number;
}

/**
 * Pagos del mes de un gasto fijo.
 * - Mensual: un pago en `dayOfMonth` (o el último día si el mes es más corto).
 * - Quincenal: dos pagos, el 15 y el último día del mes; la mitad cada uno (si el monto es impar, el centavo va en el segundo).
 */
export function fixedCostInstallments(fc: Pick<FixedCost, "frequency" | "dayOfMonth" | "amount">, month: string): Installment[] {
  const last = daysInMonth(month);
  const key = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  if (fc.frequency === "biweekly") {
    const first = Math.floor(fc.amount / 2);
    return [
      { part: 1, day: 15, dayKey: key(15), amount: first },
      { part: 2, day: last, dayKey: key(last), amount: fc.amount - first },
    ];
  }
  const day = Math.min(Math.max(1, Math.round(fc.dayOfMonth || 1)), last);
  return [{ part: 1, day, dayKey: key(day), amount: fc.amount }];
}

/** Id determinístico del gasto generado: evita duplicados aunque se genere varias veces. */
export const fixedExpenseId = (fixedCostId: string, month: string, part: 1 | 2 | number) => `fc_${fixedCostId}_${month}_${part}`;

/** "YYYY-MM-DD" -> epoch ms al mediodía de Honduras (UTC-6). */
export function hnNoonMs(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 18);
}

/**
 * Punto de equilibrio: ventas necesarias para cubrir los gastos fijos con el margen bruto actual.
 * ventas = gastos fijos / (margen bruto % / 100). Sin margen positivo no hay punto de equilibrio (null).
 */
export function breakEvenRevenue(fixedCosts: number, grossMarginPct: number | null): number | null {
  if (grossMarginPct === null || !Number.isFinite(grossMarginPct) || grossMarginPct <= 0) return null;
  if (fixedCosts <= 0) return 0;
  return Math.round(fixedCosts / (grossMarginPct / 100));
}

/** Proyección simple a fin de mes por ritmo diario. */
export function projectMonthEnd(valueSoFar: number, daysElapsed: number, totalDays: number): number {
  if (daysElapsed <= 0) return valueSoFar;
  if (daysElapsed >= totalDays) return valueSoFar;
  return Math.round((valueSoFar / daysElapsed) * totalDays);
}

/**
 * Día del mes en que lo acumulado alcanzó la meta (ej. utilidad bruta acumulada >= gastos fijos).
 * `daily[0]` es el día 1. Devuelve null si no se alcanzó.
 */
export function coverageDay(daily: number[], target: number): number | null {
  if (target <= 0) return daily.length ? 1 : null;
  let acc = 0;
  for (let i = 0; i < daily.length; i++) {
    acc += daily[i] ?? 0;
    if (acc >= target) return i + 1;
  }
  return null;
}

/**
 * Reparte un monto en proporción a los pesos (ej. gastos generales según ingresos de cada negocio).
 * Usa el mayor residuo para que la suma sea exacta. Si todos los pesos son 0, reparte en partes iguales.
 */
export function allocateByShare<K extends string>(total: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  if (!keys.length || total === 0) return out;
  const w = keys.map((k) => Math.max(0, weights[k] || 0));
  const sum = w.reduce((a, x) => a + x, 0);
  const shares = sum > 0 ? w.map((x) => x / sum) : keys.map(() => 1 / keys.length);
  const raw = shares.map((s) => s * total);
  const base = raw.map((r) => Math.floor(r));
  let rest = total - base.reduce((a, x) => a + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) base[order[j]![1]]! += 1;
  keys.forEach((k, i) => (out[k] = base[i]!));
  return out;
}
