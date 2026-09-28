import { hnDayKey, netOf, VEHICLE_SIZE_LABELS, VEHICLE_SIZES, type CarwashMembership, type VehicleSize, type Wash } from "@rapifix/shared";
import { toDate } from "@/lib/format";
import { dayKeys, shortDayLabel } from "@/features/reports/period";
import { membershipNow, msOf } from "./ui";

const HN_MS = 6 * 3600 * 1000;
export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Ingreso sin ISV del lavado (solo si se cobró con una venta). */
export const washNet = (w: Wash) => (w.saleId && w.totals ? netOf(w.totals) : 0);

/** Valor de menú que se regaló (membresía o premio). */
export const washCourtesy = (w: Wash) => w.items.reduce((a, i) => a + (i.covered ? Math.max(0, i.listPrice - i.price) : 0), 0);

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface CarwashReport {
  count: number;
  delivered: number;
  cancelled: number;
  charged: number;
  income: number;
  tax: number;
  avgTicket: number;
  avgWaitMin: number;
  avgWashMin: number;
  courtesies: number;
  courtesyValue: number;
  pendingCharge: number;
  byDay: Array<{ key: string; label: string; count: number; amount: number }>;
  byService: Array<{ name: string; kind: string; count: number; covered: number; income: number }>;
  bySize: Array<{ size: VehicleSize; label: string; count: number; income: number }>;
  byHour: Array<{ hour: number; label: string; count: number }>;
  byWeekday: Array<{ dow: number; label: string; count: number }>;
  byWasher: Array<{ id: string; name: string; washes: number; delivered: number; income: number; commission: number }>;
  memberships: { active: number; recurring: number; newCount: number; renewals: number; income: number; expiringSoon: number };
}

/**
 * Números del carwash en el período. Los lavados se toman por fecha de registro.
 * - Ingresos: sin ISV, solo lavados cobrados (con venta). Las membresías se reportan aparte.
 * - Comisión: solo lavados entregados (no cancelados).
 */
export function buildCarwashReport(all: Wash[], memberships: CarwashMembership[], start: Date, end: Date): CarwashReport {
  const washes = all.filter((w) => w.status !== "cancelled");
  const charged = washes.filter((w) => !!w.saleId);
  const income = charged.reduce((a, w) => a + washNet(w), 0);
  const tax = charged.reduce((a, w) => a + (w.totals?.tax ?? 0), 0);

  const waits: number[] = [];
  const washTimes: number[] = [];
  for (const w of washes) {
    const c = msOf(w.createdAt);
    const s = msOf(w.startedAt);
    const r = msOf(w.readyAt);
    if (c && s && s >= c) waits.push((s - c) / 60000);
    if (s && r && r >= s) washTimes.push((r - s) / 60000);
  }

  const courtesyWashes = washes.filter((w) => w.membershipId || w.loyaltyRedeemed);

  // Por día
  const keys = dayKeys(start, end);
  const day = new Map(keys.map((k) => [k, { count: 0, amount: 0 }]));
  for (const w of washes) {
    const d = toDate(w.createdAt);
    if (!d) continue;
    const e = day.get(hnDayKey(d));
    if (!e) continue;
    e.count++;
    e.amount += washNet(w);
  }

  // Por servicio (ingreso de cada línea prorrateado sin ISV y con el descuento)
  const svc = new Map<string, { name: string; kind: string; count: number; covered: number; income: number }>();
  for (const w of washes) {
    const gross = w.items.reduce((a, i) => a + i.price, 0);
    const share = gross > 0 ? washNet(w) / gross : 0;
    for (const i of w.items) {
      const e = svc.get(i.serviceId) ?? { name: i.name, kind: i.kind, count: 0, covered: 0, income: 0 };
      e.count++;
      if (i.covered) e.covered++;
      e.income += Math.round(i.price * share);
      svc.set(i.serviceId, e);
    }
  }

  // Por tamaño
  const size = new Map(VEHICLE_SIZES.map((s) => [s, { count: 0, income: 0 }]));
  for (const w of washes) {
    const e = size.get(w.size);
    if (!e) continue;
    e.count++;
    e.income += washNet(w);
  }

  // Horas pico (hora de Honduras)
  const hours = Array.from({ length: 24 }, () => 0);
  const dows = Array.from({ length: 7 }, () => 0);
  for (const w of washes) {
    const ms = msOf(w.createdAt);
    if (!ms) continue;
    const hn = new Date(ms - HN_MS);
    hours[hn.getUTCHours()]!++;
    dows[hn.getUTCDay()]!++;
  }
  const firstHour = hours.findIndex((n) => n > 0);
  const lastHour = 23 - [...hours].reverse().findIndex((n) => n > 0);
  const from = firstHour < 0 ? 7 : Math.min(firstHour, 7);
  const to = firstHour < 0 ? 18 : Math.max(lastHour, 18);
  const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "a. m." : "p. m."}`;

  // Por lavador
  const wash = new Map<string, { id: string; name: string; washes: number; delivered: number; income: number; commission: number }>();
  for (const w of washes) {
    const id = w.washerId ?? "";
    const e = wash.get(id) ?? { id, name: w.washerName || "Sin lavador", washes: 0, delivered: 0, income: 0, commission: 0 };
    if (!e.name && w.washerName) e.name = w.washerName;
    e.washes++;
    e.income += washNet(w);
    if (w.status === "delivered") {
      e.delivered++;
      e.commission += w.commission || 0;
    }
    wash.set(id, e);
  }

  // Membresías: estado a hoy y ventas/renovaciones del período
  const s0 = start.getTime();
  const e0 = end.getTime();
  const now = Date.now();
  let active = 0;
  let recurring = 0;
  let expiringSoon = 0;
  let newCount = 0;
  let renewals = 0;
  let memIncome = 0;
  for (const m of memberships) {
    const v = membershipNow(m, now);
    if (v.status === "active") {
      active++;
      recurring += m.plan?.price ?? 0;
      if (v.daysLeft <= 5) expiringSoon++;
    }
    for (const h of m.history ?? []) {
      if (h.at < s0 || h.at >= e0) continue;
      if (h.kind === "new") newCount++;
      else renewals++;
      memIncome += h.amount;
    }
  }

  return {
    count: washes.length,
    delivered: washes.filter((w) => w.status === "delivered").length,
    cancelled: all.length - washes.length,
    charged: charged.length,
    income,
    tax,
    avgTicket: charged.length ? Math.round(income / charged.length) : 0,
    avgWaitMin: avg(waits),
    avgWashMin: avg(washTimes),
    courtesies: courtesyWashes.length,
    courtesyValue: courtesyWashes.reduce((a, w) => a + washCourtesy(w), 0),
    pendingCharge: washes.filter((w) => !w.paid && w.total > 0).length,
    byDay: keys.map((k) => ({ key: k, label: shortDayLabel(k), ...day.get(k)! })),
    byService: [...svc.values()].sort((a, b) => b.count - a.count || b.income - a.income),
    bySize: VEHICLE_SIZES.map((s) => ({ size: s, label: VEHICLE_SIZE_LABELS[s], ...size.get(s)! })),
    byHour: Array.from({ length: to - from + 1 }, (_, i) => ({ hour: from + i, label: hourLabel(from + i), count: hours[from + i] ?? 0 })),
    byWeekday: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ dow: d, label: WEEKDAYS[d]!, count: dows[d] ?? 0 })),
    byWasher: [...wash.values()].sort((a, b) => b.delivered - a.delivered || b.income - a.income),
    memberships: { active, recurring, newCount, renewals, income: memIncome, expiringSoon },
  };
}
