import { z } from "zod";
import type { TimestampLike } from "./types";
import type { QuoteItemType } from "./quote";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "./catalog";
import { expenseReceiptPathRe } from "./finance";
import { formatMoney } from "./money";

/**
 * Pago a técnicos por trabajo realizado.
 * - Solo en líneas de mano de obra y servicio (nunca repuestos ni "otro cargo").
 * - Porcentaje: sobre el monto neto de la línea que paga el cliente, SIN ISV:
 *   cantidad × precio − descuento de la línea − parte del cupón de esa línea.
 * - Monto fijo: por trabajo (por línea), no por unidad.
 * - Hasta 3 técnicos por línea para repartir. Redondeo a centavos por técnico y línea.
 * - Se gana cuando la orden queda pagada completa (igual que las comisiones por referido) y es
 *   COSTO del trabajo: reduce la utilidad de la orden (Finanzas, reportes y comisión por referido).
 * Dinero en centavos.
 */

export const TECH_PAY_MODES = ["percent", "fixed"] as const;
export type TechPayMode = (typeof TECH_PAY_MODES)[number];
export const TECH_PAY_DEFAULT_MODES = ["none", "percent", "fixed"] as const;
export type TechPayDefaultMode = (typeof TECH_PAY_DEFAULT_MODES)[number];
export const TECH_PAY_MODE_LABELS: Record<TechPayDefaultMode, string> = { none: "Sin pago por trabajo", percent: "Porcentaje", fixed: "Monto fijo por trabajo" };
export const TECH_PAY_MAX_SHARES = 3;
/** Categoría del gasto que se registra al pagarle a un técnico (excluida de los gastos operativos: ya está en el costo de las órdenes). */
export const TECH_PAY_EXPENSE_CATEGORY = "Pago a técnicos";

/** Reparto del pago de una línea a un técnico. */
export interface TechPayShare {
  employeeId: string;
  employeeName: string;
  mode: TechPayMode;
  /** % del monto neto de la línea (0..100, admite decimales) */
  percent?: number | null;
  /** monto fijo por trabajo (centavos) */
  amount?: number | null;
}

/** Configuración por defecto de un empleado. */
export interface TechPayDefault {
  mode: TechPayDefaultMode;
  percent: number;
  fixedAmount: number;
}

export const techPayEligible = (type: QuoteItemType | string) => type === "labor" || type === "service";

const id = z.string().min(1).max(128);
const cents = z.number().int("Monto no válido").min(0, "El monto no puede ser negativo").max(100_000_000_00);
const percent = z.number().min(0, "El porcentaje no puede ser negativo").max(100, "El porcentaje no puede pasar de 100")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use máximo 2 decimales en el porcentaje");

export const techPayShareSchema = z.object({
  employeeId: id,
  employeeName: z.string().trim().max(80),
  mode: z.enum(TECH_PAY_MODES),
  percent: percent.nullish(),
  amount: cents.nullish(),
}).refine((s) => (s.mode === "percent" ? s.percent != null : s.amount != null), { message: "Indique el porcentaje o el monto del pago a técnico" });

export const techPaySharesSchema = z
  .array(techPayShareSchema)
  .max(TECH_PAY_MAX_SHARES, `Máximo ${TECH_PAY_MAX_SHARES} técnicos por línea`)
  .refine((l) => new Set(l.map((s) => s.employeeId)).size === l.length, { message: "Un técnico está repetido en la misma línea" });

export const techPayDefaultSchema = z.object({
  mode: z.enum(TECH_PAY_DEFAULT_MODES),
  percent,
  fixedAmount: cents,
});

export const NO_TECH_PAY: TechPayDefault = { mode: "none", percent: 0, fixedAmount: 0 };

/** "30 %" / "L 500.00 por trabajo" / "Sin pago por trabajo" */
export function techPayDefaultLabel(d: TechPayDefault | null | undefined): string {
  if (!d || d.mode === "none") return TECH_PAY_MODE_LABELS.none;
  return d.mode === "percent" ? `${fmtPct(d.percent)} de cada trabajo` : `${formatMoney(d.fixedAmount)} por trabajo`;
}
export const fmtPct = (p: number | null | undefined) => `${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 }).format(p ?? 0)} %`;

/** Reparto por defecto de un empleado (null si no tiene pago configurado). */
export function defaultShare(e: { id: string; displayName: string }, d: TechPayDefault | null | undefined): TechPayShare | null {
  if (!d || d.mode === "none") return null;
  return d.mode === "percent"
    ? { employeeId: e.id, employeeName: e.displayName, mode: "percent", percent: d.percent }
    : { employeeId: e.id, employeeName: e.displayName, mode: "fixed", amount: d.fixedAmount };
}

type TechLine = {
  id: string;
  type: QuoteItemType;
  description: string;
  qty: number;
  unitPrice: number;
  discount: number;
  couponDiscount?: number | null;
  techPay?: TechPayShare[] | null;
};

/** Base del porcentaje: lo que paga el cliente por la línea, sin ISV (después del descuento y del cupón). */
export function techPayBase(it: Pick<TechLine, "qty" | "unitPrice" | "discount" | "couponDiscount">): number {
  const q = Number.isFinite(it.qty) ? it.qty : 0;
  const gross = Math.round(q * (it.unitPrice || 0));
  const disc = Math.min(Math.max(0, Math.round(it.discount || 0)), gross);
  return Math.max(0, gross - disc - Math.max(0, Math.round(it.couponDiscount ?? 0)));
}

/** Monto de un reparto sobre una base (centavos, redondeado). */
export function shareAmount(s: Pick<TechPayShare, "mode" | "percent" | "amount">, base: number): number {
  if (s.mode === "fixed") return Math.max(0, Math.round(s.amount ?? 0));
  return Math.max(0, Math.round((base * (s.percent ?? 0)) / 100));
}

export interface TechPayLineShare {
  employeeId: string;
  employeeName: string;
  mode: TechPayMode;
  percent: number | null;
  /** monto calculado (centavos) */
  amount: number;
}
export interface TechPayLineResult {
  itemId: string;
  description: string;
  type: QuoteItemType;
  base: number;
  shares: TechPayLineShare[];
  total: number;
}
export interface TechPayEmployeeLine {
  itemId: string;
  description: string;
  type: QuoteItemType;
  base: number;
  mode: TechPayMode;
  percent: number | null;
  amount: number;
}
export interface TechPayEmployeeResult {
  employeeId: string;
  employeeName: string;
  lines: TechPayEmployeeLine[];
  total: number;
}
export interface TechPayResult {
  lines: TechPayLineResult[];
  byEmployee: TechPayEmployeeResult[];
  total: number;
  /** total por línea (itemId → centavos), para sumar al costo de la línea */
  byItem: Record<string, number>;
}

/**
 * Pago a técnicos de las líneas de una cotización: por línea y por empleado.
 * Las líneas de repuesto y "otro cargo" se ignoran aunque traigan datos.
 */
export function computeTechPay(items: ReadonlyArray<TechLine>): TechPayResult {
  const lines: TechPayLineResult[] = [];
  const emp = new Map<string, TechPayEmployeeResult>();
  const byItem: Record<string, number> = {};
  let total = 0;
  for (const it of items) {
    if (!techPayEligible(it.type) || !it.techPay?.length) continue;
    const base = techPayBase(it);
    const shares: TechPayLineShare[] = it.techPay.slice(0, TECH_PAY_MAX_SHARES).map((s) => ({
      employeeId: s.employeeId, employeeName: s.employeeName, mode: s.mode,
      percent: s.mode === "percent" ? (s.percent ?? 0) : null,
      amount: shareAmount(s, base),
    }));
    const lineTotal = shares.reduce((a, s) => a + s.amount, 0);
    lines.push({ itemId: it.id, description: it.description, type: it.type, base, shares, total: lineTotal });
    byItem[it.id] = lineTotal;
    total += lineTotal;
    for (const s of shares) {
      const e = emp.get(s.employeeId) ?? { employeeId: s.employeeId, employeeName: s.employeeName, lines: [], total: 0 };
      e.lines.push({ itemId: it.id, description: it.description, type: it.type, base, mode: s.mode, percent: s.percent, amount: s.amount });
      e.total += s.amount;
      emp.set(s.employeeId, e);
    }
  }
  return { lines, byEmployee: [...emp.values()].sort((a, b) => b.total - a.total || a.employeeName.localeCompare(b.employeeName)), total, byItem };
}

/** Quita el pago a técnico de las líneas que no lo admiten y los repartos vacíos. No muta. */
export function sanitizeTechPay<T extends { type: QuoteItemType; techPay?: TechPayShare[] | null }>(items: T[]): T[] {
  return items.map((it) => {
    if (!("techPay" in it)) return it;
    const { techPay, ...rest } = it;
    if (!techPayEligible(it.type) || !techPay?.length) return rest as T;
    return { ...rest, techPay: techPay.slice(0, TECH_PAY_MAX_SHARES).map(cleanShare) } as T;
  });
}
const cleanShare = (s: TechPayShare): TechPayShare =>
  s.mode === "percent"
    ? { employeeId: s.employeeId, employeeName: s.employeeName, mode: "percent", percent: s.percent ?? 0 }
    : { employeeId: s.employeeId, employeeName: s.employeeName, mode: "fixed", amount: Math.round(s.amount ?? 0) };

/** Clave estable de un reparto (para comparar si cambió). */
export function techPayKey(l: TechPayShare[] | null | undefined): string {
  return JSON.stringify((l ?? []).map(cleanShare).map((s) => [s.employeeId, s.mode, s.percent ?? null, s.amount ?? null]));
}

/** "Anthony 30 % (L 300.00), Luis L 200.00" */
export function techPayText(l: TechPayShare[] | null | undefined, base: number): string {
  if (!l?.length) return "sin pago";
  return l.map((s) => `${s.employeeName || "Técnico"} ${s.mode === "percent" ? `${fmtPct(s.percent)} (${formatMoney(shareAmount(s, base))})` : formatMoney(s.amount ?? 0)}`).join(", ");
}

// ---------------- Ganancias y pagos ----------------
export const TECH_EARNING_STATUSES = ["pending", "paid"] as const;
export type TechEarningStatus = (typeof TECH_EARNING_STATUSES)[number];
export const TECH_EARNING_STATUS_LABELS: Record<TechEarningStatus, string> = { pending: "Pendiente", paid: "Pagado" };

/** techEarnings/{orderId}__{employeeId}: lo que ganó un empleado en una orden cobrada. Lo escribe el servidor. */
export interface TechEarning {
  id: string;
  orderId: string;
  orderCode: string;
  quoteId: string;
  employeeId: string;
  employeeName: string;
  customerName: string;
  vehicleLabel: string;
  plate: string;
  lines: TechPayEmployeeLine[];
  total: number;
  status: TechEarningStatus;
  earnedAt: TimestampLike;
  paidAt: TimestampLike | null;
  payoutId: string | null;
  /** algo cambió después de pagado: revisar a mano */
  needsReview?: boolean;
  reviewNote?: string;
  updatedAt: TimestampLike;
}

export const techEarningId = (orderId: string, employeeId: string) => `${orderId}__${employeeId}`;

/** techPayouts/{id}: pago a un empleado (comprobante PT-0001) con su gasto. */
export interface TechPayout {
  id: string;
  number: number;
  code: string;
  employeeId: string;
  employeeName: string;
  earningIds: string[];
  orderCodes: string[];
  count: number;
  amount: number;
  method: ManualPaymentMethod;
  bank: string;
  reference: string;
  receiptPath: string | null;
  receiptType: string | null;
  notes: string;
  expenseId: string;
  expenseCode: string;
  by: string;
  byName: string;
  at: TimestampLike;
}

export const payTechEarningsSchema = z
  .object({
    employeeId: id,
    earningIds: z.array(id).min(1, "Seleccione al menos un trabajo").max(300),
    method: z.enum(MANUAL_PAYMENT_METHODS),
    bank: z.string().trim().max(60).nullish(),
    reference: z.string().trim().max(80),
    receiptPath: z.string().max(300).regex(expenseReceiptPathRe, "Comprobante no válido").nullish(),
    notes: z.string().trim().max(300).nullish(),
  })
  .refine((p) => new Set(p.earningIds).size === p.earningIds.length, { message: "Hay un trabajo repetido", path: ["earningIds"] });
export type PayTechEarningsInput = z.infer<typeof payTechEarningsSchema>;

export const reviewTechEarningSchema = z.object({ earningId: id, note: z.string().trim().min(3, "Indique qué se hizo").max(300) });
export type ReviewTechEarningInput = z.infer<typeof reviewTechEarningSchema>;

/** Empleado sin acceso al panel (no tiene usuario ni correo). */
export const saveStaffMemberSchema = z.object({
  employeeId: id.nullish(),
  displayName: z.string().trim().min(2, "Escriba el nombre").max(80),
  role: z.enum(["technician", "washer", "warehouse", "seller", "reception"]),
  active: z.boolean(),
});
export type SaveStaffMemberInput = z.infer<typeof saveStaffMemberSchema>;

export type TechEarningAction =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "recalc" }
  | { kind: "delete" }
  | { kind: "flag"; note: string };

/** Huella de las líneas de una ganancia (para saber si cambió). */
export const earningKey = (lines: Array<Pick<TechPayEmployeeLine, "itemId" | "base" | "mode" | "percent" | "amount">>, total: number) =>
  JSON.stringify([total, lines.map((l) => [l.itemId, l.base, l.mode, l.percent ?? null, l.amount])]);

/**
 * Qué hacer con la ganancia de un empleado en una orden (idempotente: lo decide el estado, no el evento).
 * - `paidFull`: la orden quedó pagada completa.
 * - `computed`: lo que le toca hoy según la cotización aprobada (null si ya no tiene pago en esa orden).
 * Pendiente: se recalcula o se elimina. Pagado: no se toca, queda para revisión con una nota.
 */
export function decideTechEarning(p: {
  paidFull: boolean;
  existing: Pick<TechEarning, "status" | "lines" | "total" | "needsReview"> | null;
  computed: Pick<TechEarning, "lines" | "total"> | null;
}): TechEarningAction {
  const e = p.existing;
  const has = !!p.computed && p.computed.lines.length > 0;
  if (p.paidFull && has) {
    if (!e) return { kind: "create" };
    const changed = earningKey(e.lines ?? [], e.total) !== earningKey(p.computed!.lines, p.computed!.total);
    if (e.status === "pending") return changed ? { kind: "recalc" } : { kind: "none" };
    return changed && !e.needsReview ? { kind: "flag", note: "La cotización cambió después de pagarle al técnico. Revise si corresponde un ajuste." } : { kind: "none" };
  }
  if (!e) return { kind: "none" };
  if (e.status === "pending") return { kind: "delete" };
  if (e.needsReview) return { kind: "none" };
  return p.paidFull
    ? { kind: "flag", note: "Se quitó el pago a este técnico de la cotización después de pagarle. Revise si corresponde un ajuste." }
    : { kind: "flag", note: "La orden volvió a tener saldo después de pagarle al técnico. Revise si corresponde un ajuste." };
}
