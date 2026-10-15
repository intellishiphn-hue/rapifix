import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import { isValidPhone, PHONE_ERROR } from "./phone";
import { hnDayKey } from "./operations";
import { MANUAL_PAYMENT_METHODS, methodNeedsBank, paymentReceiptPathRe, type ManualPaymentMethod } from "./catalog";
import { expenseReceiptPathRe } from "./finance";

/**
 * Empresas con flota (ej. INTELLISHIP), referidos y comisiones.
 * Dinero en centavos. Fechas de día como "YYYY-MM-DD" en hora de Honduras.
 */

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const id = z.string().min(1).max(128);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);
const dayKeyRe = /^\d{4}-\d{2}-\d{2}$/;
const dayKey = z.string().regex(dayKeyRe, "Fecha no válida");
const optionalPhone = z.string().trim().refine((v) => v === "" || isValidPhone(v), PHONE_ERROR);
const optionalEmail = z.string().trim().max(120).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Correo no válido");

// ---------------- Forma de pago ----------------
export const PAYMENT_TERMS = ["cash", "credit", "monthly"] as const;
export type PaymentTermsType = (typeof PAYMENT_TERMS)[number];
export const PAYMENT_TERMS_LABELS: Record<PaymentTermsType, string> = { cash: "Contado", credit: "Crédito", monthly: "Fin de mes" };
export const PAYMENT_TERMS_HINTS: Record<PaymentTermsType, string> = {
  cash: "Paga cada orden al entregar.",
  credit: "Paga cada orden a los días indicados después de la entrega.",
  monthly: "Se le cobra todo lo del mes en la fecha de corte.",
};
export const DEFAULT_CREDIT_DAYS = 30;
export const DEFAULT_MONTHLY_DUE_DAYS = 15;

export interface CompanyTerms {
  paymentTerms: PaymentTermsType;
  /** crédito: días para pagar desde la entrega */
  creditDays?: number | null;
  /** fin de mes: día de corte (1 a 28). null = último día del mes */
  cutoffDay?: number | null;
  /** fin de mes: días para pagar desde el corte */
  monthlyDueDays?: number | null;
}

/** "Contado", "Crédito 30 días", "Fin de mes" (con el corte si no es el último día). */
export function paymentTermsLabel(t: CompanyTerms | null | undefined): string {
  if (!t) return PAYMENT_TERMS_LABELS.cash;
  if (t.paymentTerms === "credit") return `Crédito ${t.creditDays ?? DEFAULT_CREDIT_DAYS} días`;
  if (t.paymentTerms === "monthly") return t.cutoffDay ? `Fin de mes (corte día ${t.cutoffDay})` : "Fin de mes";
  return PAYMENT_TERMS_LABELS.cash;
}

/** Detalle del plazo: "vence 15 días después del corte (último día del mes)". */
export function paymentTermsDetail(t: CompanyTerms | null | undefined): string {
  if (!t || t.paymentTerms === "cash") return "Paga al entregar cada vehículo.";
  if (t.paymentTerms === "credit") return `Cada orden vence ${t.creditDays ?? DEFAULT_CREDIT_DAYS} días después de entregada.`;
  const cut = t.cutoffDay ? `el día ${t.cutoffDay}` : "el último día del mes";
  return `Corte ${cut}; vence ${t.monthlyDueDays ?? DEFAULT_MONTHLY_DUE_DAYS} días después del corte.`;
}

export const isCreditTerms = (t: CompanyTerms | null | undefined) => !!t && t.paymentTerms !== "cash";

// ---------------- Fechas (claves de día) ----------------
const keyToUtc = (k: string) => {
  const [y, m, d] = k.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const utcToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function addDaysToKey(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * 86_400_000);
}
/** Días entre dos claves (b − a). */
export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86_400_000);
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Fecha de corte de fin de mes para una entrega: el corte del mismo mes si la entrega fue ese día
 * o antes; si no, el corte del mes siguiente. Sin día de corte = último día del mes.
 */
export function monthlyCutoffKey(deliveredKey: string, cutoffDay: number | null | undefined): string {
  const [y, m, d] = deliveredKey.split("-").map(Number) as [number, number, number];
  const make = (yy: number, mm: number) => {
    const ny = mm > 12 ? yy + 1 : yy;
    const nm = mm > 12 ? 1 : mm;
    const day = cutoffDay ? Math.min(cutoffDay, lastDayOfMonth(ny, nm)) : lastDayOfMonth(ny, nm);
    return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const same = make(y, m);
  const sameDay = Number(same.slice(8));
  return d <= sameDay ? same : make(y, m + 1);
}

/**
 * Vencimiento de una orden según la forma de pago de la empresa ("YYYY-MM-DD").
 * Contado: el día de la entrega. Crédito: entrega + N días. Fin de mes: corte + N días.
 * Sin entrega (orden abierta): null (todavía no vence).
 */
export function orderDueKey(terms: CompanyTerms | null | undefined, deliveredAtMs: number | null | undefined): string | null {
  if (deliveredAtMs === null || deliveredAtMs === undefined) return null;
  const delivered = hnDayKey(deliveredAtMs);
  if (!terms || terms.paymentTerms === "cash") return delivered;
  if (terms.paymentTerms === "credit") return addDaysToKey(delivered, terms.creditDays ?? DEFAULT_CREDIT_DAYS);
  return addDaysToKey(monthlyCutoffKey(delivered, terms.cutoffDay), terms.monthlyDueDays ?? DEFAULT_MONTHLY_DUE_DAYS);
}

// ---------------- Antigüedad de saldos ----------------
export const AGING_BUCKETS = ["current", "d30", "d60", "d90", "d90plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Por vencer",
  d30: "Vencido 1 a 30 días",
  d60: "Vencido 31 a 60 días",
  d90: "Vencido 61 a 90 días",
  d90plus: "Vencido más de 90 días",
};
export const AGING_SHORT: Record<AgingBucket, string> = { current: "Por vencer", d30: "1–30", d60: "31–60", d90: "61–90", d90plus: "+90" };

/** Días de atraso (0 si todavía no vence o no tiene vencimiento). Vence hoy = 0. */
export function daysOverdue(dueKey: string | null | undefined, todayKey: string): number {
  if (!dueKey) return 0;
  return Math.max(0, daysBetweenKeys(dueKey, todayKey));
}

export function agingBucket(dueKey: string | null | undefined, todayKey: string): AgingBucket {
  const d = daysOverdue(dueKey, todayKey);
  if (d <= 0) return "current";
  if (d <= 30) return "d30";
  if (d <= 60) return "d60";
  if (d <= 90) return "d90";
  return "d90plus";
}

export interface AgingSummary {
  total: number;
  overdue: number;
  current: number;
  buckets: Record<AgingBucket, number>;
  count: number;
  overdueCount: number;
}

export function agingSummary(items: Array<{ balance: number; dueKey: string | null }>, todayKey: string): AgingSummary {
  const buckets: Record<AgingBucket, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  let total = 0;
  let count = 0;
  let overdueCount = 0;
  for (const it of items) {
    const b = Math.max(0, it.balance);
    if (b <= 0) continue;
    const bucket = agingBucket(it.dueKey, todayKey);
    buckets[bucket] += b;
    total += b;
    count++;
    if (bucket !== "current") overdueCount++;
  }
  return { total, overdue: total - buckets.current, current: buckets.current, buckets, count, overdueCount };
}

// ---------------- Reparto de un pago entre órdenes ----------------
export interface AllocOrder {
  id: string;
  balance: number;
  /** para ordenar: vencimiento o entrega ("YYYY-MM-DD"); null = al final */
  sortKey: string | null;
  /** desempate (ej. número de orden) */
  number?: number;
}

/** Orden de cobro: de la más vieja a la más nueva (vencimiento, luego número). */
export function sortForAllocation<T extends AllocOrder>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    if (a.sortKey !== b.sortKey) {
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return a.sortKey < b.sortKey ? -1 : 1;
    }
    return (a.number ?? 0) - (b.number ?? 0);
  });
}

/**
 * Reparte un monto entre las órdenes con saldo, de la más vieja a la más nueva.
 * Devuelve el monto por orden (solo las que reciben algo) y lo que sobra (pago mayor al saldo total).
 */
export function allocatePayment(amount: number, orders: AllocOrder[]): { allocations: Array<{ orderId: string; amount: number }>; leftover: number } {
  let rest = Math.max(0, Math.round(amount));
  const allocations: Array<{ orderId: string; amount: number }> = [];
  for (const o of sortForAllocation(orders)) {
    if (rest <= 0) break;
    const bal = Math.max(0, o.balance);
    if (bal <= 0) continue;
    const take = Math.min(bal, rest);
    allocations.push({ orderId: o.id, amount: take });
    rest -= take;
  }
  return { allocations, leftover: rest };
}

/** Revisa un reparto hecho a mano: montos positivos, sin pasarse del saldo de cada orden ni repetir órdenes. */
export function validateAllocations(allocations: Array<{ orderId: string; amount: number }>, balances: Record<string, number>): string | null {
  const seen = new Set<string>();
  if (!allocations.length) return "Indique cuánto se abona a cada orden";
  for (const a of allocations) {
    if (seen.has(a.orderId)) return "Hay una orden repetida";
    seen.add(a.orderId);
    if (!(a.amount > 0)) return "Cada monto debe ser mayor a 0";
    const bal = balances[a.orderId];
    if (bal === undefined) return "Una de las órdenes no es de esta empresa o ya no tiene saldo";
    if (a.amount > bal) return "Un abono supera el saldo de su orden";
  }
  return null;
}

// ---------------- Referidos ----------------
export const REFERRAL_BASES = ["profit"] as const;
export type ReferralBasis = (typeof REFERRAL_BASES)[number];
export const REFERRAL_BASIS_LABELS: Record<ReferralBasis, string> = { profit: "de la utilidad" };
export const DEFAULT_COMMISSION_PCT = 5;

export interface Referral {
  referrerId: string;
  referrerName: string;
  pct: number;
  basis: ReferralBasis;
  /** desde ("YYYY-MM-DD", hora de Honduras) */
  startDate: string;
  /** hasta (incluido). null = indefinido */
  endDate: string | null;
  setBy?: string;
  setAt?: TimestampLike;
}

/** La comisión aplica en ese momento: desde <= día <= hasta (o sin fecha de fin). */
export function isReferralActive(r: Pick<Referral, "startDate" | "endDate"> | null | undefined, atMs: number): boolean {
  if (!r) return false;
  const day = hnDayKey(atMs);
  if (r.startDate && day < r.startDate) return false;
  if (r.endDate && day > r.endDate) return false;
  return true;
}

export function referralLabel(r: Pick<Referral, "pct" | "basis" | "endDate"> & { referrerName?: string }): string {
  const base = `${r.pct}% ${REFERRAL_BASIS_LABELS[r.basis] ?? "de la utilidad"}`;
  return r.endDate ? `${base} hasta ${r.endDate.split("-").reverse().join("/")}` : `${base}, sin fecha de fin`;
}

/** Comisión: porcentaje de la utilidad, redondeado al centavo. Utilidad negativa = 0. */
export function commissionAmount(profit: number, pct: number): number {
  if (!(profit > 0) || !(pct > 0)) return 0;
  return Math.max(0, Math.round((profit * pct) / 100));
}

export interface Referrer extends BaseDoc {
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  /** cómo se le paga: "Transferencia BAC 7301...", "Efectivo" */
  paymentMethod: string;
  notes: string;
  active: boolean;
  defaultPct: number;
  searchKeywords: string[];
}

// ---------------- Empresas ----------------
export interface Company extends BaseDoc, CompanyTerms {
  name: string;
  legalName: string;
  rtn: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  notes: string;
  active: boolean;
  creditDays: number;
  cutoffDay: number | null;
  monthlyDueDays: number;
  /** límite de crédito en centavos (null = sin límite) */
  creditLimit: number | null;
  /** descuento sugerido para sus cotizaciones (null = ninguno) */
  discountPct: number | null;
  /** encargado de flota: aprueba cotizaciones y recibe avisos */
  approverName: string;
  approverPhone: string;
  referral: Referral | null;
  /** los mantiene el servidor */
  vehicleCount: number;
  balanceDue: number;
  openOrders: number;
  searchKeywords: string[];
}

export const saveCompanySchema = z
  .object({
    companyId: id.nullish(),
    name: text(80).min(2, "El nombre es obligatorio"),
    legalName: text(120),
    rtn: text(20),
    contactName: text(80),
    contactPhone: optionalPhone,
    contactEmail: optionalEmail,
    address: text(250),
    notes: text(1000),
    active: z.boolean(),
    paymentTerms: z.enum(PAYMENT_TERMS),
    creditDays: z.number({ error: "Días no válidos" }).int().min(1, "Mínimo 1 día").max(180, "Máximo 180 días"),
    cutoffDay: z.number({ error: "Día no válido" }).int().min(1, "Día no válido").max(28, "Use un día del 1 al 28 (o último día)").nullable(),
    monthlyDueDays: z.number({ error: "Días no válidos" }).int().min(0).max(90, "Máximo 90 días"),
    creditLimit: cents.nullable(),
    discountPct: z.number({ error: "Porcentaje no válido" }).min(0).max(50, "Máximo 50%").nullable(),
    approverName: text(80),
    approverPhone: optionalPhone,
  })
  .refine((v) => !v.approverPhone || v.approverName.trim().length >= 2, { message: "Indique el nombre del encargado de flota", path: ["approverName"] });
export type SaveCompanyInput = z.infer<typeof saveCompanySchema>;
export type SaveCompanyForm = z.input<typeof saveCompanySchema>;

export const assignVehicleSchema = z.object({ vehicleId: id, companyId: id.nullable() });
export type AssignVehicleInput = z.infer<typeof assignVehicleSchema>;

export const saveReferrerSchema = z.object({
  referrerId: id.nullish(),
  name: text(80).min(2, "El nombre es obligatorio"),
  phone: z.string().trim().min(1, "El teléfono es obligatorio").refine((v) => isValidPhone(v), PHONE_ERROR),
  email: optionalEmail,
  idNumber: text(20),
  paymentMethod: text(200),
  notes: text(1000),
  active: z.boolean(),
  defaultPct: z.number({ error: "Porcentaje no válido" }).min(0.1, "Mínimo 0.1%").max(50, "Máximo 50%"),
});
export type SaveReferrerInput = z.infer<typeof saveReferrerSchema>;

export const setReferralSchema = z.object({
  target: z.enum(["company", "customer"]),
  targetId: id,
  /** null = quitar la comisión */
  referral: z
    .object({
      referrerId: id,
      pct: z.number({ error: "Porcentaje no válido" }).min(0.1, "Mínimo 0.1%").max(50, "Máximo 50%"),
      basis: z.enum(REFERRAL_BASES),
      startDate: dayKey,
      endDate: dayKey.nullable(),
    })
    .refine((r) => !r.endDate || r.endDate >= r.startDate, { message: "La fecha de fin no puede ser antes del inicio", path: ["endDate"] })
    .nullable(),
});
export type SetReferralInput = z.infer<typeof setReferralSchema>;

// ---------------- Pago de una empresa (varias órdenes) ----------------
export interface CompanyPayment {
  id: string;
  number: number;
  code: string; // PE-0001
  companyId: string;
  companyName: string;
  amount: number;
  method: ManualPaymentMethod;
  bank: string;
  reference: string;
  receiptPath: string | null;
  receiptType: "image" | "pdf" | null;
  notes: string;
  allocations: Array<{ orderId: string; orderCode: string; amount: number; paymentId: string; paymentCode: string }>;
  receivedBy: string;
  receivedByName: string;
  at: TimestampLike;
}

export const registerCompanyPaymentSchema = z
  .object({
    companyId: id,
    method: z.enum(MANUAL_PAYMENT_METHODS),
    reference: text(80),
    bank: text(60).nullish(),
    receiptPath: z.string().max(300).regex(paymentReceiptPathRe, "Comprobante no válido").nullish(),
    notes: text(300).nullish(),
    allocations: z
      .array(z.object({ orderId: id, amount: cents.refine((v) => v > 0, "Cada monto debe ser mayor a 0") }))
      .min(1, "Seleccione al menos una orden")
      .max(60, "Máximo 60 órdenes por pago"),
  })
  .refine((p) => !methodNeedsBank(p.method) || !!p.bank?.trim(), { message: "Indique el banco o la cuenta donde entró el dinero", path: ["bank"] })
  .refine((p) => new Set(p.allocations.map((a) => a.orderId)).size === p.allocations.length, { message: "Hay una orden repetida", path: ["allocations"] });
export type RegisterCompanyPaymentInput = z.infer<typeof registerCompanyPaymentSchema>;

// ---------------- Comisiones ----------------
export const COMMISSION_STATUSES = ["pending", "paid", "voided"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = { pending: "Pendiente", paid: "Pagada", voided: "Anulada" };

export interface ReferralCommission {
  /** igual al id de la orden (una comisión por orden) */
  id: string;
  referrerId: string;
  referrerName: string;
  orderId: string;
  orderCode: string;
  /** de dónde salió el referido */
  source: "company" | "customer";
  companyId: string | null;
  companyName: string;
  customerId: string;
  customerName: string;
  vehicleLabel: string;
  plate: string;
  /** sin ISV */
  revenue: number;
  cost: number;
  profit: number;
  pct: number;
  basis: ReferralBasis;
  amount: number;
  /** líneas de repuesto sin costo registrado (la utilidad puede estar inflada) */
  missingCostLines: number;
  status: CommissionStatus;
  earnedAt: TimestampLike;
  paidAt: TimestampLike | null;
  payoutId: string | null;
  /** anulada por el sistema (la orden volvió a tener saldo): se recrea al quedar pagada */
  autoVoided?: boolean;
  voidReason?: string;
  voidedAt?: TimestampLike | null;
  /** algo cambió después de pagada: revisar a mano */
  needsReview?: boolean;
  reviewNote?: string;
  updatedAt: TimestampLike;
}

export interface CommissionPayout {
  id: string;
  number: number;
  code: string; // COM-0001
  referrerId: string;
  referrerName: string;
  commissionIds: string[];
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

export const payCommissionsSchema = z
  .object({
    referrerId: id,
    commissionIds: z.array(id).min(1, "Seleccione al menos una comisión").max(200),
    method: z.enum(MANUAL_PAYMENT_METHODS),
    bank: text(60).nullish(),
    reference: text(80),
    receiptPath: z.string().max(300).regex(expenseReceiptPathRe, "Comprobante no válido").nullish(),
    notes: text(300).nullish(),
  })
  .refine((p) => new Set(p.commissionIds).size === p.commissionIds.length, { message: "Hay una comisión repetida", path: ["commissionIds"] });
export type PayCommissionsInput = z.infer<typeof payCommissionsSchema>;

export const voidCommissionSchema = z.object({
  commissionId: id,
  /** void: anular una comisión pendiente. reviewed: marcar como revisada una pagada con aviso */
  action: z.enum(["void", "reviewed"]),
  reason: text(300).min(3, "Indique el motivo"),
});
export type VoidCommissionInput = z.infer<typeof voidCommissionSchema>;

/**
 * Qué hacer con la comisión de una orden cuando cambia (idempotente: la decide el estado, no el evento).
 * - `paidFull`: la orden quedó con saldo <= 0 y total > 0.
 * - `existing`: el documento commissions/{orderId}, si existe.
 * - `computed`: comisión nueva calculada con el referido vigente HOY (null si no hay referido vigente).
 * - `profitNow`/`amountWithExistingPct`: utilidad actual y comisión recalculada con el % ya guardado.
 */
export type CommissionAction =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "recalc" }
  | { kind: "void"; reason: string }
  | { kind: "flag"; note: string };

export function decideCommission(p: {
  paidFull: boolean;
  existing: Pick<ReferralCommission, "status" | "amount" | "profit" | "revenue" | "cost" | "autoVoided" | "needsReview"> | null;
  hasActiveReferral: boolean;
  /** utilidad, ingreso y costo actuales de la orden */
  now: { profit: number; revenue: number; cost: number };
  /** comisión recalculada con el % de la comisión existente */
  recalcAmount: number;
}): CommissionAction {
  const e = p.existing;
  if (p.paidFull) {
    if (!e || (e.status === "voided" && e.autoVoided)) return p.hasActiveReferral ? { kind: "create" } : { kind: "none" };
    if (e.status === "voided") return { kind: "none" }; // anulada a mano: no se recrea
    const changed = e.profit !== p.now.profit || e.revenue !== p.now.revenue || e.cost !== p.now.cost;
    if (e.status === "pending") return changed || e.amount !== p.recalcAmount ? { kind: "recalc" } : { kind: "none" };
    // pagada: no se toca, solo se avisa
    return changed && !e.needsReview ? { kind: "flag", note: "La orden cambió después de pagar la comisión (cotización modificada). Revise si corresponde un ajuste." } : { kind: "none" };
  }
  if (!e) return { kind: "none" };
  if (e.status === "pending") return { kind: "void", reason: "La orden volvió a tener saldo (pago anulado o cotización modificada)." };
  if (e.status === "paid" && !e.needsReview) return { kind: "flag", note: "La orden volvió a tener saldo después de pagar la comisión. Revise si corresponde un ajuste." };
  return { kind: "none" };
}
