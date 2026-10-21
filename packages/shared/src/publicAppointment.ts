import { z } from "zod";
import { isValidPhone, normalizePhone, PHONE_ERROR } from "./phone";
import type { AppointmentType } from "./operations";

/**
 * Citas que el cliente pide desde la web (/agendar). Se guardan en la misma colección de la agenda
 * (opsCol.appointments) como "Agendada" con source "web"; el taller las confirma desde el panel.
 * Todo en hora de Honduras (UTC-6, sin horario de verano).
 */

/** Motivos que el cliente puede elegir y el tipo de cita del panel que les corresponde */
export const WEB_REASONS = [
  { id: "mantenimiento", label: "Mantenimiento", type: "maintenance" },
  { id: "frenos", label: "Frenos", type: "appointment" },
  { id: "diagnostico", label: "Diagnóstico", type: "diagnosis" },
  { id: "aire", label: "Aire acondicionado", type: "appointment" },
  { id: "carwash", label: "Carwash", type: "appointment" },
  { id: "otro", label: "Otro", type: "appointment" },
] as const satisfies ReadonlyArray<{ id: string; label: string; type: AppointmentType }>;
export type WebReason = (typeof WEB_REASONS)[number]["id"];
export const WEB_REASON_IDS = WEB_REASONS.map((r) => r.id) as unknown as readonly [WebReason, ...WebReason[]];
export const webReason = (id: WebReason) => WEB_REASONS.find((r) => r.id === id)!;

/** Categoría del catálogo público → motivo (las demás van como "otro" con el nombre de la categoría) */
export function reasonForCategory(categoryId: string): WebReason {
  return (["mantenimiento", "frenos", "diagnostico", "aire"] as const).find((r) => r === categoryId) ?? "otro";
}

/** Horario de atención: [abre, cierra] en minutos desde medianoche; null = cerrado. Índice = día de la semana (0 = domingo). */
export const HN_OPENING: ReadonlyArray<readonly [number, number] | null> = [
  null,
  [8 * 60, 17 * 60],
  [8 * 60, 17 * 60],
  [8 * 60, 17 * 60],
  [8 * 60, 17 * 60],
  [8 * 60, 17 * 60],
  [8 * 60, 15 * 60],
];
export const SLOT_MINUTES = 30;
/** El último bloque empieza 1 hora antes del cierre */
export const LAST_SLOT_BEFORE_CLOSE = 60;
/** Citas web por bloque de 30 minutos (cuenta todas las citas no canceladas que empiezan en ese bloque) */
export const SLOT_CAPACITY = 2;
/** Se puede pedir desde mañana y hasta 30 días después */
export const BOOKING_DAYS = 30;
/** Máximo de citas futuras activas por teléfono */
export const MAX_ACTIVE_PER_PHONE = 2;

const HN_OFFSET_MS = 6 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" de un instante, en hora de Honduras */
export const hnDateKey = (ms: number) => new Date(ms - HN_OFFSET_MS).toISOString().slice(0, 10);
/** Día de la semana (0 = domingo) de una fecha "YYYY-MM-DD" */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}
/** Suma días a una fecha "YYYY-MM-DD" */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
/** Instante (epoch ms) de una fecha y hora de Honduras */
export function hnSlotMs(dateKey: string, time: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return Date.UTC(y!, m! - 1, d!, h!, min!) + HN_OFFSET_MS;
}
/** "HH:MM" en hora de Honduras */
export const hnTime = (ms: number) => new Date(ms - HN_OFFSET_MS).toISOString().slice(11, 16);

/** Bloques de 30 minutos de un día ("08:00", "08:30"...). Vacío si está cerrado. */
export function slotsForDay(dateKey: string): string[] {
  const open = HN_OPENING[weekdayOf(dateKey)];
  if (!open) return [];
  const out: string[] = [];
  for (let t = open[0]; t <= open[1] - LAST_SLOT_BEFORE_CLOSE; t += SLOT_MINUTES) out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  return out;
}

/** Días que se pueden pedir: desde mañana hasta BOOKING_DAYS, solo los que abre el taller */
export function bookableDays(nowMs: number): string[] {
  const today = hnDateKey(nowMs);
  const out: string[] = [];
  for (let i = 1; i <= BOOKING_DAYS; i++) {
    const k = addDays(today, i);
    if (slotsForDay(k).length) out.push(k);
  }
  return out;
}

export function isBookable(dateKey: string, time: string, nowMs: number): boolean {
  return bookableDays(nowMs).includes(dateKey) && slotsForDay(dateKey).includes(time);
}

/** Horas libres de un día, según cuántas citas ya empiezan en cada bloque */
export function availableSlots(dateKey: string, taken: Record<string, number>, nowMs: number, capacity = SLOT_CAPACITY): string[] {
  if (!bookableDays(nowMs).includes(dateKey)) return [];
  return slotsForDay(dateKey).filter((t) => (taken[t] ?? 0) < capacity);
}

/** Bloque al que pertenece una hora cualquiera ("09:40" → "09:30") */
export function slotOf(ms: number): string {
  const t = hnTime(ms);
  const [h, m] = t.split(":").map(Number);
  return `${pad(h!)}:${pad(m! - (m! % SLOT_MINUTES))}`;
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida");

export const publicSlotsSchema = z.object({ date: dateKey }).strict();

export const publicAppointmentSchema = z
  .object({
    name: z.string().trim().min(2, "Escribe tu nombre").max(80, "Máximo 80 caracteres"),
    phone: z.string().trim().max(30).refine((v) => isValidPhone(v, "504"), PHONE_ERROR),
    plate: z.string().trim().max(12, "Máximo 12 caracteres").optional().default(""),
    vehicle: z.string().trim().max(60, "Máximo 60 caracteres").optional().default(""),
    reason: z.enum(WEB_REASON_IDS),
    /** detalle del motivo (p. ej. la categoría del catálogo) */
    detail: z.string().trim().max(80).optional().default(""),
    date: dateKey,
    time: timeKey,
    comment: z.string().trim().max(500, "Máximo 500 caracteres").optional().default(""),
    /** campo trampa para bots: debe llegar vacío */
    website: z.string().max(0).optional().default(""),
  })
  .strict();
export type PublicAppointmentInput = z.input<typeof publicAppointmentSchema>;

export const webPhone = (v: string) => normalizePhone(v, "504");

export interface PublicAppointmentResult {
  ok: true;
  date: string;
  time: string;
}
export interface PublicSlotsResult {
  date: string;
  slots: string[];
}
