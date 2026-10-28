import { z } from "zod";
import { formatMoney } from "./money";
import type { QuoteItem, QuoteStatus } from "./quote";
import { computeTechPay, techPayBase, techPayEligible, techPayKey, techPaySharesSchema, techPayText, type TechPayShare } from "./techPay";

/**
 * Corrección del costo interno de las líneas de una cotización (callable `updateQuoteCosts`).
 * El costo no lo ve el cliente: cambiarlo NO cambia precios ni totales y no requiere volver a aprobar.
 * Por eso se permite también en cotizaciones enviadas o aprobadas (que no se pueden editar).
 */

/** Estados en los que se puede corregir el costo interno. */
export const COST_EDITABLE_STATUSES: QuoteStatus[] = ["draft", "sent", "viewed", "approved"];

const cents = z.number().int("Monto no válido").min(0, "El costo no puede ser negativo").max(100_000_000_00);

export const updateQuoteCostsSchema = z.object({
  quoteId: z.string().min(1),
  /**
   * Por línea: costo interno nuevo y/o pago a técnicos nuevo (null o [] lo quita). Lo que no venga no cambia.
   * El pago a técnicos solo aplica a mano de obra y servicio.
   */
  costs: z
    .array(z.object({ itemId: z.string().min(1).max(40), unitCost: cents.optional(), techPay: techPaySharesSchema.nullish() }))
    .min(1, "No hay costos para guardar")
    .max(100)
    .refine((c) => new Set(c.map((x) => x.itemId)).size === c.length, { message: "Hay una línea repetida" }),
});
export type UpdateQuoteCostsInput = z.infer<typeof updateQuoteCostsSchema>;

export interface CostChange {
  itemId: string;
  description: string;
  qty: number;
  before: number;
  after: number;
}

/** Cambio del pago a técnicos de una línea. */
export interface TechPayChange {
  itemId: string;
  description: string;
  /** base del porcentaje (neto de la línea sin ISV) */
  base: number;
  before: TechPayShare[];
  after: TechPayShare[];
}

/**
 * Aplica costos nuevos a las líneas. SOLO cambia `unitCost`: el resto de cada línea queda idéntico.
 * - `strict`: una línea que no existe es un error (cotización que se edita). Sin `strict` se ignora
 *   (modificación abierta, que puede no tener esa línea).
 * - `onlyIfCost`: aplica a una línea solo si su costo actual es ese (para no pisar un costo que la
 *   modificación ya cambió por su cuenta).
 */
export function applyCostChanges<T extends Pick<QuoteItem, "id" | "description" | "qty" | "unitCost">>(
  items: T[],
  costs: Array<{ itemId: string; unitCost?: number }>,
  opts: { strict?: boolean; onlyIfCost?: Record<string, number> } = {},
): { items: T[]; changes: CostChange[] } {
  const byId = new Map(costs.filter((c) => c.unitCost !== undefined).map((c) => [c.itemId, c.unitCost!]));
  if (opts.strict) {
    const ids = new Set(items.map((it) => it.id));
    const unknown = costs.find((c) => !ids.has(c.itemId));
    if (unknown) throw new Error("Una de las líneas ya no existe en la cotización. Recargue la página.");
  }
  const changes: CostChange[] = [];
  const out = items.map((it) => {
    const next = byId.get(it.id);
    if (next === undefined || !Number.isInteger(next) || next < 0) return it;
    const before = Number(it.unitCost ?? 0);
    if (next === before) return it;
    const expected = opts.onlyIfCost?.[it.id];
    if (opts.onlyIfCost && (expected === undefined || expected !== before)) return it;
    changes.push({ itemId: it.id, description: it.description, qty: it.qty, before, after: next });
    return { ...it, unitCost: next };
  });
  return { items: out, changes };
}

/**
 * Aplica pagos a técnicos nuevos (solo las entradas que traen `techPay`; null/[] lo quita).
 * - `strict`: una línea que no existe, o una que no es mano de obra/servicio con pago, es error.
 * - `onlyIfTechPay`: aplica a una línea solo si su pago actual tiene esa clave (techPayKey), para no pisar
 *   un pago que la modificación abierta ya cambió por su cuenta.
 */
export function applyTechPayChanges<T extends Pick<QuoteItem, "id" | "type" | "description" | "qty" | "unitPrice" | "discount" | "couponDiscount" | "techPay">>(
  items: T[],
  costs: Array<{ itemId: string; techPay?: TechPayShare[] | null }>,
  opts: { strict?: boolean; onlyIfTechPay?: Record<string, string> } = {},
): { items: T[]; changes: TechPayChange[] } {
  const entries = costs.filter((c) => c.techPay !== undefined);
  const byId = new Map(entries.map((c) => [c.itemId, c.techPay ?? []]));
  const ids = new Set(items.map((it) => it.id));
  if (opts.strict) {
    if (entries.some((c) => !ids.has(c.itemId))) throw new Error("Una de las líneas ya no existe en la cotización. Recargue la página.");
    const bad = items.find((it) => !techPayEligible(it.type) && (byId.get(it.id)?.length ?? 0) > 0);
    if (bad) throw new Error(`"${bad.description}" no es mano de obra ni servicio: no lleva pago a técnico.`);
  }
  const changes: TechPayChange[] = [];
  const out = items.map((it) => {
    if (!byId.has(it.id) || !techPayEligible(it.type)) return it;
    const next = byId.get(it.id)!;
    const before = it.techPay ?? [];
    if (techPayKey(next) === techPayKey(before)) return it;
    if (opts.onlyIfTechPay && opts.onlyIfTechPay[it.id] !== techPayKey(before)) return it;
    changes.push({ itemId: it.id, description: it.description, base: techPayBase(it), before, after: next });
    const { techPay: _old, ...rest } = it;
    return (next.length ? { ...rest, techPay: next } : rest) as T;
  });
  return { items: out, changes };
}

/** "Cambio de aceite: sin pago → Anthony 30 % (L 90.00)" */
export function techPayChangesText(changes: TechPayChange[]): string {
  return changes.map((c) => `${c.description}: pago a técnico ${techPayText(c.before, c.base)} → ${techPayText(c.after, c.base)}`).join("; ");
}

/** "Recarga de aire L 1,000.00 → L 900.00; Filtro L 0.00 → L 150.00" */
export function costChangesText(changes: CostChange[]): string {
  return changes.map((c) => `${c.description} ${formatMoney(c.before)} → ${formatMoney(c.after)}`).join("; ");
}

/**
 * Utilidad (sin ISV) de las líneas con sus costos: total de la línea − cantidad × costo − pago a técnicos.
 * Misma regla que computeOrderFinance para líneas con costo registrado.
 */
export function quoteProfit(items: Array<Pick<QuoteItem, "id" | "type" | "description" | "qty" | "unitCost" | "unitPrice" | "discount" | "couponDiscount" | "lineTotal" | "techPay">>): number {
  const tp = computeTechPay(items);
  return items.reduce((a, it) => a + it.lineTotal - Math.round(it.qty * (it.unitCost || 0)), 0) - tp.total;
}

type Comparable = Pick<QuoteItem, "id" | "type" | "description" | "qty" | "unitPrice" | "discount" | "taxable" | "unitCost"> & {
  productId?: string | null;
  serviceId?: string | null;
  techPay?: TechPayShare[] | null;
};

const sameForClient = (b: Comparable, n: Comparable) =>
  b.type === n.type && b.description.trim() === n.description.trim() && b.qty === n.qty && b.unitPrice === n.unitPrice &&
  b.discount === n.discount && b.taxable === n.taxable && (b.productId ?? null) === (n.productId ?? null) && (b.serviceId ?? null) === (n.serviceId ?? null);

/**
 * Como costOnlyChanges, pero también cuenta el pago a técnicos: si entre la aprobada y su modificación lo
 * ÚNICO que cambia es lo interno (costo y/o pago a técnicos), devuelve esos valores nuevos por línea.
 */
export function internalOnlyChanges(base: Comparable[], next: Comparable[]): { costs: Record<string, number>; techPay: Record<string, TechPayShare[]> } | null {
  if (base.length !== next.length) return null;
  const nextById = new Map(next.map((it) => [it.id, it]));
  const costs: Record<string, number> = {};
  const techPay: Record<string, TechPayShare[]> = {};
  for (const b of base) {
    const n = nextById.get(b.id);
    if (!n || !sameForClient(b, n)) return null;
    if ((b.unitCost || 0) !== (n.unitCost || 0)) costs[b.id] = n.unitCost || 0;
    if (techPayEligible(b.type) && techPayKey(b.techPay) !== techPayKey(n.techPay)) techPay[b.id] = n.techPay ?? [];
  }
  return Object.keys(costs).length || Object.keys(techPay).length ? { costs, techPay } : null;
}

/**
 * Si entre la cotización aprobada y su modificación lo ÚNICO que cambia es el costo interno, devuelve
 * esos cambios (para sugerir "Editar costos" en vez de mandar una actualización al cliente).
 * Si cambia cualquier otra cosa (o nada), devuelve null.
 */
export function costOnlyChanges(base: Comparable[], next: Comparable[]): CostChange[] | null {
  if (base.length !== next.length) return null;
  const nextById = new Map(next.map((it) => [it.id, it]));
  const changes: CostChange[] = [];
  for (const b of base) {
    const n = nextById.get(b.id);
    if (!n) return null;
    if (!sameForClient(b, n)) return null;
    if ((b.unitCost || 0) !== (n.unitCost || 0)) changes.push({ itemId: b.id, description: b.description, qty: b.qty, before: b.unitCost || 0, after: n.unitCost || 0 });
  }
  return changes.length ? changes : null;
}
