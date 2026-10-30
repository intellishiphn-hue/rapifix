import { z } from "zod";
import { normalizeUnit, type OdometerUnit } from "./odometer";
import { hnDayKey } from "./operations";
import { agingSummary, orderDueKey, paymentTermsDetail, paymentTermsLabel, type CompanyTerms } from "./companies";
import { clampStartStamps, isPlaceholderPlate, membershipWindow, type MembershipStatus, type WashStatus } from "./carwash";

/**
 * "Mi historial RAPIFIX": link privado y permanente de un cliente o de una empresa (flotilla).
 *
 * El servidor arma una copia pública y mínima en publicHistory/{token} con buildHistoryView
 * (lógica pura, sin Firebase). La página /historial/:token solo lee ese documento.
 * Aquí se decide QUÉ campos salen: solo se copian campos de una lista blanca, así nunca
 * se filtran costos internos, pago a técnicos, comisiones, notas internas ni datos de otros clientes.
 *
 * Dinero en centavos. Fechas como epoch ms (null si no hay). Lecturas de odómetro en su unidad.
 */

export const PUBLIC_HISTORY = "publicHistory";
export const HISTORY_KINDS = ["customer", "company"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** Token del link: 24 caracteres del alfabeto sin letras confusas (unos 118 bits). */
export const HISTORY_TOKEN_LENGTH = 24;
export const HISTORY_TOKEN_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{24}$/;

/** Límites para que el documento quepa holgado en 1 MB (ver docs/HISTORIAL.md). */
export const HISTORY_LIMITS = {
  vehicles: 150,
  visitsPerVehicle: 50,
  washesPerVehicle: 30,
  quotesPerVehicle: 10,
  maintenancePerVehicle: 12,
  linesPerVisit: 40,
  paymentsPerVisit: 10,
  fleetUpcoming: 30,
  /** se recorta (visitas y lavados más viejos) si el documento pasa de esto */
  maxBytes: 900_000,
  /** visitas que se conservan por vehículo aunque haya que recortar */
  minVisitsPerVehicle: 5,
} as const;

/** El link de cada orden (/orden/:token) deja de funcionar 30 días después de la entrega. */
export const PORTAL_LINK_DAYS = 30;
/** El link de cada lavado (/lavado/:token) deja de funcionar 90 días después de entregado. */
export const WASH_LINK_DAYS = 90;
const DAY = 86_400_000;

/** Lo que se guarda en el cliente o la empresa (campo `history`). Solo lo escribe el servidor. */
export interface HistoryLink {
  token: string | null;
  enabled: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
}

export const historyLinkSchema = z.object({
  kind: z.enum(HISTORY_KINDS),
  id: z.string().min(1).max(128),
});
export type HistoryLinkInput = z.infer<typeof historyLinkSchema>;

export const historyPath = (token: string) => `/historial/${token}`;

// ---------------------------------------------------------------------------
// Datos crudos (el servidor los lee de Firestore y convierte Timestamps a ms)
// ---------------------------------------------------------------------------
type Ms = number | null | undefined;

export interface RawHistoryVehicle {
  id: string;
  plate: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  mileage?: number;
  odometerUnit?: OdometerUnit | string | null;
  mileageUpdatedAt?: Ms;
  archived?: boolean;
  customerId?: string | null;
  companyId?: string | null;
  [k: string]: unknown;
}

export interface RawHistoryOrder {
  id: string;
  code?: string;
  status: string;
  customerId?: string | null;
  companyId?: string | null;
  vehicleId?: string | null;
  createdAt?: Ms;
  receivedAt?: Ms;
  deliveredAt?: Ms;
  statusChangedAt?: Ms;
  mileageIn?: number | null;
  mileageOut?: number | null;
  mileageUnit?: string | null;
  totals?: { total?: number } | null;
  paid?: number;
  balance?: number;
  portalToken?: string | null;
  portalEnabled?: boolean;
  activeQuoteId?: string | null;
  [k: string]: unknown;
}

export interface RawHistoryQuoteItem {
  type?: string;
  description?: string;
  qty?: number;
  [k: string]: unknown;
}

export interface RawHistoryQuote {
  id: string;
  code?: string;
  status: string;
  orderId?: string | null;
  vehicleId?: string | null;
  customerId?: string | null;
  publicToken?: string | null;
  items?: RawHistoryQuoteItem[];
  totals?: { total?: number } | null;
  createdAt?: Ms;
  sentAt?: Ms;
  validUntil?: Ms;
  [k: string]: unknown;
}

export interface RawHistoryPayment {
  id: string;
  code?: string;
  amount: number;
  method?: string;
  status?: string;
  orderId?: string | null;
  at?: Ms;
  [k: string]: unknown;
}

export interface RawHistoryMaintenance {
  id: string;
  vehicleId: string;
  serviceName?: string;
  status: string;
  nextDate?: Ms;
  nextMileage?: number | null;
  dueDate?: Ms;
  lastDate?: Ms;
  lastMileage?: number | null;
  odometerUnit?: string | null;
  [k: string]: unknown;
}

export interface RawHistoryWash {
  id: string;
  code?: string;
  plate: string;
  vehicleId?: string | null;
  customerId?: string | null;
  status: string;
  total?: number;
  paid?: boolean;
  items?: Array<{ name?: string; kind?: string; [k: string]: unknown }>;
  createdAt?: Ms;
  deliveredAt?: Ms;
  payToken?: string | null;
  [k: string]: unknown;
}

export interface RawHistoryLoyalty {
  plate: string;
  exists: boolean;
  count?: number;
  rewardsAvailable?: number;
  welcomePending?: boolean;
}

export interface RawHistoryMembership {
  id: string;
  code?: string;
  plate: string;
  planName?: string;
  status: string;
  periodStart?: Ms;
  periodEnd?: Ms;
  paidUntil?: Ms;
  usedInPeriod?: number;
  plan?: { washesPerMonth?: number | null } | null;
  [k: string]: unknown;
}

export interface HistoryWorkshop {
  name: string;
  logoUrl: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  hours: string;
}

export interface HistoryRaw {
  kind: HistoryKind;
  ownerId: string;
  /** nombre completo del cliente o nombre de la empresa */
  name: string;
  now: number;
  workshop: HistoryWorkshop;
  /** forma de pago de la empresa (solo empresas) */
  terms?: CompanyTerms | null;
  vehicles: RawHistoryVehicle[];
  orders: RawHistoryOrder[];
  quotes: RawHistoryQuote[];
  payments: RawHistoryPayment[];
  maintenance: RawHistoryMaintenance[];
  washes: RawHistoryWash[];
  loyalty: RawHistoryLoyalty[];
  memberships: RawHistoryMembership[];
  carwash: { loyaltyEvery: number; loyaltyStartStamps: number };
}

// ---------------------------------------------------------------------------
// Vista pública
// ---------------------------------------------------------------------------
export type MaintenanceUrgency = "overdue" | "due" | "upcoming";
export type VisitState = "in_shop" | "ready" | "delivered";

export interface HistoryMaintenanceView {
  service: string;
  status: MaintenanceUrgency;
  /** fecha estimada en que toca (la primera entre fecha y kilometraje) */
  dueAt: number | null;
  nextDate: number | null;
  nextMileage: number | null;
  unit: OdometerUnit;
  lastDate: number | null;
}

export interface HistoryLine {
  d: string;
  q: number;
}

export interface HistoryVisitView {
  code: string;
  state: VisitState;
  inAt: number | null;
  outAt: number | null;
  mileageIn: number | null;
  mileageOut: number | null;
  unit: OdometerUnit;
  /** mano de obra, servicios y otros cargos (solo descripción) */
  work: HistoryLine[];
  /** repuestos (descripción y cantidad) */
  parts: HistoryLine[];
  total: number;
  paid: number;
  balance: number;
  payments: Array<{ code: string; amount: number; method: string; at: number | null }>;
  /** "/orden/TOKEN" para ver el detalle y el recibo (null si la orden no tiene link) */
  link: string | null;
  /** hasta cuándo funciona el link (null = mientras la orden siga abierta) */
  linkUntil: number | null;
}

export interface HistoryQuoteView {
  code: string;
  status: "sent" | "viewed";
  total: number;
  items: number;
  sentAt: number | null;
  validUntil: number | null;
  link: string;
}

export interface HistoryWashView {
  code: string;
  at: number | null;
  services: string[];
  total: number;
  paid: boolean;
  state: WashStatus;
  link: string | null;
  linkUntil: number | null;
}

export interface HistoryVehicleView {
  key: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  mileage: number;
  unit: OdometerUnit;
  mileageAt: number | null;
  maintenance: HistoryMaintenanceView[];
  visits: HistoryVisitView[];
  /** visitas en total (puede ser más que las que se muestran) */
  visitsTotal: number;
  quotes: HistoryQuoteView[];
  washes: HistoryWashView[];
  washesTotal: number;
  loyalty: { count: number; every: number; rewardsAvailable: number } | null;
  membership: { code: string; planName: string; washesPerMonth: number | null; usedInPeriod: number; paidUntil: number; periodEnd: number } | null;
  /** gastado este año (visitas del año) y saldo pendiente del vehículo */
  spentYear: number;
  balance: number;
}

export interface HistoryUpcomingView extends HistoryMaintenanceView {
  plate: string;
  vehicle: string;
}

export interface HistorySummaryView {
  year: number;
  vehicles: number;
  visitsYear: number;
  spentYear: number;
  balance: number;
  /** solo empresas: saldo vencido según su forma de pago */
  overdue: number;
  termsLabel: string | null;
  termsDetail: string | null;
  /** próximos mantenimientos de todos los vehículos, del más urgente al menos */
  upcoming: HistoryUpcomingView[];
}

export interface PublicHistory {
  v: 1;
  kind: HistoryKind;
  active: boolean;
  name: string;
  workshop: HistoryWorkshop;
  generatedAt: number;
  summary: HistorySummaryView;
  vehicles: HistoryVehicleView[];
  /** se recortaron visitas o lavados viejos para que el documento quepa */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const yearOf = (t: number) => Number(hnDayKey(t).slice(0, 4));

/** Nombres del método de pago para el cliente (sin nombres de terminales ni pasarelas). */
const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", deposit: "Depósito", online: "Pago en línea", other: "Otro",
};

const WORK_TYPES = new Set(["labor", "service", "other"]);
const URGENCY: Record<MaintenanceUrgency, number> = { overdue: 0, due: 1, upcoming: 2 };

/** Del más urgente al menos: vencidos, próximos, programados; dentro de cada grupo, por fecha. */
export function sortByUrgency<T extends { status: MaintenanceUrgency; dueAt: number | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
}

function visitState(status: string): VisitState {
  if (status === "DELIVERED") return "delivered";
  if (status === "READY") return "ready";
  return "in_shop";
}

/** Cotización aprobada de la orden: la activa si está aprobada; si no, la aprobada más reciente. */
function approvedQuoteFor(order: RawHistoryOrder, quotes: RawHistoryQuote[]): RawHistoryQuote | null {
  let out: RawHistoryQuote | null = null;
  for (const q of quotes) {
    if (q.status !== "approved" || q.orderId !== order.id) continue;
    if (!out || q.id === order.activeQuoteId || (out.id !== order.activeQuoteId && num(q.createdAt) > num(out.createdAt))) out = q;
  }
  return out;
}

function lines(items: RawHistoryQuoteItem[] | undefined, part: boolean): HistoryLine[] {
  return (items ?? [])
    .filter((it) => (part ? it.type === "part" : WORK_TYPES.has(String(it.type))))
    .map((it) => ({ d: str(it.description, 140), q: Math.max(0, num(it.qty, 1)) }))
    .filter((l) => l.d)
    .slice(0, HISTORY_LIMITS.linesPerVisit);
}

function orderBalanceOf(o: RawHistoryOrder): number {
  const total = num(o.totals?.total);
  const b = typeof o.balance === "number" ? o.balance : total - num(o.paid);
  return Math.max(0, b);
}

function buildVisit(o: RawHistoryOrder, quotes: RawHistoryQuote[], payments: RawHistoryPayment[]): HistoryVisitView {
  const q = approvedQuoteFor(o, quotes);
  const state = visitState(o.status);
  const outAt = state === "delivered" ? ms(o.deliveredAt) ?? ms(o.statusChangedAt) : null;
  const token = typeof o.portalToken === "string" && o.portalToken && o.portalEnabled !== false ? o.portalToken : null;
  return {
    code: str(o.code, 30),
    state,
    inAt: ms(o.receivedAt) ?? ms(o.createdAt),
    outAt,
    mileageIn: o.mileageIn != null && num(o.mileageIn) > 0 ? num(o.mileageIn) : null,
    mileageOut: o.mileageOut != null && num(o.mileageOut) > 0 ? num(o.mileageOut) : null,
    unit: normalizeUnit(o.mileageUnit),
    work: lines(q?.items, false),
    parts: lines(q?.items, true),
    total: num(o.totals?.total),
    paid: num(o.paid),
    balance: orderBalanceOf(o),
    payments: payments
      .filter((p) => p.orderId === o.id && p.status !== "voided" && num(p.amount) > 0)
      .sort((a, b) => num(a.at) - num(b.at))
      .slice(0, HISTORY_LIMITS.paymentsPerVisit)
      .map((p) => ({ code: str(p.code, 30), amount: num(p.amount), method: METHOD_LABELS[String(p.method)] ?? "Pago", at: ms(p.at) })),
    link: token ? `/orden/${token}` : null,
    linkUntil: token && outAt ? outAt + PORTAL_LINK_DAYS * DAY : null,
  };
}

function buildMaintenance(m: RawHistoryMaintenance): HistoryMaintenanceView | null {
  if (m.status !== "overdue" && m.status !== "due" && m.status !== "upcoming") return null;
  const service = str(m.serviceName, 120);
  if (!service) return null;
  return {
    service,
    status: m.status,
    dueAt: ms(m.dueDate) ?? ms(m.nextDate),
    nextDate: ms(m.nextDate),
    nextMileage: m.nextMileage != null && num(m.nextMileage) > 0 ? Math.round(num(m.nextMileage)) : null,
    unit: normalizeUnit(m.odometerUnit),
    lastDate: ms(m.lastDate),
  };
}

const WASH_STATES = new Set(["waiting", "washing", "ready", "delivered"]);

function buildWash(w: RawHistoryWash): HistoryWashView {
  const delivered = ms(w.deliveredAt);
  const token = typeof w.payToken === "string" && w.payToken ? w.payToken : null;
  const total = num(w.total);
  return {
    code: str(w.code, 30),
    at: ms(w.createdAt),
    services: (w.items ?? []).map((i) => str(i.name, 80)).filter(Boolean).slice(0, 8),
    total,
    paid: w.paid === true || total === 0,
    state: w.status as WashStatus,
    link: token ? `/lavado/${token}` : null,
    linkUntil: token && delivered ? delivered + WASH_LINK_DAYS * DAY : null,
  };
}

/** ¿Este vehículo se muestra? Solo los vigentes del dueño (si cambió de dueño o se archivó, no). */
function ownsVehicle(raw: HistoryRaw, v: RawHistoryVehicle): boolean {
  if (v.archived === true) return false;
  if (raw.kind === "company") return v.companyId === raw.ownerId;
  // Los vehículos asignados a una empresa se ven en el historial de la empresa, no en el del chofer
  return v.customerId === raw.ownerId && !v.companyId;
}

/** ¿La orden es de este dueño? (evita mostrar visitas de un dueño anterior del mismo carro) */
function ownsOrder(raw: HistoryRaw, o: RawHistoryOrder): boolean {
  if (o.status === "CANCELLED") return false;
  return raw.kind === "company" ? o.companyId === raw.ownerId : o.customerId === raw.ownerId && !o.companyId;
}

export function buildHistoryView(raw: HistoryRaw): PublicHistory {
  const now = raw.now;
  const year = yearOf(now);
  const vehicles = raw.vehicles.filter((v) => ownsVehicle(raw, v)).sort((a, b) => str(a.plate, 20).localeCompare(str(b.plate, 20))).slice(0, HISTORY_LIMITS.vehicles);
  const vehicleIds = new Set(vehicles.map((v) => v.id));
  const orders = raw.orders.filter((o) => !!o.vehicleId && vehicleIds.has(o.vehicleId) && ownsOrder(raw, o));
  const orderIds = new Set(orders.map((o) => o.id));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const loyaltyByPlate = new Map(raw.loyalty.map((l) => [l.plate, l]));
  const every = Math.max(0, Math.floor(num(raw.carwash.loyaltyEvery)));

  let spentYearAll = 0;
  let visitsYear = 0;
  let balanceAll = 0;
  const dueItems: Array<{ balance: number; dueKey: string | null }> = [];

  const views: HistoryVehicleView[] = vehicles.map((v) => {
    const plate = str(v.plate, 20);
    const vOrders = orders.filter((o) => o.vehicleId === v.id);
    const visits = vOrders.map((o) => buildVisit(o, raw.quotes, raw.payments)).sort((a, b) => (b.inAt ?? 0) - (a.inAt ?? 0));
    let spentYear = 0;
    let balance = 0;
    for (const vi of visits) {
      if (vi.inAt && yearOf(vi.inAt) === year) {
        spentYear += vi.total;
        visitsYear++;
      }
      balance += vi.balance;
    }
    for (const o of vOrders) {
      const b = orderBalanceOf(o);
      if (b > 0) dueItems.push({ balance: b, dueKey: orderDueKey(raw.terms ?? null, o.status === "DELIVERED" ? ms(o.deliveredAt) ?? ms(o.statusChangedAt) : null) });
    }
    spentYearAll += spentYear;
    balanceAll += balance;

    const maintenance = sortByUrgency(
      raw.maintenance.filter((m) => m.vehicleId === v.id).map(buildMaintenance).filter((m): m is HistoryMaintenanceView => !!m),
    ).slice(0, HISTORY_LIMITS.maintenancePerVehicle);

    const quotes: HistoryQuoteView[] = raw.quotes
      .filter((q) => (q.status === "sent" || q.status === "viewed") && q.vehicleId === v.id)
      .filter((q) => (q.orderId ? orderIds.has(q.orderId) : raw.kind === "company" || q.customerId === raw.ownerId))
      .map((q) => {
        const token = q.orderId ? orderById.get(q.orderId)?.portalToken : q.publicToken;
        return token
          ? {
              code: str(q.code, 30), status: q.status as "sent" | "viewed", total: num(q.totals?.total), items: (q.items ?? []).length,
              sentAt: ms(q.sentAt), validUntil: ms(q.validUntil), link: `/orden/${token}/cotizacion`,
            }
          : null;
      })
      .filter((q): q is HistoryQuoteView => !!q)
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
      .slice(0, HISTORY_LIMITS.quotesPerVehicle);

    const realPlate = !!plate && !isPlaceholderPlate(plate);
    const washes = realPlate
      ? raw.washes
          .filter((w) => w.plate === plate && WASH_STATES.has(w.status))
          // lavados de otra persona con la misma placa (antes de comprar el carro) no se muestran
          .filter((w) => raw.kind === "company" || !w.customerId || w.customerId === raw.ownerId)
          .map(buildWash)
          .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      : [];

    const card = realPlate ? loyaltyByPlate.get(plate) : undefined;
    const gift = card && (!card.exists || card.welcomePending === true) ? clampStartStamps(raw.carwash.loyaltyStartStamps, every) : 0;
    const loyalty = every > 0 && card && (card.exists || washes.length > 0)
      ? { count: Math.min(Math.max(0, every - 1), Math.max(0, num(card.count)) + gift), every, rewardsAvailable: Math.max(0, num(card.rewardsAvailable)) }
      : null;

    let membership: HistoryVehicleView["membership"] = null;
    if (realPlate) {
      for (const m of raw.memberships.filter((x) => x.plate === plate)) {
        const w = membershipWindow(
          { status: m.status as MembershipStatus, periodStart: num(m.periodStart), periodEnd: num(m.periodEnd), paidUntil: num(m.paidUntil), usedInPeriod: num(m.usedInPeriod) },
          now,
        );
        if (!w.active) continue;
        if (membership && membership.paidUntil >= num(m.paidUntil)) continue;
        membership = {
          code: str(m.code, 30), planName: str(m.planName, 80), washesPerMonth: m.plan?.washesPerMonth ?? null,
          usedInPeriod: w.usedInPeriod, paidUntil: num(m.paidUntil), periodEnd: w.periodEnd,
        };
      }
    }

    return {
      key: v.id,
      plate,
      make: str(v.make, 40),
      model: str(v.model, 60),
      year: num(v.year),
      color: str(v.color, 30),
      mileage: Math.round(num(v.mileage)),
      unit: normalizeUnit(v.odometerUnit),
      mileageAt: ms(v.mileageUpdatedAt),
      maintenance,
      visits: visits.slice(0, HISTORY_LIMITS.visitsPerVehicle),
      visitsTotal: visits.length,
      quotes,
      washes: washes.slice(0, HISTORY_LIMITS.washesPerVehicle),
      washesTotal: washes.length,
      loyalty,
      membership,
      spentYear,
      balance,
    };
  });

  const upcoming: HistoryUpcomingView[] = sortByUrgency(
    views.flatMap((v) => v.maintenance.map((m) => ({ ...m, plate: v.plate, vehicle: [v.make, v.model, v.year || ""].filter(Boolean).join(" ") }))),
  ).slice(0, HISTORY_LIMITS.fleetUpcoming);

  const isCompany = raw.kind === "company";
  const aging = isCompany ? agingSummary(dueItems, hnDayKey(now)) : null;
  const view: PublicHistory = {
    v: 1,
    kind: raw.kind,
    active: true,
    name: str(raw.name, 130),
    workshop: raw.workshop,
    generatedAt: now,
    summary: {
      year,
      vehicles: views.length,
      visitsYear,
      spentYear: spentYearAll,
      balance: balanceAll,
      overdue: aging?.overdue ?? 0,
      termsLabel: isCompany ? paymentTermsLabel(raw.terms ?? null) : null,
      termsDetail: isCompany ? paymentTermsDetail(raw.terms ?? null) : null,
      upcoming,
    },
    vehicles: views,
    truncated: false,
  };
  return fitHistorySize(view);
}

/** Bytes UTF-8 de un texto (sin depender de TextEncoder). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Tamaño aproximado del documento (JSON en UTF-8: un poco más que lo que cuenta Firestore). */
export const historyBytes = (v: unknown) => utf8Bytes(JSON.stringify(v));

/**
 * Si el documento pasa de `maxBytes`, quita primero los lavados más viejos y luego las visitas
 * más viejas (dejando al menos `minVisitsPerVehicle` por vehículo). Marca `truncated`.
 */
export function fitHistorySize(view: PublicHistory, maxBytes: number = HISTORY_LIMITS.maxBytes): PublicHistory {
  let size = historyBytes(view);
  if (size <= maxBytes) return view;
  const out: PublicHistory = { ...view, truncated: true, vehicles: view.vehicles.map((v) => ({ ...v, visits: [...v.visits], washes: [...v.washes] })) };
  size = historyBytes(out);

  // 1. Lavados viejos (los más viejos de todos los vehículos primero)
  const washes = out.vehicles.flatMap((v, vi) => v.washes.map((w, i) => ({ vi, i, at: w.at ?? 0, bytes: historyBytes(w) + 1 })));
  washes.sort((a, b) => a.at - b.at);
  const dropW = new Set<string>();
  for (const w of washes) {
    if (size <= maxBytes) break;
    if (w.i < 3) continue; // los 3 más recientes de cada vehículo se quedan
    dropW.add(`${w.vi}:${w.i}`);
    size -= w.bytes;
  }
  // 2. Visitas viejas
  const visits = out.vehicles.flatMap((v, vi) => v.visits.map((x, i) => ({ vi, i, at: x.inAt ?? 0, bytes: historyBytes(x) + 1 })));
  visits.sort((a, b) => a.at - b.at);
  const dropV = new Set<string>();
  for (const x of visits) {
    if (size <= maxBytes) break;
    if (x.i < HISTORY_LIMITS.minVisitsPerVehicle) continue;
    dropV.add(`${x.vi}:${x.i}`);
    size -= x.bytes;
  }
  out.vehicles = out.vehicles.map((v, vi) => ({
    ...v,
    washes: v.washes.filter((_, i) => !dropW.has(`${vi}:${i}`)),
    visits: v.visits.filter((_, i) => !dropV.has(`${vi}:${i}`)),
  }));
  // 3. Último recurso: menos líneas por visita
  if (historyBytes(out) > maxBytes) {
    out.vehicles = out.vehicles.map((v) => ({ ...v, visits: v.visits.map((x) => ({ ...x, work: x.work.slice(0, 8), parts: x.parts.slice(0, 8), payments: x.payments.slice(-3) })) }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lectura en la página pública (nunca confía en la forma del JSON)
// ---------------------------------------------------------------------------
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const link = (v: unknown, prefix: "/orden/" | "/lavado/") => (typeof v === "string" && v.startsWith(prefix) && /^[/A-Za-z0-9]+$/.test(v) && v.length < 80 ? v : null);
const urgency = (v: unknown): MaintenanceUrgency => (v === "overdue" || v === "due" ? v : "upcoming");

function parseMaint(m: Record<string, unknown>): HistoryMaintenanceView {
  return {
    service: str(m.service, 120), status: urgency(m.status), dueAt: ms(m.dueAt), nextDate: ms(m.nextDate),
    nextMileage: ms(m.nextMileage), unit: normalizeUnit(m.unit), lastDate: ms(m.lastDate),
  };
}
const parseLines = (v: unknown): HistoryLine[] => arr(v).map((l) => ({ d: str(l.d, 140), q: num(l.q, 1) })).filter((l) => l.d);

export function parsePublicHistory(raw: unknown): PublicHistory {
  const d = obj(raw);
  const s = obj(d.summary);
  const w = obj(d.workshop);
  return {
    v: 1,
    kind: d.kind === "company" ? "company" : "customer",
    active: d.active !== false,
    name: str(d.name, 130),
    workshop: {
      name: str(w.name, 80) || "RAPIFIX", logoUrl: str(w.logoUrl, 2000), phone: str(w.phone, 30), whatsapp: str(w.whatsapp, 30),
      address: str(w.address, 250), city: str(w.city, 60), hours: str(w.hours, 200),
    },
    generatedAt: num(d.generatedAt),
    truncated: d.truncated === true,
    summary: {
      year: num(s.year), vehicles: num(s.vehicles), visitsYear: num(s.visitsYear), spentYear: num(s.spentYear), balance: num(s.balance),
      overdue: num(s.overdue), termsLabel: str(s.termsLabel, 80) || null, termsDetail: str(s.termsDetail, 200) || null,
      upcoming: arr(s.upcoming).map((u) => ({ ...parseMaint(u), plate: str(u.plate, 20), vehicle: str(u.vehicle, 120) })).filter((u) => u.service),
    },
    vehicles: arr(d.vehicles).map((v) => {
      const loyalty = obj(v.loyalty);
      const mem = obj(v.membership);
      return {
        key: str(v.key, 128), plate: str(v.plate, 20), make: str(v.make, 40), model: str(v.model, 60), year: num(v.year), color: str(v.color, 30),
        mileage: num(v.mileage), unit: normalizeUnit(v.unit), mileageAt: ms(v.mileageAt),
        maintenance: arr(v.maintenance).map(parseMaint).filter((m) => m.service),
        visits: arr(v.visits).map((x) => ({
          code: str(x.code, 30), state: x.state === "delivered" || x.state === "ready" ? x.state : "in_shop",
          inAt: ms(x.inAt), outAt: ms(x.outAt), mileageIn: ms(x.mileageIn), mileageOut: ms(x.mileageOut), unit: normalizeUnit(x.unit),
          work: parseLines(x.work), parts: parseLines(x.parts), total: num(x.total), paid: num(x.paid), balance: num(x.balance),
          payments: arr(x.payments).map((p) => ({ code: str(p.code, 30), amount: num(p.amount), method: str(p.method, 40), at: ms(p.at) })),
          link: link(x.link, "/orden/"), linkUntil: ms(x.linkUntil),
        })),
        visitsTotal: num(v.visitsTotal),
        quotes: arr(v.quotes).map((q) => ({
          code: str(q.code, 30), status: q.status === "viewed" ? ("viewed" as const) : ("sent" as const), total: num(q.total), items: num(q.items),
          sentAt: ms(q.sentAt), validUntil: ms(q.validUntil), link: link(q.link, "/orden/") ?? "",
        })).filter((q) => q.link),
        washes: arr(v.washes).map((x) => ({
          code: str(x.code, 30), at: ms(x.at), services: (Array.isArray(x.services) ? x.services : []).map((n) => str(n, 80)).filter(Boolean),
          total: num(x.total), paid: x.paid === true, state: (WASH_STATES.has(String(x.state)) ? x.state : "delivered") as WashStatus,
          link: link(x.link, "/lavado/"), linkUntil: ms(x.linkUntil),
        })),
        washesTotal: num(v.washesTotal),
        loyalty: v.loyalty ? { count: num(loyalty.count), every: num(loyalty.every), rewardsAvailable: num(loyalty.rewardsAvailable) } : null,
        membership: v.membership
          ? { code: str(mem.code, 30), planName: str(mem.planName, 80), washesPerMonth: typeof mem.washesPerMonth === "number" ? mem.washesPerMonth : null, usedInPeriod: num(mem.usedInPeriod), paidUntil: num(mem.paidUntil), periodEnd: num(mem.periodEnd) }
          : null,
        spentYear: num(v.spentYear),
        balance: num(v.balance),
      };
    }),
  };
}

/** ¿El link de una visita o lavado sigue funcionando hoy? */
export const historyLinkAlive = (x: { link: string | null; linkUntil: number | null }, now: number) => !!x.link && (x.linkUntil === null || x.linkUntil > now);

/**
 * Link para pedir cita desde el historial: /agendar con el motivo, la placa, el vehículo y el servicio
 * prellenados (BookingPage lee motivo, placa, vehiculo y detalle).
 */
export function historyBookingUrl(opts: { reason?: "mantenimiento" | "carwash" | "otro"; service?: string; plate?: string; vehicle?: string } = {}): string {
  const q = new URLSearchParams({ motivo: opts.reason ?? "mantenimiento" });
  if (opts.plate) q.set("placa", opts.plate.slice(0, 12));
  if (opts.vehicle) q.set("vehiculo", opts.vehicle.slice(0, 60));
  if (opts.service) q.set("detalle", opts.service.slice(0, 120));
  return `/agendar?${q.toString()}`;
}

/** Mensaje de WhatsApp con el link del historial (lo prepara el panel; el empleado lo puede editar). */
export function historyWhatsAppMessage(kind: HistoryKind, name: string, url: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return kind === "company"
    ? `Hola${first ? `, ${name.trim()}` : ""}. Le compartimos el historial de su flotilla en RAPIFIX: visitas de cada unidad, trabajos realizados, pagos y próximos mantenimientos. Es un enlace privado, guárdelo para consultarlo cuando quiera:\n${url}`
    : `Hola${first ? ` ${first}` : ""}, le saluda RAPIFIX. Aquí puede ver el historial de su vehículo: visitas, trabajos realizados, pagos, lavados y próximos mantenimientos. Es un enlace privado, guárdelo para consultarlo cuando quiera:\n${url}`;
}
