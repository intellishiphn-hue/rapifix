import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import { computeQuote, type Totals } from "./quote";
import { createSaleSchema } from "./catalog";
import { buildSearchKeywords } from "./text";

// ============================================================================
// CARWASH: tamaños, menú de lavados, cola, lealtad y membresías.
// Toda la lógica de cálculo vive aquí (pura) para usarla igual en el panel y en Functions.
// ============================================================================

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const id = z.string().min(1).max(128);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);

// ---------------- Tamaños ----------------
export const VEHICLE_SIZES = ["turismo", "camioneta", "pickup", "oversize"] as const;
export type VehicleSize = (typeof VEHICLE_SIZES)[number];
export const VEHICLE_SIZE_LABELS: Record<VehicleSize, string> = {
  turismo: "Turismo / sedán",
  camioneta: "Camioneta / SUV",
  pickup: "Pick-up",
  oversize: "Oversize",
};
export const VEHICLE_SIZE_SHORT: Record<VehicleSize, string> = {
  turismo: "Turismo",
  camioneta: "Camioneta",
  pickup: "Pick-up",
  oversize: "Oversize",
};
export const VEHICLE_SIZE_HINTS: Record<VehicleSize, string> = {
  turismo: "Sedán, hatchback, coupé",
  camioneta: "SUV, crossover, minivan",
  pickup: "Pick-up sencilla o doble cabina",
  oversize: "Camiones, microbuses, buses",
};

// ---------------- Menú de servicios ----------------
export const CARWASH_SERVICE_KINDS = ["wash", "extra"] as const;
export type CarwashServiceKind = (typeof CARWASH_SERVICE_KINDS)[number];
export const CARWASH_SERVICE_KIND_LABELS: Record<CarwashServiceKind, string> = { wash: "Lavado", extra: "Extra" };

/** Precio por tamaño en centavos. null = precio a convenir (se escribe al registrar el carro). */
export type CarwashPrices = Record<VehicleSize, number | null>;

export const COMMISSION_TYPES = ["percent", "fixed"] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];
export interface Commission {
  type: CommissionType;
  /** percent: porcentaje (0 a 100). fixed: centavos por servicio */
  value: number;
}

export interface CarwashService extends BaseDoc {
  name: string;
  description: string;
  kind: CarwashServiceKind;
  prices: CarwashPrices;
  /** duración estimada en minutos */
  minutes: number;
  commission: Commission;
  active: boolean;
  sort: number;
}

// ---------------- Lavados ----------------
export const WASH_STATUSES = ["waiting", "washing", "ready", "delivered", "cancelled"] as const;
export type WashStatus = (typeof WASH_STATUSES)[number];
export const QUEUE_STATUSES = ["waiting", "washing", "ready", "delivered"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const WASH_STATUS_LABELS: Record<WashStatus, string> = {
  waiting: "En espera",
  washing: "Lavando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export type WashCoverage = "membership" | "reward";
export const WASH_COVERAGE_LABELS: Record<WashCoverage, string> = { membership: "Membresía", reward: "Premio de lealtad" };

export interface WashItem {
  serviceId: string;
  name: string;
  kind: CarwashServiceKind;
  /** precio de menú para el tamaño (o el escrito a mano) */
  listPrice: number;
  /** lo que se cobra por esta línea (0 si la cubre la membresía) */
  price: number;
  covered: WashCoverage | null;
  /** comisión del lavador por esta línea (centavos) */
  commission: number;
}

export interface Wash {
  id: string;
  number: number;
  code: string; // LAV-0001
  status: WashStatus;
  plate: string;
  vehicleId: string | null;
  customerId: string | null;
  customerName: string;
  phone: string;
  size: VehicleSize;
  items: WashItem[];
  /** total a cobrar (con ISV según la configuración y después de descuento) */
  total: number;
  totals: Totals;
  taxRate: number;
  taxMode: CarwashTaxMode;
  discount: number;
  washerId: string | null;
  washerName: string;
  commission: number;
  paid: boolean;
  saleId: string | null;
  saleCode: string | null;
  membershipId: string | null;
  membershipCode: string | null;
  loyaltyRedeemed: boolean;
  /** el cobro sumó un sello a la tarjeta de lealtad */
  loyaltyCounted?: boolean;
  /** sellos que quedaron después de este lavado (para el ticket) */
  loyaltyStamps?: number | null;
  loyaltyEvery?: number;
  /** se entregó sin cobrar (autorizado por gerencia) */
  deliveredUnpaid?: boolean;
  notes: string;
  cancelReason: string;
  createdAt: TimestampLike;
  startedAt: TimestampLike | null;
  readyAt: TimestampLike | null;
  deliveredAt: TimestampLike | null;
  paidAt?: TimestampLike | null;
  cancelledAt?: TimestampLike | null;
  createdBy: string;
  createdByName: string;
  updatedAt?: TimestampLike;
  updatedBy?: string;
}

// ---------------- Lealtad ----------------
export interface CarwashLoyalty {
  id: string; // placa normalizada
  count: number;
  rewardsAvailable: number;
  rewardsUsed: number;
  totalWashes: number;
  lastWashAt: TimestampLike | null;
  customerName: string;
  phone: string;
  size: VehicleSize | null;
  customerId: string | null;
  vehicleId: string | null;
}

// ---------------- Membresías ----------------
export interface CarwashPlan extends BaseDoc {
  name: string;
  size: VehicleSize;
  /** precio mensual en centavos */
  price: number;
  includedServiceIds: string[];
  /** null = ilimitado */
  washesPerMonth: number | null;
  active: boolean;
}

export const MEMBERSHIP_STATUSES = ["active", "expired", "cancelled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = { active: "Activa", expired: "Vencida", cancelled: "Cancelada" };

export interface MembershipHistoryEntry {
  kind: "new" | "renewal";
  saleId: string;
  saleCode: string;
  months: number;
  amount: number;
  /** epoch ms */
  at: number;
}

export interface CarwashMembership {
  id: string;
  number: number;
  code: string; // MEM-0001
  customerId: string | null;
  customerName: string;
  phone: string;
  plate: string;
  planId: string;
  planName: string;
  plan: { size: VehicleSize; price: number; includedServiceIds: string[]; includedNames: string[]; washesPerMonth: number | null };
  status: MembershipStatus;
  periodStart: TimestampLike;
  periodEnd: TimestampLike;
  /** pagada hasta (fin del último mes pagado) */
  paidUntil: TimestampLike;
  usedInPeriod: number;
  totalPaid: number;
  renewals: number;
  history: MembershipHistoryEntry[];
  cancelReason?: string;
  createdAt: TimestampLike;
  createdBy: string;
  createdByName: string;
  updatedAt?: TimestampLike;
}

// ---------------- Configuración (settings/carwash) ----------------
export const CARWASH_TAX_MODES = ["included", "add", "exempt"] as const;
export type CarwashTaxMode = (typeof CARWASH_TAX_MODES)[number];
export const CARWASH_TAX_MODE_LABELS: Record<CarwashTaxMode, string> = {
  included: "Los precios ya incluyen ISV",
  add: "Al precio se le suma el ISV",
  exempt: "Sin ISV",
};
export const REWARD_MODES = ["cheapest", "upTo"] as const;
export type RewardMode = (typeof REWARD_MODES)[number];

export interface CarwashSettings {
  /** cada cuántos lavados pagados se gana uno gratis (0 = desactivado) */
  loyaltyEvery: number;
  /** cheapest: el premio cubre el lavado más barato del tamaño. upTo: cubre hasta rewardMaxPrice */
  rewardMode: RewardMode;
  rewardMaxPrice: number;
  taxMode: CarwashTaxMode;
  ticketHeader: string;
  ticketFooter: string;
  updatedAt?: TimestampLike;
  updatedBy?: string;
}

export const DEFAULT_CARWASH_SETTINGS: CarwashSettings = {
  loyaltyEvery: 10,
  rewardMode: "cheapest",
  rewardMaxPrice: 0,
  taxMode: "included",
  ticketHeader: "",
  ticketFooter: "Gracias por su visita. Revise su vehículo antes de retirarse.",
};

export function carwashSettingsFrom(data: Partial<CarwashSettings> | null | undefined): CarwashSettings {
  const d = { ...DEFAULT_CARWASH_SETTINGS, ...(data ?? {}) };
  return {
    ...d,
    loyaltyEvery: Math.max(0, Math.min(100, Math.floor(Number(d.loyaltyEvery) || 0))),
    rewardMode: (REWARD_MODES as readonly string[]).includes(d.rewardMode) ? d.rewardMode : "cheapest",
    rewardMaxPrice: Math.max(0, Math.round(Number(d.rewardMaxPrice) || 0)),
    taxMode: (CARWASH_TAX_MODES as readonly string[]).includes(d.taxMode) ? d.taxMode : "included",
  };
}

// ============================================================================
// Cálculos puros
// ============================================================================

/** Normaliza una placa para el carwash: mayúsculas, sin espacios ni guiones. */
export const washPlate = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function priceForSize(service: { prices: Partial<CarwashPrices> }, size: VehicleSize): number | null {
  const v = service.prices?.[size];
  return typeof v === "number" && v >= 0 ? v : null;
}

/** Comisión del lavador sobre el precio de menú (aunque la línea vaya cubierta por membresía o premio). */
export function computeCommission(commission: Commission | null | undefined, base: number): number {
  if (!commission || !(commission.value > 0)) return 0;
  if (commission.type === "fixed") return Math.round(commission.value);
  return Math.round((Math.max(0, base) * Math.min(100, commission.value)) / 100);
}

/** Tope del premio de lealtad para un tamaño (null = no hay lavado para ese tamaño). */
export function rewardCap(
  settings: Pick<CarwashSettings, "rewardMode" | "rewardMaxPrice">,
  services: Array<Pick<CarwashService, "kind" | "prices" | "active">>,
  size: VehicleSize,
): number | null {
  if (settings.rewardMode === "upTo") return settings.rewardMaxPrice > 0 ? settings.rewardMaxPrice : null;
  const prices = services
    .filter((s) => s.active && s.kind === "wash")
    .map((s) => priceForSize(s, size))
    .filter((p): p is number => p !== null && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

export interface WashSelection {
  serviceId: string;
  /** precio escrito a mano (solo si el servicio no tiene precio para ese tamaño) */
  price?: number | null;
}

/**
 * Arma las líneas del lavado: precio por tamaño, cobertura de membresía o premio y comisión.
 * Lanza Error con un mensaje claro si algo no cuadra.
 */
export function buildWashItems(args: {
  size: VehicleSize;
  selections: WashSelection[];
  services: Array<Pick<CarwashService, "id" | "name" | "kind" | "prices" | "commission" | "active">>;
  /** servicios incluidos en la membresía (si se aplica) */
  membershipServiceIds?: string[] | null;
  /** tope del premio de lealtad (si se aplica) */
  rewardCap?: number | null;
}): WashItem[] {
  if (!args.selections.length) throw new Error("Seleccione al menos un servicio.");
  const seen = new Set<string>();
  const items: WashItem[] = args.selections.map((sel) => {
    if (seen.has(sel.serviceId)) throw new Error("Hay un servicio repetido.");
    seen.add(sel.serviceId);
    const s = args.services.find((x) => x.id === sel.serviceId);
    if (!s) throw new Error("Uno de los servicios ya no existe.");
    const menu = priceForSize(s, args.size);
    const listPrice = menu ?? (typeof sel.price === "number" && sel.price >= 0 ? Math.round(sel.price) : null);
    if (listPrice === null) throw new Error(`Escriba el precio de "${s.name}" para este tamaño (precio a convenir).`);
    return { serviceId: s.id, name: s.name, kind: s.kind, listPrice, price: listPrice, covered: null, commission: computeCommission(s.commission, listPrice) };
  });
  if (items.filter((i) => i.kind === "wash").length > 1) throw new Error("Seleccione un solo lavado (los demás van como extras).");

  const included = new Set(args.membershipServiceIds ?? []);
  if (args.membershipServiceIds) {
    for (const it of items) {
      if (included.has(it.serviceId)) {
        it.price = 0;
        it.covered = "membership";
      }
    }
  }
  if (args.rewardCap != null && args.rewardCap > 0) {
    const main = items.find((i) => i.kind === "wash" && !i.covered);
    if (!main) throw new Error("El premio de lealtad se aplica a un lavado: seleccione uno.");
    main.price = Math.max(0, main.listPrice - args.rewardCap);
    main.covered = "reward";
  }
  return items;
}

export const washCommissionTotal = (items: Array<Pick<WashItem, "commission">>) => items.reduce((a, i) => a + (i.commission || 0), 0);

export interface ChargeLine {
  unitPrice: number;
  discount: number;
  taxable: boolean;
  lineTotal: number;
}

/**
 * Líneas para la venta y totales según el modo de ISV.
 * - add: el precio es sin ISV y se le suma.
 * - included: el precio ya incluye ISV; se separa la base para que el total sea exactamente el precio.
 * - exempt: sin ISV.
 * El descuento (monto final, con ISV si aplica) se reparte empezando por la primera línea.
 */
export function computeWashCharge(
  prices: number[],
  taxRate: number,
  taxMode: CarwashTaxMode,
  discount = 0,
): { lines: ChargeLine[]; totals: Totals } {
  const gross = prices.map((p) => Math.max(0, Math.round(p)));
  let left = Math.max(0, Math.round(discount));
  const shares = gross.map((g) => {
    const s = Math.min(g, left);
    left -= s;
    return s;
  });
  const taxable = taxMode !== "exempt" && taxRate > 0;
  const run = (unit: number[], disc: number[]) =>
    computeQuote(unit.map((u, i) => ({ id: String(i), type: "other" as const, description: "", qty: 1, unitCost: 0, unitPrice: u, discount: disc[i] ?? 0, taxable })), taxable ? taxRate : 0);

  if (taxMode !== "included" || !taxable) {
    const r = run(gross, shares);
    return { lines: r.items.map((i) => ({ unitPrice: i.unitPrice, discount: i.discount, taxable, lineTotal: i.lineTotal })), totals: r.totals };
  }

  const k = 100 / (100 + taxRate);
  const target = gross.reduce((a, g, i) => a + g - shares[i]!, 0);
  const unit = gross.map((g) => Math.round(g * k));
  const disc = gross.map((g, i) => Math.max(0, unit[i]! - Math.round((g - shares[i]!) * k)));
  let r = run(unit, disc);
  // Ajuste de centavos por redondeo: el total debe quedar igual al precio anunciado.
  for (let n = 0; n < 6 && r.totals.total !== target; n++) {
    const idx = unit.findIndex((u, i) => u - disc[i]! > 0);
    if (idx < 0) break;
    const diff = target - r.totals.total;
    const step = Math.sign(diff) * Math.max(1, Math.round(Math.abs(diff) * k));
    unit[idx] = Math.max(disc[idx]!, unit[idx]! + step);
    r = run(unit, disc);
  }
  if (r.totals.total !== target) {
    // Hay totales que el redondeo del ISV no alcanza: el ISV absorbe el centavo (precio con ISV incluido).
    const net = r.totals.subtotal - r.totals.discount;
    r = { ...r, totals: { ...r.totals, tax: target - net, total: target } };
  }
  return { lines: r.items.map((i) => ({ unitPrice: i.unitPrice, discount: i.discount, taxable, lineTotal: i.lineTotal })), totals: r.totals };
}

/** Total sin ISV (ingreso real del carwash). */
export const netOf = (t: Totals) => t.subtotal - t.discount;

/** Suma un lavado pagado a la tarjeta de lealtad. Al completar "every" se genera un premio. */
export function applyLoyaltyWash(state: { count: number; rewardsAvailable: number }, every: number): { count: number; rewardsAvailable: number; earned: boolean } {
  if (!(every > 0)) return { count: state.count, rewardsAvailable: state.rewardsAvailable, earned: false };
  let count = Math.max(0, state.count) + 1;
  let rewardsAvailable = Math.max(0, state.rewardsAvailable);
  let earned = false;
  if (count >= every) {
    count -= every;
    rewardsAvailable += 1;
    earned = true;
  }
  return { count, rewardsAvailable, earned };
}

/** "7 de 10 sellos" / "Tiene 1 lavado gratis disponible" */
export function loyaltyText(count: number, every: number, rewardsAvailable = 0): string {
  if (!(every > 0)) return "";
  if (rewardsAvailable > 0) return `Tarjeta de lealtad: tiene ${rewardsAvailable === 1 ? "1 lavado gratis disponible" : `${rewardsAvailable} lavados gratis disponibles`}.`;
  const left = every - count;
  return `Tarjeta de lealtad: ${count} de ${every} sellos. ${left === 1 ? "¡En su próxima visita el lavado es gratis!" : `Le faltan ${left} para un lavado gratis.`}`;
}

// ---------------- Fechas (hora de Honduras, UTC-6 fijo) ----------------
const HN_MS = 6 * 3600 * 1000;

/** Suma meses respetando el calendario de Honduras (31 ene + 1 mes = 28/29 feb). */
export function addMonthsHN(ms: number, months: number): number {
  const d = new Date(ms - HN_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), last);
  return Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) + HN_MS;
}

export interface MembershipWindowInput {
  status: MembershipStatus;
  periodStart: number;
  periodEnd: number;
  paidUntil: number;
  usedInPeriod: number;
}

/**
 * Estado vigente de una membresía a la fecha "now": vencida si ya pasó la fecha pagada;
 * si el mes en curso terminó y sigue pagada, pasa al siguiente mes con el uso en 0.
 */
export function membershipWindow(m: MembershipWindowInput, now: number): { active: boolean; periodStart: number; periodEnd: number; usedInPeriod: number; rolled: boolean } {
  let { periodStart, periodEnd, usedInPeriod } = m;
  const active = m.status === "active" && now < m.paidUntil;
  let rolled = false;
  if (active) {
    let guard = 0;
    while (periodEnd <= now && guard++ < 240) {
      periodStart = periodEnd;
      periodEnd = Math.min(addMonthsHN(periodStart, 1), m.paidUntil);
      usedInPeriod = 0;
      rolled = true;
    }
  }
  return { active, periodStart, periodEnd, usedInPeriod, rolled };
}

/** ¿Puede usar la membresía en otro lavado este mes? */
export function membershipCanUse(washesPerMonth: number | null, usedInPeriod: number): boolean {
  return washesPerMonth === null || usedInPeriod < washesPerMonth;
}

/** Nuevo período al vender o renovar "months" meses. */
export function extendMembership(
  current: { active: boolean; periodStart: number; periodEnd: number; paidUntil: number; usedInPeriod: number } | null,
  months: number,
  now: number,
): { periodStart: number; periodEnd: number; paidUntil: number; usedInPeriod: number; from: number } {
  if (current && current.active && current.paidUntil > now) {
    return { periodStart: current.periodStart, periodEnd: current.periodEnd, paidUntil: addMonthsHN(current.paidUntil, months), usedInPeriod: current.usedInPeriod, from: current.paidUntil };
  }
  const periodEnd = addMonthsHN(now, 1);
  return { periodStart: now, periodEnd, paidUntil: addMonthsHN(now, months), usedInPeriod: 0, from: now };
}

const monthFmt = new Intl.DateTimeFormat("es-HN", { month: "short", year: "numeric", timeZone: "America/Tegucigalpa" });
/** "oct 2026" o "oct 2026 a dic 2026" */
export function monthsLabel(from: number, until: number): string {
  const a = monthFmt.format(new Date(from)).replace(".", "");
  const b = monthFmt.format(new Date(until - 86400000)).replace(".", "");
  return a === b ? a : `${a} a ${b}`;
}

// ============================================================================
// Validaciones (entradas de las Cloud Functions)
// ============================================================================
const priceOrNull = cents.nullable();

export const saveCarwashServiceSchema = z.object({
  serviceId: id.nullish(),
  name: text(80).min(2, "El nombre es obligatorio"),
  description: text(300),
  kind: z.enum(CARWASH_SERVICE_KINDS),
  prices: z.object({ turismo: priceOrNull, camioneta: priceOrNull, pickup: priceOrNull, oversize: priceOrNull }),
  minutes: z.number({ error: "Minutos no válidos" }).int().min(0).max(1440),
  commission: z.object({ type: z.enum(COMMISSION_TYPES), value: z.number().min(0).max(100_000_00) })
    .refine((c) => c.type !== "percent" || c.value <= 100, { message: "El porcentaje de comisión debe ser de 0 a 100" }),
  active: z.boolean(),
});
export type SaveCarwashServiceInput = z.infer<typeof saveCarwashServiceSchema>;

export const reorderCarwashServicesSchema = z.object({ ids: z.array(id).min(1).max(200) });

export const saveCarwashPlanSchema = z.object({
  planId: id.nullish(),
  name: text(80).min(2, "El nombre es obligatorio"),
  size: z.enum(VEHICLE_SIZES),
  price: cents.refine((v) => v > 0, "Indique el precio mensual"),
  includedServiceIds: z.array(id).min(1, "Seleccione al menos un servicio incluido").max(30),
  washesPerMonth: z.number().int().min(1).max(100).nullable(),
  active: z.boolean(),
});
export type SaveCarwashPlanInput = z.infer<typeof saveCarwashPlanSchema>;

const plateInput = z.string().trim().max(15).transform(washPlate).refine((p) => p.length >= 2 && p.length <= 12, "Placa no válida");

export const carwashLookupSchema = z.object({ plate: plateInput });

export const saveWashSchema = z.object({
  washId: id.nullish(),
  plate: plateInput,
  size: z.enum(VEHICLE_SIZES),
  customerId: id.nullish(),
  vehicleId: id.nullish(),
  customerName: text(120),
  phone: text(20),
  items: z.array(z.object({ serviceId: id, price: cents.nullish() })).min(1, "Seleccione al menos un servicio").max(20),
  washerId: id.nullish(),
  notes: text(500),
  useReward: z.boolean(),
  useMembership: z.boolean(),
  /** crear el cliente en el sistema si no existe (requiere nombre y teléfono) */
  createCustomer: z.boolean().nullish(),
});
export type SaveWashInput = z.infer<typeof saveWashSchema>;

export const setWashStatusSchema = z.object({ washId: id, status: z.enum(QUEUE_STATUSES) });
export type SetWashStatusInput = z.infer<typeof setWashStatusSchema>;

export const assignWasherSchema = z.object({ washId: id, washerId: id.nullable() });

export const cancelWashSchema = z.object({ washId: id, reason: text(300).min(3, "Indique el motivo") });

export const chargeWashSchema = z.object({
  washId: id,
  discount: cents,
  payments: createSaleSchema.shape.payments.min(1, "Agregue el pago"),
});
export type ChargeWashInput = z.infer<typeof chargeWashSchema>;

export const sellMembershipSchema = z.object({
  /** renovar una existente; sin valor = membresía nueva */
  membershipId: id.nullish(),
  planId: id,
  customerId: id.nullish(),
  customerName: text(120),
  phone: text(20),
  plate: plateInput,
  months: z.number().int().min(1).max(12),
  payments: createSaleSchema.shape.payments.min(1, "Agregue el pago"),
});
export type SellMembershipInput = z.infer<typeof sellMembershipSchema>;

export const cancelMembershipSchema = z.object({ membershipId: id, reason: text(300).min(3, "Indique el motivo") });

/** Vincular un lavado (y su placa) a un cliente del taller. Sin vehicleId se reusa o crea el vehículo de esa placa. */
export const linkWashCustomerSchema = z.object({ washId: id, customerId: id, vehicleId: id.nullish() });
export type LinkWashCustomerInput = z.infer<typeof linkWashCustomerSchema>;

export interface SaveWashResult {
  washId: string;
  code: string;
  total: number;
  paid: boolean;
  customerId: string | null;
  vehicleId: string | null;
  /** se agregó la placa a los vehículos del cliente */
  vehicleCreated: boolean;
}

export interface LinkWashCustomerResult {
  customerId: string;
  vehicleId: string;
  vehicleCreated: boolean;
  /** lavados de la misma placa que quedaron vinculados (incluye este) */
  linkedWashes: number;
}

// ============================================================================
// Carros del carwash en el taller (vehículo mínimo)
// ============================================================================

/** Marca y modelo de un vehículo registrado desde el carwash (se completan en el taller). */
export const CARWASH_VEHICLE_PENDING = "Por completar";
export const CARWASH_VEHICLE_NOTE = "Registrado desde el carwash";

/** El vehículo se registró desde el carwash y le faltan marca/modelo. */
export const isPendingVehicle = (v: { make?: string; model?: string } | null | undefined) =>
  !!v && (v.make === CARWASH_VEHICLE_PENDING || v.model === CARWASH_VEHICLE_PENDING);

/**
 * Documento mínimo de vehículo (sin timestamps ni autor) con la misma forma que los del taller:
 * pasa vehicleSchema y las reglas, así se puede editar después desde la ficha del vehículo.
 */
export function carwashVehicleData(args: { plate: string; customerId: string; customer: { fullName: string; phone: string }; year: number }) {
  const plate = washPlate(args.plate);
  return {
    customerId: args.customerId,
    customer: { fullName: args.customer.fullName, phone: args.customer.phone },
    make: CARWASH_VEHICLE_PENDING,
    model: CARWASH_VEHICLE_PENDING,
    year: args.year,
    color: "",
    plate,
    vin: "",
    mileage: 0,
    mileageUpdatedAt: null,
    fuelType: "gasolina" as const,
    engine: "",
    transmission: "automatica" as const,
    notes: CARWASH_VEHICLE_NOTE,
    coverPhotoUrl: "",
    photoCount: 0,
    archived: false,
    searchKeywords: buildSearchKeywords([plate, args.customer.fullName]),
  };
}

/**
 * De los vehículos con una misma placa, el que se enlaza al lavado:
 * primero uno activo del cliente, luego cualquiera activo, luego uno archivado del cliente, luego cualquiera.
 */
export function pickVehicleForPlate<T extends { id: string; customerId?: string | null; archived?: boolean | null }>(
  vehicles: T[],
  customerId: string | null,
): T | null {
  const own = (v: T) => !!customerId && v.customerId === customerId;
  return (
    vehicles.find((v) => !v.archived && own(v)) ??
    vehicles.find((v) => !v.archived) ??
    vehicles.find(own) ??
    vehicles[0] ??
    null
  );
}

/** Respuesta de carwashLookup (datos para registrar un carro por placa). */
export interface CarwashLookupResult {
  plate: string;
  vehicle: { id: string; label: string; customerId: string } | null;
  customer: { id: string; name: string; phone: string } | null;
  /** última vez en el carwash (nombre, teléfono y tamaño) */
  history: { customerName: string; phone: string; size: VehicleSize | null; totalWashes: number; lastWashAt: number | null } | null;
  loyalty: { count: number; rewardsAvailable: number; every: number };
  membership: {
    id: string; code: string; planName: string; size: VehicleSize; includedServiceIds: string[]; includedNames: string[];
    washesPerMonth: number | null; usedInPeriod: number; periodEnd: number; paidUntil: number; canUse: boolean;
  } | null;
  maintenance: Array<{ serviceName: string; status: string }>;
  /** lavado activo (en cola) con la misma placa */
  openWash: { id: string; code: string; status: WashStatus } | null;
}

// ============================================================================
// Menú de ejemplo (precios en lempiras; el taller los edita)
// ============================================================================
const L = (n: number) => n * 100;
export const SAMPLE_CARWASH_MENU: Array<Omit<SaveCarwashServiceInput, "serviceId" | "active">> = [
  { name: "Lavado básico", description: "Lavado exterior a mano, secado y limpieza de vidrios.", kind: "wash", minutes: 25, prices: { turismo: L(150), camioneta: L(180), pickup: L(200), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Lavado completo", description: "Exterior, aspirado de interiores, tablero y vidrios por dentro.", kind: "wash", minutes: 45, prices: { turismo: L(250), camioneta: L(300), pickup: L(330), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Lavado + encerado", description: "Lavado completo con cera protectora a mano.", kind: "wash", minutes: 75, prices: { turismo: L(450), camioneta: L(550), pickup: L(600), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Lavado de motor", description: "Desengrasado y lavado del motor con protección de partes eléctricas.", kind: "wash", minutes: 30, prices: { turismo: L(200), camioneta: L(250), pickup: L(250), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Limpieza interior profunda", description: "Aspirado, lavado de alfombras, tapicería y plásticos.", kind: "wash", minutes: 120, prices: { turismo: L(900), camioneta: L(1100), pickup: L(1000), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Lavado de chasis", description: "Lavado a presión de la parte de abajo y guardafangos.", kind: "wash", minutes: 30, prices: { turismo: L(150), camioneta: L(200), pickup: L(200), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Aromatizante", description: "Aromatizante para el interior.", kind: "extra", minutes: 2, prices: { turismo: L(40), camioneta: L(40), pickup: L(40), oversize: L(40) }, commission: { type: "fixed", value: 0 } },
  { name: "Abrillantado de llantas", description: "Limpieza y brillo de llantas.", kind: "extra", minutes: 10, prices: { turismo: L(60), camioneta: L(80), pickup: L(80), oversize: null }, commission: { type: "percent", value: 20 } },
  { name: "Limpieza de tapicería", description: "Lavado de asientos de tela.", kind: "extra", minutes: 60, prices: { turismo: L(500), camioneta: L(650), pickup: L(550), oversize: null }, commission: { type: "percent", value: 20 } },
];
