import { z } from "zod";
import type { TimestampLike } from "./types";
import { formatMoney } from "./money";
import { hnDayKey } from "./operations";
import { normalizePhone } from "./phone";

// ============================================================================
// CUPONES / CÓDIGOS DE DESCUENTO (taller, carwash y punto de venta)
// Toda la regla de validación y cálculo es pura y vive aquí: la usan el panel (vista previa)
// y las Cloud Functions (las que de verdad reservan y usan el cupón).
// Dinero en centavos. Fechas de vigencia como "YYYY-MM-DD" en hora de Honduras (inclusive).
// ============================================================================

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");

export const COUPON_TYPES = ["percent", "fixed"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const COUPON_TYPE_LABELS: Record<CouponType, string> = { percent: "Porcentaje", fixed: "Monto fijo" };

/** A qué parte de la cuenta aplica. En POS: productos = repuestos, servicios = servicios. En carwash todo es servicio. */
export const COUPON_SCOPES = ["all", "labor", "parts", "services"] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];
export const COUPON_SCOPE_LABELS: Record<CouponScope, string> = {
  all: "Toda la cuenta",
  labor: "Mano de obra",
  parts: "Repuestos y productos",
  services: "Servicios",
};
const SCOPE_TEXT: Record<CouponScope, string> = {
  all: "",
  labor: "en mano de obra",
  parts: "en repuestos y productos",
  services: "en servicios",
};

export const COUPON_UNITS = ["shop", "carwash", "pos"] as const;
export type CouponUnit = (typeof COUPON_UNITS)[number];
export const COUPON_UNIT_LABELS: Record<CouponUnit, string> = { shop: "Taller", carwash: "Carwash", pos: "Punto de venta" };

/** Tipo de línea para decidir si es elegible. */
export type CouponLineKind = "labor" | "parts" | "services" | "other";

export const couponCodeRe = /^[A-Z0-9-]{3,20}$/;
/** Mayúsculas y sin espacios. */
export const normalizeCouponCode = (v: string) => (v ?? "").toUpperCase().replace(/\s+/g, "");

/** Sin letras que se confunden (O/0, I/1). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Código aleatorio, p. ej. "RAPI-7KQ2" con prefijo, o "7KQ2MX9A" sin prefijo. */
export function generateCouponCode(rand: (n: number) => number = (n) => Math.floor(Math.random() * n), length = 6, prefix = ""): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  const p = normalizeCouponCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return p ? `${p}-${s}` : s;
}

export interface Coupon {
  /** id del documento = code */
  id: string;
  code: string;
  /** lo que ve el cliente */
  name: string;
  description: string;
  type: CouponType;
  /** percent: 1 a 100. fixed: centavos */
  value: number;
  /** tope en centavos (solo porcentaje); null = sin tope */
  maxDiscount: number | null;
  /** compra mínima sobre el subtotal elegible (sin ISV); 0 = sin mínimo */
  minPurchase: number;
  appliesTo: CouponScope;
  units: CouponUnit[];
  validFrom: string;
  validUntil: string | null;
  /** usos totales; null = sin límite */
  maxUses: number | null;
  /** usos por cliente; 0 = sin límite */
  maxUsesPerCustomer: number;
  /** solo clientes sin visitas pagadas antes */
  firstVisitOnly: boolean;
  /** el cliente lo puede escribir en su link */
  customerApplicable: boolean;
  /** solo para los vehículos de esta empresa */
  companyId: string | null;
  companyName?: string;
  /** no aplica a vehículos de empresas (precio especial) salvo que el cupón sea de esa empresa */
  excludeCompanies: boolean;
  active: boolean;
  /** canjes usados (cobrados / aprobados) */
  usesCount: number;
  /** canjes vigentes: reservados + usados (para el límite total) */
  usesReserved: number;
  /** descuento total dado en canjes usados */
  discountGiven: number;
  createdAt: TimestampLike;
  createdBy: string;
  createdByName?: string;
  updatedAt: TimestampLike;
  updatedBy: string;
}

/** Lo que se guarda del cupón en la cotización, la venta o el lavado (se recalcula con estas reglas). */
export interface CouponRule {
  code: string;
  name: string;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minPurchase: number;
  appliesTo: CouponScope;
}
export interface AppliedCoupon extends CouponRule {
  /** descuento que da hoy (centavos; en carwash, sobre el precio que ve el cliente) */
  discount: number;
  redemptionId: string;
}

export const couponRuleOf = (c: Pick<Coupon, "code" | "name" | "type" | "value" | "maxDiscount" | "minPurchase" | "appliesTo">): CouponRule => ({
  code: c.code, name: c.name, type: c.type, value: c.value, maxDiscount: c.maxDiscount ?? null, minPurchase: c.minPurchase ?? 0, appliesTo: c.appliesTo,
});

// ---------------- Canjes ----------------
export const REDEMPTION_STATUSES = ["reserved", "used", "released"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = { reserved: "Reservado", used: "Usado", released: "Liberado" };
export const REDEMPTION_KINDS = ["quote", "sale", "wash"] as const;
export type RedemptionKind = (typeof REDEMPTION_KINDS)[number];
export const REDEMPTION_KIND_LABELS: Record<RedemptionKind, string> = { quote: "Cotización", sale: "Venta", wash: "Lavado" };
export const REDEMPTION_CHANNELS = ["portal", "wash_link", "panel"] as const;
export type RedemptionChannel = (typeof REDEMPTION_CHANNELS)[number];
export const REDEMPTION_CHANNEL_LABELS: Record<RedemptionChannel, string> = { portal: "Link de la cotización", wash_link: "Link del lavado", panel: "Panel" };

export interface CouponRedemption {
  id: string;
  couponCode: string;
  couponName: string;
  unit: CouponUnit;
  target: { kind: RedemptionKind; id: string; code: string };
  orderId: string | null;
  orderCode?: string | null;
  saleId?: string | null;
  saleCode?: string | null;
  customerId: string | null;
  customerName: string;
  /** identidad principal para el límite por cliente */
  customerKey: string;
  /** todas las identidades conocidas (cliente, teléfono, placa): el límite se valida contra todas */
  customerKeys: string[];
  discount: number;
  /** total de la cuenta con el cupón (con ISV) */
  total: number;
  firstVisit: boolean;
  status: RedemptionStatus;
  /** "customer" o el nombre del empleado */
  appliedBy: string;
  appliedByUid: string | null;
  channel: RedemptionChannel;
  releaseReason?: string;
  createdAt: TimestampLike;
  usedAt: TimestampLike | null;
  releasedAt: TimestampLike | null;
}

/**
 * Identidades del cliente para el límite por cliente: "c:<id del cliente>", "p:<teléfono E.164>", "v:<placa>".
 * La primera es la principal. Si no hay ninguna, el cupón con límite por cliente no se puede usar.
 */
export function customerKeysFor(c: { customerId?: string | null; phone?: string | null; plate?: string | null }): string[] {
  const keys: string[] = [];
  if (c.customerId) keys.push(`c:${c.customerId}`);
  const phone = c.phone ? normalizePhone(c.phone) : "";
  if (phone && phone.replace(/\D/g, "").length >= 7) keys.push(`p:${phone}`);
  const plate = c.plate ? c.plate.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (plate.length >= 2) keys.push(`v:${plate}`);
  return keys;
}

/** id del índice de uso por cliente: couponUsage/{code}__{key} (sin "/"). */
export const couponUsageId = (code: string, key: string) => `${code}__${key.replace(/\//g, "_")}`;

// ---------------- Líneas y cálculo ----------------
export interface CouponLine {
  kind: CouponLineKind;
  /** monto de la línea ya con su descuento manual, sin ISV (en carwash, el precio que ve el cliente) */
  amount: number;
}

export const quoteTypeToCouponKind = (t: string): CouponLineKind => (t === "labor" ? "labor" : t === "part" ? "parts" : t === "service" ? "services" : "other");
export const saleKindToCouponKind = (k: string): CouponLineKind => (k === "product" ? "parts" : k === "service" ? "services" : "other");

export const couponLineEligible = (scope: CouponScope, kind: CouponLineKind) => scope === "all" || scope === kind;

export interface CouponAmountResult {
  ok: boolean;
  /** subtotal elegible */
  eligible: number;
  discount: number;
  reason: string | null;
}

/** Descuento que da un cupón sobre unas líneas (sin revisar vigencia ni usos). */
export function couponAmount(rule: Pick<CouponRule, "type" | "value" | "maxDiscount" | "minPurchase" | "appliesTo">, lines: CouponLine[]): CouponAmountResult {
  const eligible = lines.reduce((a, l) => a + (couponLineEligible(rule.appliesTo, l.kind) ? Math.max(0, Math.round(l.amount)) : 0), 0);
  if (eligible <= 0) {
    return { ok: false, eligible: 0, discount: 0, reason: rule.appliesTo === "all" ? "No hay nada que descontar en esta cuenta." : `Este cupón aplica solo ${SCOPE_TEXT[rule.appliesTo]} y esta cuenta no tiene.` };
  }
  const min = Math.max(0, Math.round(rule.minPurchase || 0));
  if (min > 0 && eligible < min) {
    return { ok: false, eligible, discount: 0, reason: `Compra mínima ${formatMoney(min)}${rule.appliesTo === "all" ? "" : ` ${SCOPE_TEXT[rule.appliesTo]}`} (sin ISV).` };
  }
  let discount: number;
  if (rule.type === "percent") {
    discount = Math.round((eligible * Math.min(100, Math.max(0, rule.value))) / 100);
    if (rule.maxDiscount != null && rule.maxDiscount > 0) discount = Math.min(discount, rule.maxDiscount);
  } else {
    discount = Math.min(Math.max(0, Math.round(rule.value)), eligible);
  }
  return { ok: discount > 0, eligible, discount, reason: discount > 0 ? null : "Este cupón no da descuento en esta cuenta." };
}

/**
 * Reparte el descuento proporcionalmente entre las líneas elegibles (método del mayor residuo).
 * La suma de las partes es exactamente el descuento y ninguna parte supera su línea.
 */
export function distributeDiscount(amounts: number[], eligible: boolean[], discount: number): number[] {
  const base = amounts.map((a, i) => (eligible[i] ? Math.max(0, Math.round(a)) : 0));
  const sum = base.reduce((a, b) => a + b, 0);
  const total = Math.min(Math.max(0, Math.round(discount)), sum);
  if (!sum || !total) return amounts.map(() => 0);
  const raw = base.map((b) => (b * total) / sum);
  const shares = raw.map((r) => Math.floor(r));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || base[b.i]! - base[a.i]!);
  for (const { i } of order) {
    if (left <= 0) break;
    if (shares[i]! < base[i]!) {
      shares[i]! += 1;
      left--;
    }
  }
  return shares;
}

// ---------------- Validación completa ----------------
export interface CouponContext {
  unit: CouponUnit;
  nowMs: number;
  lines: CouponLine[];
  /** lo aplica el cliente desde su link */
  byCustomer?: boolean;
  /** hay alguna identidad del cliente (cliente, teléfono o placa real) */
  hasIdentity: boolean;
  /** mayor cantidad de canjes vigentes de este cupón entre todas las identidades del cliente */
  customerUses: number;
  /** null = no se sabe (no se exige) */
  isFirstVisit: boolean | null;
  /** empresa del vehículo / orden */
  companyId: string | null;
}

export type CouponEvaluation = { ok: true; discount: number; eligible: number; reason: null } | { ok: false; discount: 0; eligible: number; reason: string };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "30 de octubre" (o "30 de octubre de 2027" si no es el año en curso). */
export function couponDayLabel(key: string, nowKey?: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const base = `${d} de ${MONTHS[(m ?? 1) - 1]}`;
  return nowKey && nowKey.slice(0, 4) === key.slice(0, 4) ? base : `${base} de ${y}`;
}
/** "30/10/2026" */
export const couponDayShort = (key: string) => key.split("-").reverse().join("/");

const fail = (reason: string, eligible = 0): CouponEvaluation => ({ ok: false, discount: 0, eligible, reason });

/** Revisa todas las reglas del cupón y calcula el descuento. Mensajes claros en español. */
export function evaluateCoupon(coupon: Omit<Coupon, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">, ctx: CouponContext): CouponEvaluation {
  const today = hnDayKey(ctx.nowMs);
  if (!coupon.active) return fail("Este cupón ya no está activo.");
  if (ctx.byCustomer && !coupon.customerApplicable) return fail("Este cupón no se puede aplicar desde el link. Pídalo en el taller.");
  if (coupon.validFrom && today < coupon.validFrom) return fail(`Este cupón es válido a partir del ${couponDayLabel(coupon.validFrom, today)}.`);
  if (coupon.validUntil && today > coupon.validUntil) return fail(`Este cupón venció el ${couponDayLabel(coupon.validUntil, today)}.`);
  if (!coupon.units.includes(ctx.unit)) {
    const where = coupon.units.map((u) => COUPON_UNIT_LABELS[u].toLowerCase()).join(" y ");
    return fail(`Este cupón no aplica en ${COUPON_UNIT_LABELS[ctx.unit].toLowerCase()}${where ? ` (solo en ${where})` : ""}.`);
  }
  if (coupon.companyId) {
    if (ctx.companyId !== coupon.companyId) return fail(`Este cupón es solo para vehículos de ${coupon.companyName || "una empresa"}.`);
  } else if (coupon.excludeCompanies && ctx.companyId) {
    return fail("Este cupón no aplica a vehículos de empresa (ya tienen precio especial).");
  }
  if (coupon.maxUses != null && coupon.maxUses > 0 && (coupon.usesReserved ?? 0) >= coupon.maxUses) return fail("Este cupón ya se agotó.");
  const perCustomer = Math.max(0, Math.floor(coupon.maxUsesPerCustomer ?? 0));
  if ((perCustomer > 0 || coupon.firstVisitOnly) && !ctx.hasIdentity) return fail("Para usar este cupón indique el cliente, su teléfono o la placa del vehículo.");
  if (perCustomer > 0 && ctx.customerUses >= perCustomer) {
    return fail(perCustomer === 1 ? "Este cupón ya fue usado por este cliente." : `Este cliente ya usó este cupón ${perCustomer} veces (el máximo).`);
  }
  if (coupon.firstVisitOnly && ctx.isFirstVisit === false) return fail("Este cupón es solo para clientes nuevos (primera visita).");
  const amount = couponAmount(coupon, ctx.lines);
  if (!amount.ok) return fail(amount.reason ?? "Este cupón no aplica a esta cuenta.", amount.eligible);
  return { ok: true, discount: amount.discount, eligible: amount.eligible, reason: null };
}

/** "15% de descuento en mano de obra, máximo L 500.00, una vez por cliente, hasta el 31/12/2026" */
export function describeCoupon(c: Pick<Coupon, "type" | "value" | "maxDiscount" | "minPurchase" | "appliesTo" | "units" | "validFrom" | "validUntil" | "maxUses" | "maxUsesPerCustomer" | "firstVisitOnly" | "companyId" | "companyName">): string {
  const parts: string[] = [];
  const what = c.type === "percent" ? `${c.value}% de descuento` : `${formatMoney(c.value)} de descuento`;
  parts.push(c.appliesTo === "all" ? what : `${what} ${SCOPE_TEXT[c.appliesTo]}`);
  if (c.type === "percent" && c.maxDiscount) parts.push(`máximo ${formatMoney(c.maxDiscount)}`);
  if (c.minPurchase) parts.push(`compra mínima ${formatMoney(c.minPurchase)}`);
  if (c.units.length && c.units.length < COUPON_UNITS.length) parts.push(`en ${c.units.map((u) => COUPON_UNIT_LABELS[u].toLowerCase()).join(" y ")}`);
  if (c.firstVisitOnly) parts.push("solo clientes nuevos");
  const per = c.maxUsesPerCustomer ?? 0;
  if (per === 1) parts.push("una vez por cliente");
  else if (per > 1) parts.push(`${per} veces por cliente`);
  if (c.maxUses) parts.push(`hasta ${c.maxUses} usos en total`);
  if (c.companyId) parts.push(`solo ${c.companyName || "empresa"}`);
  if (c.validUntil) parts.push(`hasta el ${couponDayShort(c.validUntil)}`);
  return parts.join(", ");
}

export type CouponState = "active" | "scheduled" | "expired" | "exhausted" | "inactive";
export const COUPON_STATE_META: Record<CouponState, { label: string; tone: "green" | "blue" | "gray" | "amber" | "red" }> = {
  active: { label: "Activo", tone: "green" },
  scheduled: { label: "Programado", tone: "blue" },
  expired: { label: "Vencido", tone: "gray" },
  exhausted: { label: "Agotado", tone: "amber" },
  inactive: { label: "Inactivo", tone: "red" },
};
export function couponState(c: Pick<Coupon, "active" | "validFrom" | "validUntil" | "maxUses" | "usesReserved">, nowMs: number): CouponState {
  const today = hnDayKey(nowMs);
  if (!c.active) return "inactive";
  if (c.validUntil && today > c.validUntil) return "expired";
  if (c.maxUses && (c.usesReserved ?? 0) >= c.maxUses) return "exhausted";
  if (c.validFrom && today < c.validFrom) return "scheduled";
  return "active";
}

// ---------------- Entradas de las Cloud Functions ----------------
const codeInput = z.string().trim().max(40).transform(normalizeCouponCode).refine((v) => couponCodeRe.test(v), "El código debe tener de 3 a 20 letras, números o guiones");

export const saveCouponSchema = z
  .object({
    /** editar uno existente (su código no cambia) */
    editing: z.boolean(),
    code: codeInput,
    name: text(80).min(2, "Escriba el nombre que verá el cliente"),
    description: text(300),
    type: z.enum(COUPON_TYPES),
    value: z.number({ error: "Valor no válido" }).int("Use números enteros").min(1, "Indique el valor del descuento"),
    maxDiscount: cents.nullable(),
    minPurchase: cents,
    appliesTo: z.enum(COUPON_SCOPES),
    units: z.array(z.enum(COUPON_UNITS)).min(1, "Elija dónde aplica").max(3),
    validFrom: dayKey,
    validUntil: dayKey.nullable(),
    maxUses: z.number().int().min(1, "Los usos totales deben ser al menos 1").max(1_000_000).nullable(),
    maxUsesPerCustomer: z.number().int().min(0).max(1000),
    firstVisitOnly: z.boolean(),
    customerApplicable: z.boolean(),
    companyId: z.string().min(1).max(128).nullable(),
    excludeCompanies: z.boolean(),
    active: z.boolean(),
  })
  .refine((v) => v.type !== "percent" || v.value <= 100, { message: "El porcentaje debe ser de 1 a 100", path: ["value"] })
  .refine((v) => v.type !== "fixed" || v.value <= 100_000_000_00, { message: "Monto no válido", path: ["value"] })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, { message: "La fecha final debe ser igual o posterior a la inicial", path: ["validUntil"] });
export type SaveCouponInput = z.infer<typeof saveCouponSchema>;

const targetId = z.string().min(1).max(128);
export const applyCouponSchema = z.object({ kind: z.enum(REDEMPTION_KINDS).exclude(["sale"]), id: targetId, code: codeInput });
export type ApplyCouponInput = z.infer<typeof applyCouponSchema>;
export const removeCouponSchema = z.object({ kind: z.enum(REDEMPTION_KINDS).exclude(["sale"]), id: targetId });
export type RemoveCouponInput = z.infer<typeof removeCouponSchema>;

const publicToken = z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido");
export const applyCouponPublicSchema = z.object({ token: publicToken, kind: z.enum(["quote", "wash"]), code: z.string().trim().max(40).transform(normalizeCouponCode) });
export type ApplyCouponPublicInput = z.infer<typeof applyCouponPublicSchema>;
export const removeCouponPublicSchema = z.object({ token: publicToken, kind: z.enum(["quote", "wash"]) });

/** Vista previa en el punto de venta (no reserva nada). */
export const checkSaleCouponSchema = z.object({
  code: codeInput,
  customerId: z.string().min(1).max(128).nullish(),
  vehicleId: z.string().min(1).max(128).nullish(),
  lines: z.array(z.object({ kind: z.enum(["product", "service", "other"]), amount: cents })).min(1, "Agregue productos o servicios").max(100),
});
export type CheckSaleCouponInput = z.infer<typeof checkSaleCouponSchema>;
export interface CheckSaleCouponResult {
  ok: boolean;
  reason: string | null;
  discount: number;
  rule: CouponRule | null;
}

export interface ApplyCouponResult {
  code: string;
  discount: number;
  total: number;
}

/** Cupón como lo ve el cliente en su link. */
export interface PublicCoupon {
  code: string;
  name: string;
  discount: number;
}
