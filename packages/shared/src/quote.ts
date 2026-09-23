import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import type { WorkOrderStatus } from "./workOrderStatus";

export const QUOTE_ITEM_TYPES = ["labor", "part", "service", "other"] as const;
export type QuoteItemType = (typeof QUOTE_ITEM_TYPES)[number];
export const QUOTE_ITEM_LABELS: Record<QuoteItemType, string> = {
  labor: "Mano de obra",
  part: "Repuesto",
  service: "Servicio",
  other: "Otro cargo",
};

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "approved", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_META: Record<QuoteStatus, { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" }> = {
  draft: { label: "Borrador", tone: "gray" },
  sent: { label: "Enviada", tone: "blue" },
  viewed: { label: "Vista por el cliente", tone: "amber" },
  approved: { label: "Aprobada", tone: "green" },
  rejected: { label: "Rechazada", tone: "red" },
  expired: { label: "Expirada", tone: "gray" },
};

/** Montos en centavos. */
export interface QuoteItem {
  id: string;
  type: QuoteItemType;
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

export interface QuoteDecision {
  result: "approved" | "rejected";
  at: TimestampLike;
  approvalId: string;
  ip: string | null;
  userAgent: string | null;
  name: string;
  comment: string;
}

export interface Quote extends BaseDoc {
  number: number;
  code: string; // COT-0001
  version: number;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
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
  description: z.string().trim().min(1, "Cada línea necesita descripción").max(300),
  qty: z.number().positive("La cantidad debe ser mayor a 0").max(10_000),
  unitCost: cents,
  unitPrice: cents,
  discount: cents,
  taxable: z.boolean(),
});
export type QuoteItemInput = z.infer<typeof quoteItemInput>;

export const saveQuoteSchema = z.object({
  orderId: z.string().min(1),
  quoteId: z.string().nullish(),
  items: z.array(quoteItemInput).min(1, "Agregue al menos una línea").max(100),
  notes: z.string().trim().max(2000),
  validDays: z.number().int().min(1).max(90),
});
export type SaveQuoteInput = z.infer<typeof saveQuoteSchema>;

export const sendQuoteSchema = z.object({ quoteId: z.string().min(1) });
export const newVersionSchema = z.object({ quoteId: z.string().min(1) });

export const respondQuoteSchema = z.object({
  token: z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido"),
  action: z.enum(["approve", "reject", "question"]),
  name: z.string().trim().max(80).nullish(),
  comment: z.string().trim().max(1000).nullish(),
});
export type RespondQuoteInput = z.infer<typeof respondQuoteSchema>;

export const portalTokenSchema = z.object({ token: z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido") });

// ---------- Portal público ----------
export interface PortalStep {
  label: string;
  done: boolean;
  current: boolean;
}

export interface PublicPortal {
  tid: string;
  orderId: string;
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
  active: boolean;
  updatedAt: TimestampLike;
}
