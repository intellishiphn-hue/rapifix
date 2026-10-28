import type { TimestampLike } from "./types";
import type { QuoteItem, Totals } from "./quote";
import { computeTechPay } from "./techPay";

/**
 * Ingresos, costo de ventas y utilidad de una orden del taller. Lógica pura, la usan Finanzas
 * (navegador) y las comisiones por referido (Cloud Functions), para que den lo mismo.
 * Dinero en centavos. Los ingresos van SIN ISV y con descuento (lineTotal de la cotización aprobada).
 * El pago a técnicos por trabajo (techPay de las líneas de mano de obra y servicio) es COSTO de la orden:
 * va sumado en `cost` (y aparte en `techPay` para mostrarlo). Por eso el gasto que se registra al
 * pagarle al técnico (techPayoutId) NO se vuelve a restar como gasto operativo (ver isOperatingExpense).
 */

/** Costo unitario de un repuesto: el de la línea; si no, el promedio de sus salidas de inventario; si no, el costo promedio actual. */
export function resolvePartCost(
  lineCost: number,
  productId: string | null | undefined,
  movementCost: number | null | undefined,
  avgCost: number | null | undefined,
): { unit: number; missing: boolean; estimated: boolean } {
  if (lineCost > 0) return { unit: lineCost, missing: false, estimated: false };
  if (productId) {
    if (movementCost && movementCost > 0) return { unit: movementCost, missing: false, estimated: false };
    if (avgCost && avgCost > 0) return { unit: avgCost, missing: false, estimated: true };
  }
  return { unit: 0, missing: true, estimated: false };
}

/** Promedio ponderado del costo de las salidas de inventario por documento y producto: clave `${docId}|${productId}`. */
export function movementCostMap(
  movs: Array<{ type: string; qty: number; unitCost: number; productId: string; orderId?: string | null; saleId?: string | null }>,
  docField: "orderId" | "saleId",
): Map<string, number> {
  const acc = new Map<string, { qty: number; cost: number }>();
  for (const m of movs) {
    const doc = m[docField];
    if (m.type !== "out" || !doc || !(m.unitCost > 0)) continue;
    const k = `${doc}|${m.productId}`;
    const a = acc.get(k) ?? { qty: 0, cost: 0 };
    const q = Math.abs(m.qty);
    a.qty += q;
    a.cost += q * m.unitCost;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.qty ? a.cost / a.qty : 0]));
}

export interface OrderFinanceLine {
  item: QuoteItem;
  /** costo de la línea (centavos, redondeado), INCLUYE el pago a técnicos de la línea */
  cost: number;
  /** pago a técnicos de la línea (ya incluido en `cost`) */
  techPay: number;
  missing: boolean;
  estimated: boolean;
}

export interface OrderFinanceResult {
  revenue: number;
  tax: number;
  /** costo total: repuestos y costo interno + pago a técnicos */
  cost: number;
  /** pago a técnicos de la orden (ya incluido en `cost`) */
  techPay: number;
  profit: number;
  hasQuote: boolean;
  /** líneas de repuesto sin costo registrado (o la orden sin cotización con monto) */
  missingLines: number;
  lines: OrderFinanceLine[];
}

/**
 * Finanzas de una orden con su cotización aprobada vigente.
 * - `movementCost(productId)`: costo promedio de las salidas de inventario de ESTA orden para ese producto.
 * - `avgCost(productId)`: costo promedio actual del producto (aproximado).
 * Sin cotización aprobada: ingreso = subtotal − descuento de la orden, costo 0.
 */
export function computeOrderFinance(
  order: { totals?: Partial<Totals> | null },
  quote: { items?: QuoteItem[] | null; totals?: Partial<Totals> | null } | null | undefined,
  costs: { movementCost?: (productId: string) => number | undefined; avgCost?: (productId: string) => number | undefined } = {},
): OrderFinanceResult {
  if (!quote) {
    const revenue = (order.totals?.subtotal ?? 0) - (order.totals?.discount ?? 0);
    return { revenue, tax: order.totals?.tax ?? 0, cost: 0, techPay: 0, profit: revenue, hasQuote: false, missingLines: revenue > 0 ? 1 : 0, lines: [] };
  }
  const tp = computeTechPay(quote.items ?? []);
  let revenue = 0;
  let cost = 0;
  let missing = 0;
  const lines: OrderFinanceLine[] = [];
  for (const it of quote.items ?? []) {
    const isPart = it.type === "part";
    const r = isPart && it.productId
      ? resolvePartCost(it.unitCost, it.productId, costs.movementCost?.(it.productId), costs.avgCost?.(it.productId))
      : isPart
        ? resolvePartCost(it.unitCost, null, null, null)
        : { unit: it.unitCost || 0, missing: false, estimated: false };
    const pay = tp.byItem[it.id] ?? 0;
    const c = Math.round(r.unit * it.qty) + pay;
    revenue += it.lineTotal;
    cost += c;
    if (r.missing) missing++;
    lines.push({ item: it, cost: c, techPay: pay, missing: r.missing, estimated: r.estimated });
  }
  return { revenue, tax: quote.totals?.tax ?? 0, cost, techPay: tp.total, profit: revenue - cost, hasQuote: true, missingLines: missing, lines };
}

/**
 * Cotización aprobada que corresponde a una orden: la activa (activeQuoteId) si está aprobada;
 * si no, la aprobada más reciente.
 */
export function pickApprovedQuote<Q extends { id: string; status: string; createdAt?: TimestampLike | null }>(
  quotes: Q[],
  activeQuoteId: string | null | undefined,
): Q | null {
  let out: Q | null = null;
  const ms = (q: Q) => (q.createdAt && typeof q.createdAt.toMillis === "function" ? q.createdAt.toMillis() : 0);
  for (const q of quotes) {
    if (q.status !== "approved") continue;
    if (!out || q.id === activeQuoteId || (out.id !== activeQuoteId && ms(q) > ms(out))) out = q;
  }
  return out;
}
