/**
 * Utilidades de fecha en hora de Honduras (UTC-6, sin horario de verano),
 * independientes de la zona horaria del navegador.
 */
const OFFSET = 6 * 3600 * 1000;
export const HN_TZ = "America/Tegucigalpa";
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 18;

/** "YYYY-MM-DD" -> ms de la medianoche en Honduras */
export function dayStartMs(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) + OFFSET;
}

export function msToDayKey(ms: number): string {
  return new Date(ms - OFFSET).toISOString().slice(0, 10);
}

export function todayKey(): string {
  return msToDayKey(Date.now());
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function mondayOf(dayKey: string): string {
  const wd = weekday(dayKey);
  return addDays(dayKey, wd === 0 ? -6 : 1 - wd);
}

/** Minutos desde la medianoche (hora de Honduras) */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms - OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" en hora de Honduras */
export function timeInput(ms: number): string {
  const d = new Date(ms - OFFSET);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Fecha "YYYY-MM-DD" + hora "HH:MM" (Honduras) -> epoch ms */
export function combine(dayKey: string, time: string): number {
  const [h, mi] = time.split(":").map(Number);
  return dayStartMs(dayKey) + ((h ?? 0) * 60 + (mi ?? 0)) * 60000;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-HN", { timeZone: HN_TZ, ...opts });
const timeFmt = fmt({ hour: "numeric", minute: "2-digit" });
const longDayFmt = fmt({ weekday: "long", day: "numeric", month: "long" });
const shortDayFmt = fmt({ weekday: "short", day: "numeric" });
const monthFmt = fmt({ month: "long", year: "numeric" });
const dayMonthFmt = fmt({ day: "numeric", month: "short" });

export const fmtTime = (ms: number) => timeFmt.format(ms);
/** "martes, 23 de septiembre" */
export const fmtLongDay = (ms: number) => longDayFmt.format(ms);
export const fmtShortDay = (ms: number) => shortDayFmt.format(ms);
export const fmtMonth = (ms: number) => monthFmt.format(ms);
export const fmtDayMonth = (ms: number) => dayMonthFmt.format(ms);

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "a. m." : "p. m.";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${suffix}`;
}
