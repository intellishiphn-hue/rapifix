import { hnDayKey } from "@rapifix/shared";

/** Honduras: UTC-6 fijo (sin horario de verano). */
const HN_OFFSET_H = 6;

export type PeriodKey = "today" | "week" | "month" | "prevMonth" | "year" | "custom";

export const PERIOD_OPTIONS: Array<[PeriodKey, string]> = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["prevMonth", "Mes anterior"],
  ["year", "Este año"],
  ["custom", "Personalizado"],
];

export interface Period {
  /** inicio incluido */
  start: Date;
  /** fin excluido */
  end: Date;
  label: string;
}

/** Inicio del día (hora de Honduras) para año/mes(1-12)/día; acepta desbordes (día 0, 32…). */
export function hnDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, HN_OFFSET_H));
}

/** Partes de la fecha en hora de Honduras. */
export function hnParts(d: Date | number = Date.now()) {
  const [y, m, day] = hnDayKey(d).split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = domingo
  return { y, m, d: day, dow };
}

/** Inicio del día de hoy en Honduras. */
export function hnTodayStart(): Date {
  const p = hnParts();
  return hnDate(p.y, p.m, p.d);
}

/** "YYYY-MM-DD" -> inicio de ese día en Honduras */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return hnDate(y, m, d);
}

const fmtDay = (d: Date) => new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Tegucigalpa" }).format(d);
const fmtMonth = (d: Date) => new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "America/Tegucigalpa" }).format(d);

export function computePeriod(key: PeriodKey, custom?: { from: string; to: string }): Period {
  const p = hnParts();
  const today = hnDate(p.y, p.m, p.d);
  const tomorrow = hnDate(p.y, p.m, p.d + 1);
  switch (key) {
    case "today":
      return { start: today, end: tomorrow, label: `Hoy, ${fmtDay(today)}` };
    case "week": {
      const back = (p.dow + 6) % 7; // semana de lunes a domingo
      const start = hnDate(p.y, p.m, p.d - back);
      return { start, end: tomorrow, label: `Semana del ${fmtDay(start)}` };
    }
    case "month": {
      const start = hnDate(p.y, p.m, 1);
      return { start, end: hnDate(p.y, p.m + 1, 1), label: capital(fmtMonth(start)) };
    }
    case "prevMonth": {
      const start = hnDate(p.y, p.m - 1, 1);
      return { start, end: hnDate(p.y, p.m, 1), label: capital(fmtMonth(start)) };
    }
    case "year": {
      const start = hnDate(p.y, 1, 1);
      return { start, end: hnDate(p.y + 1, 1, 1), label: `Año ${p.y}` };
    }
    case "custom": {
      const from = custom?.from || hnDayKey(today);
      const to = custom?.to && custom.to >= from ? custom.to : from;
      const start = keyToDate(from);
      const endDay = keyToDate(to);
      const end = new Date(endDay.getTime() + 86400000);
      return { start, end, label: from === to ? fmtDay(start) : `${fmtDay(start)} al ${fmtDay(endDay)}` };
    }
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Claves de día (hora de Honduras) del período, sin pasar de hoy. */
export function dayKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  const limit = Math.min(end.getTime(), hnTodayStart().getTime() + 86400000);
  for (let t = start.getTime(); t < limit; t += 86400000) out.push(hnDayKey(t));
  return out;
}

/** "2026-09-23" -> "23 sep" */
export function shortDayLabel(key: string): string {
  return new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
}
