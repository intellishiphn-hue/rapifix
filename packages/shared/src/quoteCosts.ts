import { z } from "zod";
import { formatMoney } from "./money";
import type { QuoteItem, QuoteStatus } from "./quote";

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
  costs: z
    .array(z.object({ itemId: z.string().min(1).max(40), unitCost: cents }))
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

/**
 * Aplica costos nuevos a las líneas. SOLO cambia `unitCost`: el resto de cada línea queda idéntico.
 * - `strict`: una línea que no existe es un error (cotización que se edita). Sin `strict` se ignora
 *   (modificación abierta, que puede no tener esa línea).
 * - `onlyIfCost`: aplica a una línea solo si su costo actual es ese (para no pisar un costo que la
 *   modificación ya cambió por su cuenta).
 */
export function applyCostChanges<T extends Pick<QuoteItem, "id" | "description" | "qty" | "unitCost">>(
  items: T[],
  costs: Array<{ itemId: string; unitCost: number }>,
  opts: { strict?: boolean; onlyIfCost?: Record<string, number> } = {},
): { items: T[]; changes: CostChange[] } {
  const byId = new Map(costs.map((c) => [c.itemId, c.unitCost]));
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

/** "Recarga de aire L 1,000.00 → L 900.00; Filtro L 0.00 → L 150.00" */
export function costChangesText(changes: CostChange[]): string {
  return changes.map((c) => `${c.description} ${formatMoney(c.before)} → ${formatMoney(c.after)}`).join("; ");
}

/** Utilidad (sin ISV) de las líneas con sus costos: total de la línea − cantidad × costo. */
export function quoteProfit(items: Array<Pick<QuoteItem, "qty" | "unitCost" | "lineTotal">>): number {
  return items.reduce((a, it) => a + it.lineTotal - Math.round(it.qty * (it.unitCost || 0)), 0);
}

type Comparable = Pick<QuoteItem, "id" | "type" | "description" | "qty" | "unitPrice" | "discount" | "taxable" | "unitCost"> & {
  productId?: string | null;
  serviceId?: string | null;
};

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
    const same =
      b.type === n.type && b.description.trim() === n.description.trim() && b.qty === n.qty && b.unitPrice === n.unitPrice &&
      b.discount === n.discount && b.taxable === n.taxable && (b.productId ?? null) === (n.productId ?? null) && (b.serviceId ?? null) === (n.serviceId ?? null);
    if (!same) return null;
    if ((b.unitCost || 0) !== (n.unitCost || 0)) changes.push({ itemId: b.id, description: b.description, qty: b.qty, before: b.unitCost || 0, after: n.unitCost || 0 });
  }
  return changes.length ? changes : null;
}
