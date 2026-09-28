import { hnDayKey } from "@rapifix/shared";
import { dayKeys, hnDate, hnParts, hnTodayStart, shortDayLabel, type Period, type PeriodKey } from "@/features/reports/period";

export const DAY_MS = 86400000;

/** Fin real del período: no pasa de hoy (para comparar días transcurridos contra días transcurridos). */
export function effectiveEnd(p: Period): Date {
  return new Date(Math.min(p.end.getTime(), hnTodayStart().getTime() + DAY_MS));
}

const fmtShort = (d: Date) => new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Tegucigalpa" }).format(d);

export function rangeLabel(start: Date, end: Date) {
  const last = new Date(end.getTime() - 1);
  return hnDayKey(start) === hnDayKey(last) ? fmtShort(start) : `${fmtShort(start)} al ${fmtShort(last)}`;
}

/**
 * Período anterior de igual duración.
 * Mes y año se comparan contra los mismos días del mes/año anterior (1 al 27 contra 1 al 27);
 * hoy, semana y personalizado se corren hacia atrás la misma cantidad de días.
 */
export function previousPeriod(key: PeriodKey, p: Period): Period {
  const effEnd = effectiveEnd(p);
  const full = effEnd.getTime() >= p.end.getTime();
  const s = hnParts(p.start);
  const e = hnParts(effEnd);
  let start: Date;
  let end: Date;
  if (key === "month" || key === "prevMonth") {
    start = hnDate(s.y, s.m - 1, 1);
    end = full ? p.start : new Date(Math.min(hnDate(s.y, s.m - 1, e.d).getTime(), p.start.getTime()));
  } else if (key === "year") {
    start = hnDate(s.y - 1, 1, 1);
    end = full ? p.start : new Date(Math.min(hnDate(s.y - 1, e.m, e.d).getTime(), p.start.getTime()));
  } else {
    const dur = Math.max(DAY_MS, effEnd.getTime() - p.start.getTime());
    start = new Date(p.start.getTime() - dur);
    end = p.start;
  }
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + DAY_MS);
  return { start, end, label: rangeLabel(start, end) };
}

export interface Bucket {
  key: string;
  label: string;
}

const fmtMonthShort = (key: string) =>
  new Intl.DateTimeFormat("es-HN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-15T12:00:00Z`));
const fmtMonthLong = (key: string) => {
  const s = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-15T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const monthLabel = fmtMonthLong;

/** Claves "YYYY-MM" entre start y end (excluido). */
export function monthKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  const s = hnParts(start);
  const last = hnDayKey(end.getTime() - 1).slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const k = hnDayKey(hnDate(s.y, s.m + i, 1)).slice(0, 7);
    out.push(k);
    if (k >= last) break;
  }
  return out;
}

/** Agrupación del gráfico: por día o por mes si el período pasa de 62 días. */
export function buckets(p: Period): { mode: "day" | "month"; list: Bucket[]; keyOf: (d: Date) => string } {
  const end = effectiveEnd(p);
  const days = (end.getTime() - p.start.getTime()) / DAY_MS;
  if (days > 62) {
    return { mode: "month", list: monthKeys(p.start, end).map((k) => ({ key: k, label: fmtMonthShort(k) })), keyOf: (d) => hnDayKey(d).slice(0, 7) };
  }
  return { mode: "day", list: dayKeys(p.start, p.end).map((k) => ({ key: k, label: shortDayLabel(k) })), keyOf: (d) => hnDayKey(d) };
}

/** Últimos 12 meses (incluye el actual), independiente del selector. */
export function last12Months(): Period {
  const t = hnParts();
  const start = hnDate(t.y, t.m - 11, 1);
  const end = hnDate(t.y, t.m + 1, 1);
  return { start, end, label: `${fmtMonthLong(hnDayKey(start).slice(0, 7))} a ${fmtMonthLong(hnDayKey(hnDate(t.y, t.m, 1)).slice(0, 7))}` };
}
