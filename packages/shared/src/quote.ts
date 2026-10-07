import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import type { WorkOrderStatus } from "./workOrderStatus";
import type { PublicProof } from "./catalog";
import type { OdometerUnit } from "./odometer";

export const QUOTE_ITEM_TYPES = ["labor", "part", "service", "other"] as const;
export type QuoteItemType = (typeof QUOTE_ITEM_TYPES)[number];
export const QUOTE_ITEM_LABELS: Record<QuoteItemType, string> = {
  labor: "Mano de obra",
  part: "Repuesto",
  service: "Servicio",
  other: "Otro cargo",
};

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "approved", "rejected", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_META: Record<QuoteStatus, { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" }> = {
  draft: { label: "Borrador", tone: "gray" },
  sent: { label: "Enviada", tone: "blue" },
  viewed: { label: "Vista por el cliente", tone: "amber" },
  approved: { label: "Aprobada", tone: "green" },
  rejected: { label: "Rechazada", tone: "red" },
  expired: { label: "Expirada", tone: "gray" },
  superseded: { label: "Reemplazada", tone: "gray" },
};
/** Estados en los que una cotización (o una modificación) sigue abierta: aún no tiene respuesta. */
export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ["draft", "sent", "viewed"];

/** Montos en centavos. */
export interface QuoteItem {
  id: string;
  type: QuoteItemType;
  productId?: string | null; // del catálogo (para descontar inventario)
  serviceId?: string | null;
  description: string;
  qty: number;
  unitCost: number; // costo interno (no se muestra al cliente)
  unitPrice: number;
  discount: number; // descuento de la línea en centavos
  taxable: boolean;
  lineTotal: number;
}

export interface Totals {
  subtotal: number; // suma de líneas antes de descuento
  discount: number;
  tax: number;
  total: number;
}

export const DECISION_CHANNELS = ["portal", "phone", "in_person", "whatsapp"] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];
export const DECISION_CHANNEL_LABELS: Record<DecisionChannel, string> = {
  portal: "Link del cliente",
  phone: "Por teléfono",
  in_person: "En persona",
  whatsapp: "Por WhatsApp",
};

export interface QuoteDecision {
  result: "approved" | "rejected";
  at: TimestampLike;
  approvalId: string;
  ip: string | null;
  userAgent: string | null;
  name: string;
  comment: string;
  channel?: DecisionChannel;
  recordedBy?: string | null; // uid del empleado que la registró (si no fue por el link)
  recordedByName?: string | null;
}

export interface Quote extends BaseDoc {
  number: number;
  code: string; // COT-0001
  version: number;
  /** "order": nace de una orden. "direct": cotización previa, sin orden (se convierte al llegar el carro). */
  source?: "order" | "direct";
  orderId: string | null;
  orderCode: string | null;
  vehicleId?: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  publicToken?: string;
  vehicleLabel: string;
  plate: string;
  technicianIds: string[];
  status: QuoteStatus;
  items: QuoteItem[];
  taxRate: number;
  totals: Totals;
  notes: string;
  validDays: number;
  validUntil: TimestampLike | null;
  sentAt: TimestampLike | null;
  viewedAt: TimestampLike | null;
  decision: QuoteDecision | null;
  questions: Array<{ at: TimestampLike; text: string; name: string }>;
  // ----- Modificación de una cotización ya aprobada -----
  /** id de la cotización aprobada que esta versión modifica (si es una modificación) */
  revisionOf?: string | null;
  revisionReason?: string | null;
  revisionBy?: string | null;
  revisionByName?: string | null;
  /** en la aprobada vigente: id de la modificación abierta (borrador o enviada), si hay una */
  openRevisionId?: string | null;
  /** en la versión reemplazada: id de la versión aprobada que la sustituyó */
  supersededBy?: string | null;
  supersededAt?: TimestampLike | null;
  /** modificación descartada por el taller (queda en estado "expired") */
  discardedAt?: TimestampLike | null;
  discardedByName?: string | null;
  discardReason?: string | null;
}

/** Etiqueta del estado; una modificación descartada se guarda como "expired" pero se muestra "Descartada". */
export function quoteStatusLabel(q: Pick<Quote, "status" | "discardedAt">): string {
  return q.status === "expired" && q.discardedAt ? "Descartada" : QUOTE_STATUS_META[q.status].label;
}

// ---------- Comparación entre la cotización aprobada y su modificación ----------
export type DiffItem = Pick<QuoteItem, "id" | "type" | "description" | "qty" | "unitPrice" | "discount" | "lineTotal"> & {
  productId?: string | null;
  serviceId?: string | null;
  taxable?: boolean;
};
export type DiffField = "description" | "qty" | "unitPrice" | "discount" | "type" | "taxable";
export interface QuoteDiff {
  added: DiffItem[];
  removed: DiffItem[];
  changed: Array<{ before: DiffItem; after: DiffItem; fields: DiffField[] }>;
  unchanged: number;
  previousTotal: number;
  newTotal: number;
  /** nuevo − anterior (positivo: el cliente paga más) */
  difference: number;
  hasChanges: boolean;
}

const diffText = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const diffKey = (it: DiffItem) => `${it.productId ?? ""}|${it.serviceId ?? ""}|${diffText(it.description)}`;
const DIFF_FIELDS: DiffField[] = ["description", "qty", "unitPrice", "discount", "type", "taxable"];

/**
 * Compara dos versiones de una cotización. Empareja las líneas por su id (se conserva entre versiones);
 * las que no coinciden por id se emparejan por producto/servicio + descripción.
 */
export function diffQuotes(
  prev: { items: DiffItem[]; totals: Pick<Totals, "total"> },
  next: { items: DiffItem[]; totals: Pick<Totals, "total"> },
): QuoteDiff {
  const changed: QuoteDiff["changed"] = [];
  let unchanged = 0;
  const pair = (before: DiffItem, after: DiffItem) => {
    const fields = DIFF_FIELDS.filter((f) => {
      if (f === "description") return before.description.trim() !== after.description.trim();
      if (f === "taxable") return before.taxable !== undefined && after.taxable !== undefined && before.taxable !== after.taxable;
      return before[f] !== after[f];
    });
    if (fields.length || before.lineTotal !== after.lineTotal) changed.push({ before, after, fields });
    else unchanged++;
  };
  const nextById = new Map(next.items.map((it) => [it.id, it]));
  const usedNext = new Set<string>();
  const restPrev: DiffItem[] = [];
  for (const it of prev.items) {
    const match = nextById.get(it.id);
    if (match && !usedNext.has(match.id)) {
      usedNext.add(match.id);
      pair(it, match);
    } else restPrev.push(it);
  }
  const restNext = next.items.filter((it) => !usedNext.has(it.id));
  const removed: DiffItem[] = [];
  for (const it of restPrev) {
    const i = restNext.findIndex((n) => diffKey(n) === diffKey(it));
    if (i >= 0) pair(it, restNext.splice(i, 1)[0]!);
    else removed.push(it);
  }
  const previousTotal = prev.totals.total;
  const newTotal = next.totals.total;
  return {
    added: restNext, removed, changed, unchanged, previousTotal, newTotal, difference: newTotal - previousTotal,
    hasChanges: restNext.length + removed.length + changed.length > 0 || newTotal !== previousTotal,
  };
}

/** Saldo que queda con un total nuevo y lo ya pagado. `credit` es saldo a favor del cliente (pagó de más). */
export function balanceAfter(total: number, paid: number): { balance: number; credit: number } {
  return { balance: total - paid, credit: Math.max(0, paid - total) };
}

export interface StockNotice {
  kind: "removed" | "reduced" | "increased";
  description: string;
  /** cantidad que ya salió del inventario */
  consumedQty: number;
  /** cantidad en la versión nueva (0 si se quitó) */
  newQty: number;
}
/**
 * Repuestos que YA salieron del inventario para la orden y que la modificación quita o cambia de cantidad.
 * No se devuelve inventario solo: se avisa para que el taller lo ajuste.
 * `carry` son las líneas que siguen existiendo: su marca de "ya descontado" pasa a la versión nueva.
 */
export function stockImpact(
  prevItems: DiffItem[],
  nextItems: DiffItem[],
  consumedQtyByItemId: Record<string, number>,
): { notices: StockNotice[]; carry: string[] } {
  const notices: StockNotice[] = [];
  const carry: string[] = [];
  const nextById = new Map(nextItems.map((it) => [it.id, it]));
  for (const it of prevItems) {
    const consumedQty = consumedQtyByItemId[it.id];
    if (consumedQty === undefined) continue;
    const n = nextById.get(it.id);
    if (!n || n.type !== "part" || !n.productId || n.productId !== it.productId) {
      notices.push({ kind: "removed", description: it.description, consumedQty, newQty: 0 });
      continue;
    }
    carry.push(it.id);
    if (n.qty < consumedQty) notices.push({ kind: "reduced", description: n.description, consumedQty, newQty: n.qty });
    else if (n.qty > consumedQty) notices.push({ kind: "increased", description: n.description, consumedQty, newQty: n.qty });
  }
  return { notices, carry };
}
export function stockNoticeText(n: StockNotice): string {
  if (n.kind === "removed") return `Se quitó ${n.description}, que ya había salido de inventario (${n.consumedQty}): devuélvalo al inventario si corresponde.`;
  if (n.kind === "reduced") return `${n.description}: ya salieron ${n.consumedQty} del inventario y ahora se cotizan ${n.newQty}. Devuelva la diferencia al inventario si corresponde.`;
  return `${n.description}: ya salieron ${n.consumedQty} del inventario y ahora se cotizan ${n.newQty}. Descuente la diferencia del inventario a mano.`;
}

/** Cantidades ya descontadas por línea de una cotización, a partir de `order.consumed` (llaves `${quoteId}_${itemId}`). */
export function consumedByItem(consumed: Record<string, { qty: number }> | null | undefined, quoteId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(consumed ?? {})) {
    if (k.startsWith(`${quoteId}_`)) out[k.slice(quoteId.length + 1)] = Number(v?.qty ?? 0);
  }
  return out;
}

/** Calcula el total de cada línea y de la cotización. ISV sobre la base con descuento. */
export function computeQuote(items: Array<Omit<QuoteItem, "lineTotal">>, taxRate: number): { items: QuoteItem[]; totals: Totals } {
  let subtotal = 0;
  let discount = 0;
  let taxable = 0;
  const out = items.map((it) => {
    const gross = Math.round(it.qty * it.unitPrice);
    const disc = Math.min(Math.max(0, Math.round(it.discount)), gross);
    const lineTotal = gross - disc;
    subtotal += gross;
    discount += disc;
    if (it.taxable) taxable += lineTotal;
    return { ...it, discount: disc, lineTotal };
  });
  const tax = Math.round((taxable * taxRate) / 100);
  return { items: out, totals: { subtotal, discount, tax, total: subtotal - discount + tax } };
}

// ---------- Validaciones ----------
const cents = z.number().int().min(0).max(100_000_000_00);

export const quoteItemInput = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(QUOTE_ITEM_TYPES),
  productId: z.string().nullish(),
  serviceId: z.string().nullish(),
  description: z.string().trim().min(1, "Cada línea necesita descripción").max(300),
  qty: z.number().positive("La cantidad debe ser mayor a 0").max(10_000),
  unitCost: cents,
  unitPrice: cents,
  discount: cents,
  taxable: z.boolean(),
});
export type QuoteItemInput = z.infer<typeof quoteItemInput>;

export const saveQuoteSchema = z.object({
  orderId: z.string().nullish(),
  vehicleId: z.string().nullish(), // cotización directa (sin orden)
  quoteId: z.string().nullish(),
  items: z.array(quoteItemInput).min(1, "Agregue al menos una línea").max(100),
  notes: z.string().trim().max(2000),
  validDays: z.number().int().min(1).max(90),
});
export type SaveQuoteInput = z.infer<typeof saveQuoteSchema>;

export const sendQuoteSchema = z.object({ quoteId: z.string().min(1) });
export const newVersionSchema = z.object({
  quoteId: z.string().min(1),
  /** obligatorio cuando se modifica una cotización ya aprobada */
  reason: z.string().trim().min(3, "Escriba el motivo del cambio").max(300).nullish(),
});
export const discardRevisionSchema = z.object({ quoteId: z.string().min(1), reason: z.string().trim().max(300).nullish() });

export const respondQuoteSchema = z.object({
  token: z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido"),
  action: z.enum(["approve", "reject", "question"]),
  name: z.string().trim().max(80).nullish(),
  comment: z.string().trim().max(1000).nullish(),
});
export type RespondQuoteInput = z.infer<typeof respondQuoteSchema>;

export const recordDecisionSchema = z.object({
  quoteId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  channel: z.enum(["phone", "in_person", "whatsapp"]),
  name: z.string().trim().max(80).nullish(),
  comment: z.string().trim().max(1000).nullish(),
});
export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>;

export const portalTokenSchema = z.object({ token: z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido") });

// ---------- Portal público ----------
export interface PortalStep {
  label: string;
  done: boolean;
  current: boolean;
}

export type PublicDiffLine = { type: QuoteItemType; description: string; qty: number; unitPrice: number; lineTotal: number };
const publicLine = (it: DiffItem): PublicDiffLine => ({ type: it.type, description: it.description, qty: it.qty, unitPrice: it.unitPrice, lineTotal: it.lineTotal });
/** Resumen de cambios que se puede mostrar al cliente (sin costos ni ids internos). */
export function publicDiff(d: QuoteDiff) {
  return {
    added: d.added.map(publicLine),
    removed: d.removed.map(publicLine),
    changed: d.changed.map((c) => ({ before: publicLine(c.before), after: publicLine(c.after) })),
    previousTotal: d.previousTotal, newTotal: d.newTotal, difference: d.difference,
  };
}

export interface PublicPortal {
  /** "order": seguimiento de una orden. "quote": cotización directa, aún sin orden. */
  kind?: "order" | "quote";
  tid: string;
  orderId: string | null;
  orderCode: string;
  workshop: { name: string; logoUrl: string; phone: string; whatsapp: string; address: string; city: string; hours: string };
  customerFirstName: string;
  vehicle: { make: string; model: string; year: number; color: string; plate: string };
  status: WorkOrderStatus;
  statusLabel: string;
  percent: number;
  steps: PortalStep[];
  nextStep: string;
  cancelled: boolean;
  delivered: boolean;
  updates: Array<{ at: TimestampLike; text: string }>;
  photos: Array<{ url: string; caption: string; stage: string }>;
  diagnosis: { summary: string; recommendations: string } | null;
  /** Estado del vehículo al recibirlo (kilometraje, combustible, lo que dejó, observaciones) */
  reception?: {
    receivedAt: TimestampLike | null;
    mileageIn: number;
    /** "km" si no existe (portales viejos) */
    mileageUnit?: OdometerUnit | null;
    fuelLevel: number;
    items: string[];
    exteriorNotes: string;
    interiorNotes: string;
    accessories: string;
    otherObjects: string;
  } | null;
  quote: {
    id: string;
    code: string;
    status: QuoteStatus;
    items: Array<{ type: QuoteItemType; description: string; qty: number; unitPrice: number; discount: number; lineTotal: number }>;
    totals: Totals;
    taxRate: number;
    notes: string;
    validUntil: TimestampLike | null;
    decidedAt: TimestampLike | null;
  } | null;
  /**
   * Actualización de una cotización ya aprobada, pendiente de respuesta del cliente.
   * Mientras exista, `quote` sigue siendo la aprobada vigente.
   */
  quoteUpdate?: (NonNullable<PublicPortal["quote"]> & {
    changes: {
      added: PublicDiffLine[];
      removed: PublicDiffLine[];
      changed: Array<{ before: PublicDiffLine; after: PublicDiffLine }>;
      previousTotal: number;
      newTotal: number;
      difference: number;
    };
  }) | null;
  active: boolean;
  /** Pago en línea con ROKI (si el taller lo activó) */
  onlinePayment?: { enabled: boolean; balance: number; total: number; paid: number };
  /** bancos para transferir o depositar (lista de Configuración) */
  banks?: string[];
  /** último comprobante de pago enviado por el cliente */
  proof?: PublicProof | null;
  updatedAt: TimestampLike;
}
