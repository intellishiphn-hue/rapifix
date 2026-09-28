import { doc, getDoc, where, limit } from "firebase/firestore";
import {
  catalogCol, financeCol, FINANCE_META_DOCS, normalizeText, orderCol, QUOTE_ITEM_LABELS,
  type Expense, type FinanceBudget, type InventoryMovement, type SupplierPayment, type Payment, type ProductCost, type Purchase, type QuoteItemType, type Sale, type WorkOrder,
} from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { toDate } from "@/lib/format";
import { fetchAll, fetchApprovedQuotes, fetchRange } from "@/features/reports/data";

// ---------------- Caché simple (evita recargar al cambiar de pestaña) ----------------
const cache = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 40) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
  }
  return p;
}

const rk = (name: string, start: Date, end: Date, refresh: number) => `${name}|${start.getTime()}|${end.getTime()}|${refresh}`;

/** Consulta `field in [...]` en bloques de 30 (un solo campo: no requiere índices compuestos). */
async function fetchIn<T>(path: string, field: string, ids: string[]): Promise<T[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += 30) chunks.push(uniq.slice(i, i + 30));
  const res = await Promise.all(chunks.map((c) => fetchAll<T>(path, where(field, "in", c))));
  return res.flat();
}

// ---------------- Modelo financiero ----------------
export interface FinLine {
  source: "order" | "sale";
  docId: string;
  at: Date | null;
  /** clave de agrupación del producto/servicio */
  key: string;
  name: string;
  type: QuoteItemType;
  qty: number;
  /** sin ISV, con descuento (centavos) */
  revenue: number;
  cost: number;
  /** repuesto sin ningún costo registrado */
  missingCost: boolean;
  /** costo tomado del costo promedio actual del producto (aproximado) */
  estimatedCost: boolean;
}

export interface OrderFin {
  order: WorkOrder;
  at: Date | null;
  revenue: number;
  tax: number;
  cost: number;
  profit: number;
  hasQuote: boolean;
  missingLines: number;
}

export interface SaleFin {
  sale: Sale;
  at: Date | null;
  revenue: number;
  tax: number;
  cost: number;
  profit: number;
  missingLines: number;
}

export interface Core {
  orders: OrderFin[];
  sales: SaleFin[];
  lines: FinLine[];
  revenue: number;
  orderRevenue: number;
  saleRevenue: number;
  cost: number;
  profit: number;
  tax: number;
  missingLines: number;
  estimatedLines: number;
  ordersWithoutQuote: number;
}

export const pct = (a: number, b: number): number | null => (b ? (a / b) * 100 : null);

const PART_LABEL: Record<QuoteItemType, string> = QUOTE_ITEM_LABELS;
export const typeLabel = (t: QuoteItemType) => PART_LABEL[t];

function productCosts(refresh: number) {
  return cached(`costs|${refresh}`, async () => {
    try {
      const list = await fetchAll<ProductCost & { id: string }>(catalogCol.productCosts(TENANT_ID));
      return new Map(list.map((c) => [c.id, c.avgCost || c.cost || 0]));
    } catch {
      return new Map<string, number>();
    }
  });
}

/** Promedio ponderado del costo de las salidas de inventario por documento y producto. */
function movementCosts(movs: InventoryMovement[], docField: "orderId" | "saleId") {
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

/** Ingresos, costos y utilidad de órdenes entregadas y ventas del POS en [start, end). */
export function loadCore(start: Date, end: Date, refresh: number): Promise<Core> {
  return cached(rk("core", start, end, refresh), async () => {
    const [delivered, sales, costs] = await Promise.all([
      fetchRange<WorkOrder>(orderCol.workOrders(TENANT_ID), "deliveredAt", start, end).then((l) => l.filter((o) => o.status === "DELIVERED")),
      fetchRange<Sale>(catalogCol.sales(TENANT_ID), "at", start, end).then((l) => l.filter((s) => s.status !== "voided")),
      productCosts(refresh),
    ]);
    const [quotes, orderMovs, saleMovs] = await Promise.all([
      fetchApprovedQuotes(delivered),
      fetchIn<InventoryMovement>(catalogCol.movements(TENANT_ID), "orderId", delivered.map((o) => o.id)).catch(() => [] as InventoryMovement[]),
      fetchIn<InventoryMovement>(catalogCol.movements(TENANT_ID), "saleId", sales.map((s) => s.id)).catch(() => [] as InventoryMovement[]),
    ]);
    const orderMov = movementCosts(orderMovs, "orderId");
    const saleMov = movementCosts(saleMovs, "saleId");

    const lines: FinLine[] = [];
    const resolvePart = (docId: string, productId: string | null | undefined, lineCost: number, movMap: Map<string, number>) => {
      if (lineCost > 0) return { unit: lineCost, missing: false, est: false };
      if (productId) {
        const m = movMap.get(`${docId}|${productId}`);
        if (m && m > 0) return { unit: m, missing: false, est: false };
        const avg = costs.get(productId);
        if (avg && avg > 0) return { unit: avg, missing: false, est: true };
      }
      return { unit: 0, missing: true, est: false };
    };

    const orders: OrderFin[] = delivered.map((o) => {
      const q = quotes.get(o.id);
      const at = toDate(o.deliveredAt);
      if (!q) {
        const revenue = (o.totals?.subtotal ?? 0) - (o.totals?.discount ?? 0);
        return { order: o, at, revenue, tax: o.totals?.tax ?? 0, cost: 0, profit: revenue, hasQuote: false, missingLines: revenue > 0 ? 1 : 0 };
      }
      let revenue = 0;
      let cost = 0;
      let missing = 0;
      for (const it of q.items ?? []) {
        const isPart = it.type === "part";
        const r = isPart ? resolvePart(o.id, it.productId, it.unitCost, orderMov) : { unit: it.unitCost || 0, missing: false, est: false };
        const c = Math.round(r.unit * it.qty);
        revenue += it.lineTotal;
        cost += c;
        if (r.missing) missing++;
        const ref = isPart ? it.productId : it.serviceId;
        lines.push({
          source: "order", docId: o.id, at, key: `${isPart ? "part" : it.type === "other" ? "other" : "svc"}:${ref || `${it.type}:${normalizeText(it.description)}`}`,
          name: it.description, type: it.type, qty: it.qty, revenue: it.lineTotal, cost: c, missingCost: r.missing, estimatedCost: r.est,
        });
      }
      return { order: o, at, revenue, tax: q.totals?.tax ?? 0, cost, profit: revenue - cost, hasQuote: true, missingLines: missing };
    });

    const saleFins: SaleFin[] = sales.map((s) => {
      const at = toDate(s.at);
      let revenue = 0;
      let cost = 0;
      let missing = 0;
      for (const it of s.items ?? []) {
        const isPart = it.kind === "product";
        const r = isPart ? resolvePart(s.id, it.refId, 0, saleMov) : { unit: 0, missing: false, est: false };
        const c = Math.round(r.unit * it.qty);
        revenue += it.lineTotal;
        cost += c;
        if (r.missing) missing++;
        const type: QuoteItemType = isPart ? "part" : it.kind === "service" ? "service" : "other";
        lines.push({
          source: "sale", docId: s.id, at, key: `${isPart ? "part" : type === "other" ? "other" : "svc"}:${it.refId || `${type}:${normalizeText(it.description)}`}`,
          name: it.description, type, qty: it.qty, revenue: it.lineTotal, cost: c, missingCost: r.missing, estimatedCost: r.est,
        });
      }
      return { sale: s, at, revenue, tax: s.totals?.tax ?? 0, cost, profit: revenue - cost, missingLines: missing };
    });

    const orderRevenue = orders.reduce((a, x) => a + x.revenue, 0);
    const saleRevenue = saleFins.reduce((a, x) => a + x.revenue, 0);
    const cost = orders.reduce((a, x) => a + x.cost, 0) + saleFins.reduce((a, x) => a + x.cost, 0);
    const revenue = orderRevenue + saleRevenue;
    return {
      orders,
      sales: saleFins,
      lines,
      revenue,
      orderRevenue,
      saleRevenue,
      cost,
      profit: revenue - cost,
      tax: orders.reduce((a, x) => a + x.tax, 0) + saleFins.reduce((a, x) => a + x.tax, 0),
      missingLines: orders.reduce((a, x) => a + x.missingLines, 0) + saleFins.reduce((a, x) => a + x.missingLines, 0),
      estimatedLines: lines.filter((l) => l.estimatedCost).length,
      ordersWithoutQuote: orders.filter((x) => !x.hasQuote).length,
    };
  });
}

export function loadPayments(start: Date, end: Date, refresh: number): Promise<Payment[]> {
  return cached(rk("payments", start, end, refresh), () =>
    fetchRange<Payment>(catalogCol.payments(TENANT_ID), "at", start, end).then((l) => l.filter((p) => p.status === "valid")),
  );
}

export function loadExpenses(start: Date, end: Date, refresh: number): Promise<Expense[]> {
  return cached(rk("expenses", start, end, refresh), () =>
    fetchRange<Expense>(financeCol.expenses(TENANT_ID), "date", start, end).then((l) => l.filter((e) => e.status === "valid")),
  );
}

/**
 * Gastos generados desde gastos fijos para esos meses ("YYYY-MM"), pagados o pendientes (sin anulados).
 * Se agrupan por el mes al que corresponden (`period`), aunque se hayan pagado otro mes.
 */
export function loadFixedExpenses(months: string[], refresh: number): Promise<Expense[]> {
  const uniq = [...new Set(months)].sort();
  return cached(`fixedExp|${uniq.join(",")}|${refresh}`, () =>
    fetchIn<Expense>(financeCol.expenses(TENANT_ID), "period", uniq).then((l) => l.filter((e) => e.fixedCostId && e.status !== "voided")),
  );
}

/** Todos los gastos pendientes de pagar (gastos fijos generados). */
export function loadPendingExpenses(refresh: number): Promise<Expense[]> {
  return cached(`pendingExp|${refresh}`, () => fetchAll<Expense>(financeCol.expenses(TENANT_ID), where("status", "==", "pending"), limit(2000)));
}

export function loadSupplierPayments(start: Date, end: Date, refresh: number): Promise<SupplierPayment[]> {
  return cached(rk("supplierPayments", start, end, refresh), () =>
    fetchRange<SupplierPayment>(financeCol.supplierPayments(TENANT_ID), "at", start, end).then((l) => l.filter((p) => p.status === "valid")),
  );
}

/** Presupuesto mensual por categoría (gastos variables). */
export function loadBudget(refresh: number): Promise<Record<string, number>> {
  return cached(`budget|${refresh}`, async () => {
    const snap = await getDoc(doc(db, financeCol.financeMeta(TENANT_ID), FINANCE_META_DOCS.budget));
    return ((snap.data() as FinanceBudget | undefined)?.budgets ?? {}) as Record<string, number>;
  });
}

export interface Balances {
  ordersDue: WorkOrder[];
  salesDue: Sale[];
  purchasesDue: Purchase[];
  receivable: number;
  payable: number;
}

/** Saldos al día de hoy (no dependen del período). */
export function loadBalances(refresh: number): Promise<Balances> {
  return cached(`balances|${refresh}`, async () => {
    const [orders, sales, purchases] = await Promise.all([
      fetchAll<WorkOrder>(orderCol.workOrders(TENANT_ID), where("balance", ">", 0), limit(2000)),
      fetchAll<Sale>(catalogCol.sales(TENANT_ID), where("balance", ">", 0), limit(2000)),
      fetchAll<Purchase>(financeCol.purchases(TENANT_ID), where("status", "in", ["pending", "partial"]), limit(2000)),
    ]);
    const ordersDue = orders.filter((o) => o.status !== "CANCELLED");
    const salesDue = sales.filter((s) => s.status !== "voided");
    return {
      ordersDue,
      salesDue,
      purchasesDue: purchases,
      receivable: ordersDue.reduce((a, o) => a + o.balance, 0) + salesDue.reduce((a, s) => a + s.balance, 0),
      payable: purchases.reduce((a, p) => a + (p.balance || 0), 0),
    };
  });
}

// ---------------- Agrupaciones ----------------
export interface ItemAgg {
  key: string;
  name: string;
  type: QuoteItemType;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  missing: boolean;
  estimated: boolean;
  docs: number;
}

export function aggregateItems(lines: FinLine[]): ItemAgg[] {
  const map = new Map<string, ItemAgg & { docSet: Set<string> }>();
  for (const l of lines) {
    let a = map.get(l.key);
    if (!a) {
      a = { key: l.key, name: l.name, type: l.type, qty: 0, revenue: 0, cost: 0, profit: 0, margin: null, missing: false, estimated: false, docs: 0, docSet: new Set() };
      map.set(l.key, a);
    }
    a.qty += l.qty;
    a.revenue += l.revenue;
    a.cost += l.cost;
    a.missing ||= l.missingCost;
    a.estimated ||= l.estimatedCost;
    a.docSet.add(`${l.source}:${l.docId}`);
  }
  return [...map.values()].map(({ docSet, ...a }) => ({ ...a, profit: a.revenue - a.cost, margin: pct(a.revenue - a.cost, a.revenue), docs: docSet.size }));
}

export interface TypeAgg {
  type: QuoteItemType;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
}

export function aggregateTypes(lines: FinLine[]): TypeAgg[] {
  const order: QuoteItemType[] = ["labor", "part", "service", "other"];
  return order.map((t) => {
    const l = lines.filter((x) => x.type === t);
    const revenue = l.reduce((a, x) => a + x.revenue, 0);
    const cost = l.reduce((a, x) => a + x.cost, 0);
    return { type: t, revenue, cost, profit: revenue - cost, margin: pct(revenue - cost, revenue) };
  });
}

export const orderMargin = (o: OrderFin) => pct(o.profit, o.revenue);
