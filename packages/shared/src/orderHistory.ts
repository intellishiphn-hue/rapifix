import type { TimestampLike } from "./types";
import type { WorkOrder, WorkType } from "./workOrder";
import { hnDayKey } from "./operations";
import { normalizeText } from "./text";

/**
 * Historial de órdenes entregadas: lógica pura (sin Firebase ni React).
 * Dinero en centavos. Fechas en hora de Honduras (UTC-6 fijo).
 */

const DAY_MS = 86_400_000;
/** Tiempo que una orden entregada sigue visible en el tablero antes de pasar al historial. */
export const BOARD_DELIVERED_WINDOW_MS = 24 * 3_600_000;

type OrderDates = Pick<WorkOrder, "deliveredAt" | "statusChangedAt" | "updatedAt" | "createdAt">;
export type HistoryOrder = Pick<
  WorkOrder,
  "id" | "code" | "type" | "customerId" | "customer" | "vehicleId" | "vehicle" | "technicianIds" | "technicians" | "totals" | "paid" | "balance"
> & OrderDates;

const ms = (t: TimestampLike | null | undefined): number | null => (t && typeof t.toMillis === "function" ? t.toMillis() : null);

/** Momento de la entrega: deliveredAt; si falta (órdenes viejas), el último cambio de estado o la última edición. */
export function deliveredMs(o: Pick<WorkOrder, "deliveredAt" | "statusChangedAt" | "updatedAt">): number | null {
  return ms(o.deliveredAt) ?? ms(o.statusChangedAt) ?? ms(o.updatedAt);
}

/** true si la orden se entregó hace menos de `windowMs` (por defecto 24 horas): sigue en el tablero. */
export function isRecentlyDelivered(o: Pick<WorkOrder, "deliveredAt" | "statusChangedAt" | "updatedAt">, now: number, windowMs = BOARD_DELIVERED_WINDOW_MS): boolean {
  const at = deliveredMs(o);
  return at !== null && now - at < windowMs;
}

/** Días que el vehículo estuvo en el taller (ingreso → entrega), con decimales. null si faltan fechas. */
export function shopDaysExact(o: OrderDates): number | null {
  const start = ms(o.createdAt);
  const end = deliveredMs(o);
  if (start === null || end === null) return null;
  return Math.max(0, (end - start) / DAY_MS);
}

/** Días completos en el taller (0 = entró y salió en menos de 24 horas). */
export function shopDays(o: OrderDates): number {
  return Math.floor(shopDaysExact(o) ?? 0);
}

export const orderTotal = (o: Pick<WorkOrder, "totals">): number => o.totals?.total ?? 0;
export const orderPaid = (o: Pick<WorkOrder, "paid">): number => o.paid ?? 0;
/** Saldo pendiente (nunca negativo). */
export function orderBalance(o: Pick<WorkOrder, "totals" | "paid" | "balance">): number {
  const b = typeof o.balance === "number" ? o.balance : orderTotal(o) - orderPaid(o);
  return Math.max(0, b);
}
export const isOrderPaid = (o: Pick<WorkOrder, "totals" | "paid" | "balance">): boolean => orderBalance(o) <= 0;

// ---------------- Filtros ----------------

export type HistoryPayment = "all" | "paid" | "balance";

export interface HistoryFilters {
  /** Texto libre: cliente, teléfono, placa, marca, modelo u orden */
  search?: string;
  /** uid del técnico, o "none" para órdenes sin técnico */
  technicianId?: string;
  type?: WorkType | "";
  payment?: HistoryPayment;
}

const compact = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, "");

/**
 * Búsqueda sin tildes ni mayúsculas. Todas las palabras deben aparecer en la orden
 * (cliente, teléfono, placa, marca, modelo, año o código). "abc-123" encuentra la placa ABC123,
 * "9988 7766" o "99887766" encuentra el teléfono y "ot 1024" la orden OT-1024.
 */
export function matchesHistorySearch(o: Pick<WorkOrder, "code" | "customer" | "vehicle">, search: string): boolean {
  const q = normalizeText(search ?? "");
  if (!q) return true;
  const fields = [
    o.code, o.customer?.fullName, o.customer?.phone, o.customer?.whatsapp,
    o.vehicle?.plate, o.vehicle?.make, o.vehicle?.model, o.vehicle?.year ? String(o.vehicle.year) : "", o.vehicle?.color,
  ].filter((v): v is string => !!v);
  const hay = normalizeText(fields.join(" "));
  const hayCompact = fields.map(compact).join("|");
  const whole = compact(q);
  if (whole.length >= 2 && hayCompact.includes(whole)) return true;
  return q.split(" ").every((word) => {
    if (hay.includes(word)) return true;
    const c = compact(word);
    return c.length > 0 && hayCompact.includes(c);
  });
}

export function filterHistory<T extends HistoryOrder>(orders: T[], f: HistoryFilters): T[] {
  return orders.filter((o) => {
    if (f.technicianId) {
      const ids = o.technicianIds ?? [];
      if (f.technicianId === "none" ? ids.length > 0 : !ids.includes(f.technicianId)) return false;
    }
    if (f.type && o.type !== f.type) return false;
    if (f.payment === "paid" && !isOrderPaid(o)) return false;
    if (f.payment === "balance" && isOrderPaid(o)) return false;
    return matchesHistorySearch(o, f.search ?? "");
  });
}

/** Técnicos que aparecen en las órdenes (para el filtro), por nombre. */
export function historyTechnicians(orders: Array<Pick<WorkOrder, "technicians">>): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const o of orders) for (const t of o.technicians ?? []) if (t?.id && !map.has(t.id)) map.set(t.id, t.name || "Sin nombre");
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---------------- Resumen ----------------

export interface HistorySummary {
  count: number;
  billed: number;
  collected: number;
  balance: number;
  /** Órdenes con saldo pendiente */
  withBalance: number;
  /** Total facturado / órdenes (centavos, redondeado) */
  avgTicket: number;
  /** Promedio de días en taller; null si no hay órdenes con fechas */
  avgDays: number | null;
}

export function summarizeHistory(orders: HistoryOrder[]): HistorySummary {
  let billed = 0, collected = 0, balance = 0, withBalance = 0, daySum = 0, dayN = 0;
  for (const o of orders) {
    billed += orderTotal(o);
    collected += orderPaid(o);
    const b = orderBalance(o);
    balance += b;
    if (b > 0) withBalance++;
    const d = shopDaysExact(o);
    if (d !== null) {
      daySum += d;
      dayN++;
    }
  }
  return {
    count: orders.length, billed, collected, balance, withBalance,
    avgTicket: orders.length ? Math.round(billed / orders.length) : 0,
    avgDays: dayN ? Math.round((daySum / dayN) * 10) / 10 : null,
  };
}

// ---------------- Agrupar ----------------

export type HistoryGroupBy = "day" | "customer" | "vehicle";

export interface HistoryGroup<T> {
  key: string;
  label: string;
  /** Segunda línea: teléfono del cliente, o placa y dueño del vehículo */
  sublabel: string;
  /** Solo al agrupar por vehículo */
  plate?: string;
  orders: T[];
  count: number;
  total: number;
  balance: number;
  /** Entrega más reciente del grupo (ms) */
  lastMs: number;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-10-05" -> "Hoy", "Ayer" o "lunes 5 de octubre" (con el año si no es el actual). */
export function historyDayLabel(dayKey: string, now: number = Date.now()): string {
  const today = hnDayKey(now);
  if (dayKey === today) return "Hoy";
  if (dayKey === hnDayKey(now - DAY_MS)) return "Ayer";
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const base = `${WEEKDAYS[dow]} ${d} de ${MONTHS[m - 1]}`;
  return String(y) === today.slice(0, 4) ? base : `${base} de ${y}`;
}

/**
 * Agrupa las órdenes entregadas. Dentro de cada grupo, la entrega más reciente va primero.
 * - Por día (hora de Honduras): del día más reciente al más viejo.
 * - Por cliente o vehículo: primero los que más visitas tienen; si empatan, la visita más reciente.
 */
export function groupHistory<T extends HistoryOrder>(orders: T[], by: HistoryGroupBy, now: number = Date.now()): HistoryGroup<T>[] {
  const map = new Map<string, HistoryGroup<T>>();
  for (const o of orders) {
    const at = deliveredMs(o) ?? 0;
    let key: string;
    let label: string;
    let sublabel = "";
    let plate: string | undefined;
    if (by === "day") {
      key = at ? hnDayKey(at) : "sin-fecha";
      label = at ? historyDayLabel(key, now) : "Sin fecha de entrega";
    } else if (by === "customer") {
      key = o.customerId || normalizeText(o.customer?.fullName ?? "") || "sin-cliente";
      label = o.customer?.fullName || "Cliente sin nombre";
      sublabel = o.customer?.phone ?? "";
    } else {
      key = o.vehicleId || o.vehicle?.plate || "sin-vehiculo";
      label = [o.vehicle?.make, o.vehicle?.model, o.vehicle?.year || ""].filter(Boolean).join(" ") || "Vehículo";
      sublabel = o.customer?.fullName ?? "";
      plate = o.vehicle?.plate;
    }
    let g = map.get(key);
    if (!g) {
      g = { key, label, sublabel, plate, orders: [], count: 0, total: 0, balance: 0, lastMs: 0 };
      map.set(key, g);
    }
    g.orders.push(o);
    g.count++;
    g.total += orderTotal(o);
    g.balance += orderBalance(o);
    if (at > g.lastMs) g.lastMs = at;
  }
  const groups = [...map.values()];
  for (const g of groups) g.orders.sort((a, b) => (deliveredMs(b) ?? 0) - (deliveredMs(a) ?? 0));
  if (by === "day") groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  else groups.sort((a, b) => b.count - a.count || b.lastMs - a.lastMs);
  return groups;
}
