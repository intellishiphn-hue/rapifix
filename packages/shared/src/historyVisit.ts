import { normalizeUnit, type OdometerUnit } from "./odometer";
import { QUOTE_ITEM_LABELS, type QuoteItemType } from "./quote";
import { WORK_TYPE_LABELS, type WorkType } from "./workOrder";
import { STATUS_META, type WorkOrderStatus } from "./workOrderStatus";
import {
  approvedQuoteFor, HISTORY_METHOD_LABELS, isHistoryVisitId, orderProgress, PORTAL_LINK_DAYS, PUBLIC_HISTORY, visitState,
  type RawHistoryOrder, type RawHistoryPayment, type RawHistoryQuote, type VisitState,
} from "./history";

/**
 * Detalle de cada visita de "Mi historial RAPIFIX" (docs/HISTORIAL.md).
 *
 * Para no inflar publicHistory/{token} (límite 1 MB), el detalle de cada orden vive aparte en
 * publicHistory/{token}/visits/{orderId}. Lo arma el servidor con buildVisitDetail (lógica pura).
 * Solo sale lo que el cliente ya ve hoy en su portal (/orden/:token) o en los impresos que se le entregan:
 * motivo de ingreso, diagnóstico y recomendaciones (cuando el diagnóstico está completado), códigos OBD,
 * líneas de la cotización aprobada con sus precios, fotos y actualizaciones marcadas como visibles,
 * pagos con su recibo y comprobantes por revisar.
 *
 * Nunca salen: costos (unitCost), pago a técnicos (techPay), comisiones, notas internas de la orden o de la
 * cotización, pruebas realizadas y observaciones del técnico (no se muestran hoy al cliente), nombres del
 * personal, referencias de pago, bancos o terminales, VIN ni datos de otros clientes.
 */

export const HISTORY_VISITS = "visits";
/** Versión del detalle: si el documento principal no la tiene, el servidor arma todos los detalles. */
export const VISIT_DETAILS_V = 1;

export const historyVisitDocPath = (token: string, orderId: string) => `${PUBLIC_HISTORY}/${token}/${HISTORY_VISITS}/${orderId}`;
export const historyVisitPath = (token: string, orderId: string) => `/historial/${token}/visita/${orderId}`;
export const historyReceiptPath = (token: string, orderId: string, receipt: string) => `/historial/${token}/visita/${orderId}/recibo/${receipt}`;

export const VISIT_LIMITS = { lines: 60, photos: 40, timeline: 60, payments: 30, pending: 10, obd: 20 } as const;

type Ms = number | null | undefined;

export interface RawVisitQuoteItem {
  type?: string;
  description?: string;
  qty?: number;
  unitPrice?: number;
  discount?: number;
  lineTotal?: number;
  couponDiscount?: number | null;
  [k: string]: unknown;
}

export interface RawVisitQuote extends RawHistoryQuote {
  items?: RawVisitQuoteItem[];
  totals?: { subtotal?: number; discount?: number; couponDiscount?: number; tax?: number; total?: number } | null;
  taxRate?: number;
  coupon?: { code?: string; name?: string; discount?: number } | null;
}

export interface RawVisitOrder extends RawHistoryOrder {
  type?: string;
  reason?: string;
  vehicle?: { make?: string; model?: string; year?: number; color?: string; plate?: string } | null;
  diagnosis?: {
    reportedProblem?: string;
    technicianDiagnosis?: string;
    recommendations?: string;
    obdCodes?: string[];
    completedAt?: Ms;
    [k: string]: unknown;
  } | null;
}

export interface RawVisitEvent {
  at?: Ms;
  text?: string;
  visibleToCustomer?: boolean;
  [k: string]: unknown;
}

export interface RawVisitPhoto {
  url?: string;
  caption?: string;
  stage?: string;
  visibleToCustomer?: boolean;
  at?: Ms;
  [k: string]: unknown;
}

export interface RawVisitProof {
  status?: string;
  amount?: number;
  method?: string | null;
  createdAt?: Ms;
  [k: string]: unknown;
}

export interface RawVisitDetail {
  order: RawVisitOrder;
  /** cotizaciones de la orden (se usa la aprobada vigente) */
  quotes: RawVisitQuote[];
  /** pagos de la orden */
  payments: RawHistoryPayment[];
  events: RawVisitEvent[];
  photos: RawVisitPhoto[];
  proofs: RawVisitProof[];
  /** nombre del dueño del historial (cliente o empresa): sale en el recibo */
  ownerName: string;
}

export interface VisitLine {
  /** tipo para el cliente: Mano de obra, Repuesto, Servicio, Otro */
  kind: string;
  part: boolean;
  d: string;
  q: number;
  unitPrice: number;
  discount: number;
  /** total de la línea sin ISV, antes del cupón (igual que la cotización que vio el cliente) */
  total: number;
}

export interface VisitPayment {
  code: string;
  at: number | null;
  method: string;
  amount: number;
}

export interface PublicVisitDetail {
  v: 1;
  id: string;
  code: string;
  state: VisitState;
  statusLabel: string;
  progress: number;
  typeLabel: string;
  /** la orden es un trabajo de garantía */
  warranty: boolean;
  inAt: number | null;
  outAt: number | null;
  mileageIn: number | null;
  mileageOut: number | null;
  unit: OdometerUnit;
  vehicle: { plate: string; make: string; model: string; year: number; color: string };
  ownerName: string;
  /** problema reportado por el cliente (motivo de ingreso) */
  reported: string;
  /** solo cuando el diagnóstico está completado (igual que el portal) */
  diagnosis: { summary: string; obdCodes: string[]; recommendations: string } | null;
  quote: {
    code: string;
    lines: VisitLine[];
    subtotal: number;
    /** descuento de las líneas (sin el cupón) */
    discount: number;
    coupon: { code: string; name: string; amount: number } | null;
    tax: number;
    taxRate: number;
    total: number;
  } | null;
  photos: Array<{ url: string; caption: string; stage: string }>;
  timeline: Array<{ at: number | null; text: string }>;
  /** pagos confirmados (con recibo REC) */
  payments: VisitPayment[];
  /** comprobantes de transferencia o depósito que el taller aún no valida ("En revisión") */
  pending: Array<{ at: number | null; amount: number; method: string }>;
  total: number;
  paid: number;
  balance: number;
  /** portal de la orden ("/orden/TOKEN") y hasta cuándo funciona (null = mientras siga abierta) */
  link: string | null;
  linkUntil: number | null;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DAY = 86_400_000;
const PHOTO_URL = /^https:\/\/[^\s"'<>]{8,1500}$/;
const OBD = /^[A-Z0-9-]{3,12}$/;

/** Pagos que cuentan: los no anulados con monto. Del más viejo al más nuevo. */
export function confirmedPayments(payments: RawHistoryPayment[], orderId: string): VisitPayment[] {
  return payments
    .filter((p) => p.orderId === orderId && p.status !== "voided" && num(p.amount) > 0)
    .sort((a, b) => num(a.at) - num(b.at))
    .slice(-VISIT_LIMITS.payments)
    .map((p) => ({ code: str(p.code, 30), at: ms(p.at), method: HISTORY_METHOD_LABELS[String(p.method)] ?? "Pago", amount: num(p.amount) }));
}

/** Comprobantes enviados por el cliente que esperan revisión. Los aprobados ya son pagos; los rechazados no se muestran. */
export function pendingProofs(proofs: RawVisitProof[]): PublicVisitDetail["pending"] {
  return proofs
    .filter((p) => p.status === "pending" && num(p.amount) > 0)
    .sort((a, b) => num(a.createdAt) - num(b.createdAt))
    .slice(-VISIT_LIMITS.pending)
    .map((p) => ({ at: ms(p.createdAt), amount: num(p.amount), method: p.method === "deposit" ? "Depósito" : "Transferencia" }));
}

const WORK_ORDER = ["labor", "service", "other", "part"];

function visitQuote(q: RawVisitQuote | null): PublicVisitDetail["quote"] {
  if (!q) return null;
  const lines: VisitLine[] = (q.items ?? [])
    .map((it) => {
      const type = WORK_ORDER.includes(String(it.type)) ? (String(it.type) as QuoteItemType) : "other";
      const qty = Math.max(0, num(it.qty, 1));
      const unitPrice = Math.max(0, num(it.unitPrice));
      const discount = Math.max(0, num(it.discount));
      // Igual que la cotización del portal: la línea va sin el cupón (el cupón va aparte en los totales)
      const total = typeof it.lineTotal === "number" ? num(it.lineTotal) + Math.max(0, num(it.couponDiscount)) : Math.max(0, qty * unitPrice - discount);
      return { kind: QUOTE_ITEM_LABELS[type] ?? "Otro", part: type === "part", d: str(it.description, 160), q: qty, unitPrice, discount, total };
    })
    .filter((l) => l.d)
    .slice(0, VISIT_LIMITS.lines);
  const t = q.totals ?? {};
  const couponAmount = Math.max(0, num(t.couponDiscount));
  return {
    code: str(q.code, 30),
    lines,
    subtotal: num(t.subtotal),
    discount: Math.max(0, num(t.discount) - couponAmount),
    coupon: q.coupon && couponAmount > 0 ? { code: str(q.coupon.code, 30), name: str(q.coupon.name, 80), amount: couponAmount } : null,
    tax: num(t.tax),
    taxRate: num(q.taxRate),
    total: num(t.total),
  };
}

export function buildVisitDetail(raw: RawVisitDetail): PublicVisitDetail {
  const o = raw.order;
  const state = visitState(o.status);
  const outAt = state === "delivered" ? ms(o.deliveredAt) ?? ms(o.statusChangedAt) : null;
  const token = typeof o.portalToken === "string" && o.portalToken && o.portalEnabled !== false ? o.portalToken : null;
  const total = num(o.totals?.total);
  const paid = num(o.paid);
  const balance = Math.max(0, typeof o.balance === "number" ? o.balance : total - paid);
  const d = o.diagnosis ?? null;
  const diagnosisDone = !!d && !!ms(d.completedAt);
  const v = o.vehicle ?? {};
  const type = String(o.type ?? "");
  return {
    v: 1,
    id: o.id,
    code: str(o.code, 30),
    state,
    statusLabel: STATUS_META[o.status as WorkOrderStatus]?.label ?? "",
    progress: orderProgress(o.status),
    typeLabel: WORK_TYPE_LABELS[type as WorkType] ?? "",
    warranty: type === "warranty",
    inAt: ms(o.receivedAt) ?? ms(o.createdAt),
    outAt,
    mileageIn: o.mileageIn != null && num(o.mileageIn) > 0 ? num(o.mileageIn) : null,
    mileageOut: o.mileageOut != null && num(o.mileageOut) > 0 ? num(o.mileageOut) : null,
    unit: normalizeUnit(o.mileageUnit),
    vehicle: { plate: str(v.plate, 20), make: str(v.make, 40), model: str(v.model, 60), year: num(v.year), color: str(v.color, 30) },
    ownerName: str(raw.ownerName, 130),
    reported: str(o.reason, 1000) || str(d?.reportedProblem, 1000),
    diagnosis: diagnosisDone
      ? {
          summary: str(d!.technicianDiagnosis, 3000),
          obdCodes: (Array.isArray(d!.obdCodes) ? d!.obdCodes : []).map((c) => str(c, 12).toUpperCase()).filter((c) => OBD.test(c)).slice(0, VISIT_LIMITS.obd),
          recommendations: str(d!.recommendations, 3000),
        }
      : null,
    quote: visitQuote(approvedQuoteFor(o, raw.quotes)),
    photos: raw.photos
      .filter((p) => p.visibleToCustomer === true && typeof p.url === "string" && PHOTO_URL.test(p.url))
      .sort((a, b) => num(a.at) - num(b.at))
      .slice(0, VISIT_LIMITS.photos)
      .map((p) => ({ url: String(p.url), caption: str(p.caption, 200), stage: str(p.stage, 20) })),
    timeline: raw.events
      .filter((e) => e.visibleToCustomer === true)
      .map((e) => ({ at: ms(e.at), text: str(String(e.text ?? "").replace(/\s*\(demo\)$/, ""), 500) }))
      .filter((e) => e.text)
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
      .slice(-VISIT_LIMITS.timeline),
    payments: confirmedPayments(raw.payments, o.id),
    pending: pendingProofs(raw.proofs),
    total,
    paid,
    balance,
    link: token ? `/orden/${token}` : null,
    linkUntil: token && outAt ? outAt + PORTAL_LINK_DAYS * DAY : null,
  };
}

/** Recibo de un pago: lo pagado hasta ese pago (incluido) y el saldo que quedó. */
export function visitReceipt(d: PublicVisitDetail, code: string) {
  const i = d.payments.findIndex((p) => p.code === code);
  if (i < 0) return null;
  const payment = d.payments[i]!;
  const paidToDate = d.payments.slice(0, i + 1).reduce((s, p) => s + p.amount, 0);
  return { payment, paidToDate, balanceAfter: Math.max(0, d.total - paidToDate), number: i + 1, of: d.payments.length };
}

// ---------------------------------------------------------------------------
// Lectura en la página pública (nunca confía en la forma del JSON)
// ---------------------------------------------------------------------------
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const portalLink = (v: unknown) => (typeof v === "string" && /^\/orden\/[A-Za-z0-9]{6,40}$/.test(v) ? v : null);

export function parsePublicVisitDetail(raw: unknown): PublicVisitDetail | null {
  const d = obj(raw);
  if (!isHistoryVisitId(d.id)) return null;
  const v = obj(d.vehicle);
  const q = d.quote ? obj(d.quote) : null;
  const dg = d.diagnosis ? obj(d.diagnosis) : null;
  const coupon = q?.coupon ? obj(q.coupon) : null;
  const state = d.state === "delivered" || d.state === "ready" ? d.state : "in_shop";
  return {
    v: 1,
    id: d.id,
    code: str(d.code, 30),
    state,
    statusLabel: str(d.statusLabel, 40),
    progress: Math.min(100, Math.max(0, num(d.progress))),
    typeLabel: str(d.typeLabel, 40),
    warranty: d.warranty === true,
    inAt: ms(d.inAt), outAt: ms(d.outAt), mileageIn: ms(d.mileageIn), mileageOut: ms(d.mileageOut), unit: normalizeUnit(d.unit),
    vehicle: { plate: str(v.plate, 20), make: str(v.make, 40), model: str(v.model, 60), year: num(v.year), color: str(v.color, 30) },
    ownerName: str(d.ownerName, 130),
    reported: str(d.reported, 1000),
    diagnosis: dg
      ? { summary: str(dg.summary, 3000), obdCodes: (Array.isArray(dg.obdCodes) ? dg.obdCodes : []).map((c) => str(c, 12)).filter((c) => OBD.test(c)), recommendations: str(dg.recommendations, 3000) }
      : null,
    quote: q
      ? {
          code: str(q.code, 30),
          lines: arr(q.lines).map((l) => ({
            kind: str(l.kind, 30), part: l.part === true, d: str(l.d, 160), q: num(l.q, 1), unitPrice: num(l.unitPrice), discount: num(l.discount), total: num(l.total),
          })).filter((l) => l.d),
          subtotal: num(q.subtotal), discount: num(q.discount),
          coupon: coupon ? { code: str(coupon.code, 30), name: str(coupon.name, 80), amount: num(coupon.amount) } : null,
          tax: num(q.tax), taxRate: num(q.taxRate), total: num(q.total),
        }
      : null,
    photos: arr(d.photos).map((p) => ({ url: str(p.url, 1500), caption: str(p.caption, 200), stage: str(p.stage, 20) })).filter((p) => PHOTO_URL.test(p.url)),
    timeline: arr(d.timeline).map((e) => ({ at: ms(e.at), text: str(e.text, 500) })).filter((e) => e.text),
    payments: arr(d.payments).map((p) => ({ code: str(p.code, 30), at: ms(p.at), method: str(p.method, 40), amount: num(p.amount) })),
    pending: arr(d.pending).map((p) => ({ at: ms(p.at), amount: num(p.amount), method: str(p.method, 40) })),
    total: num(d.total), paid: num(d.paid), balance: num(d.balance),
    link: portalLink(d.link), linkUntil: ms(d.linkUntil),
  };
}
