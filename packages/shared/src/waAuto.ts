/**
 * WhatsApp automático: cola de envío (tenants/{tid}/waOutbox) que atiende un programa
 * ("worker") instalado en la computadora del taller, junto a OpenWA.
 * Aquí vive la lógica pura (sin Firebase) para poder probarla.
 */
import { z } from "zod";
import type { TimestampLike } from "./types";

export const waCol = {
  outbox: (tid: string) => `tenants/${tid}/waOutbox`,
  /** waStatus/current: estado del worker (lo lee el panel). waStatus/counter: mensajes del día. */
  status: (tid: string) => `tenants/${tid}/waStatus`,
  /** anti-duplicados (solo servidor) */
  dedupe: (tid: string) => `tenants/${tid}/waDedupe`,
  /** hash del token → taller (solo servidor) */
  tokens: "waWorkerTokens",
} as const;

export const WA_OUTBOX_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"] as const;
export type WaOutboxStatus = (typeof WA_OUTBOX_STATUSES)[number];

export const WA_OUTBOX_STATUS_LABELS: Record<WaOutboxStatus, string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falló",
  cancelled: "Cancelado",
};

export interface WaOutbox {
  id: string;
  to: string;
  name: string;
  body: string;
  context: string;
  orderId: string | null;
  orderCode: string | null;
  washId: string | null;
  status: WaOutboxStatus;
  attempts: number;
  error: string | null;
  waMessageId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: TimestampLike;
  sentAt: TimestampLike | null;
  expiresAt: TimestampLike;
  nextAttemptAt: TimestampLike;
  leaseUntil: TimestampLike | null;
}

/** Estado simplificado de la sesión de WhatsApp en la computadora del taller. */
export type WaSessionState = "connected" | "qr" | "starting" | "action" | "disconnected" | "gateway_down";

/**
 * Traduce el estado que reporta OpenWA (created, initializing, qr_ready, authenticating, ready,
 * disconnected, action_required, failed) o el worker (unreachable, session_not_found, bad_api_key).
 */
export function waSessionState(raw: string | null | undefined): WaSessionState {
  switch (String(raw ?? "").toLowerCase()) {
    case "ready": return "connected";
    case "qr_ready": return "qr";
    case "created":
    case "initializing":
    case "authenticating": return "starting";
    case "action_required": return "action";
    case "unreachable":
    case "session_not_found":
    case "bad_api_key": return "gateway_down";
    default: return "disconnected";
  }
}

export interface WaStatusDoc {
  lastSeenAt?: TimestampLike | null;
  /** estado tal como lo reporta OpenWA o el worker */
  rawStatus?: string;
  sessionStatus?: WaSessionState;
  phone?: string | null;
  workerVersion?: string | null;
  hasToken?: boolean;
  tokenCreatedAt?: TimestampLike | null;
}

/** settings/whatsapp (lo guardan administración y gerencia) */
export interface WaAutoSettings {
  waAuto: boolean;
  waAutoSilent: boolean;
  dailyLimit: number;
}
export const WA_DEFAULT_DAILY_LIMIT = 200;
export const DEFAULT_WA_AUTO: WaAutoSettings = { waAuto: false, waAutoSilent: false, dailyLimit: WA_DEFAULT_DAILY_LIMIT };

export function waAutoSettings(data: Partial<WaAutoSettings> | null | undefined): WaAutoSettings {
  const limit = Number(data?.dailyLimit);
  return {
    waAuto: data?.waAuto === true,
    waAutoSilent: data?.waAutoSilent === true,
    dailyLimit: Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : WA_DEFAULT_DAILY_LIMIT,
  };
}

/** Si el worker no reporta en este tiempo, se considera apagado. */
export const WA_ONLINE_MS = 2 * 60_000;
export const WA_LEASE_MS = 2 * 60_000;
export const WA_MAX_ATTEMPTS = 3;
/** espera antes del 2.º y 3.er intento */
export const WA_RETRY_WAIT_MS = [60_000, 5 * 60_000] as const;
export const WA_DEDUPE_MS = 60_000;
export const WA_PER_MINUTE = 15;
export const WA_PULL_MAX = 5;
/** Avisos normales: si no salen en 4 horas, ya no se mandan. */
export const WA_TTL_MS = 4 * 3_600_000;
/** "Encolar para cuando encienda" */
export const WA_TTL_HOLD_MS = 12 * 3_600_000;
/** Recordatorios (cita, mantenimiento, membresía): pueden salir al día siguiente. */
export const WA_TTL_REMINDER_MS = 36 * 3_600_000;
const REMINDER_CONTEXTS = ["cita", "mantenimiento", "carwash-membresia", "recordatorio"];

export function waTtlMs(context: string, hold: boolean): number {
  if (REMINDER_CONTEXTS.includes(context.trim().toLowerCase())) return WA_TTL_REMINDER_MS;
  return hold ? WA_TTL_HOLD_MS : WA_TTL_MS;
}

type Millis = number | TimestampLike | null | undefined;
const ms = (v: Millis): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const t = v as unknown as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  return typeof t.seconds === "number" ? t.seconds * 1000 : 0;
};

export function waWorkerOnline(status: Pick<WaStatusDoc, "lastSeenAt"> | null | undefined, nowMs: number): boolean {
  const seen = ms(status?.lastSeenAt);
  return seen > 0 && nowMs - seen <= WA_ONLINE_MS;
}

export type WaAvailability = "ready" | "off" | "offline" | "unlinked" | "starting" | "gateway_down";

/** ¿Se puede mandar ahora mismo en automático? */
export function waAvailability(settings: Pick<WaAutoSettings, "waAuto">, status: WaStatusDoc | null | undefined, nowMs: number): WaAvailability {
  if (!settings.waAuto) return "off";
  if (!waWorkerOnline(status, nowMs)) return "offline";
  switch (status?.sessionStatus) {
    case "connected": return "ready";
    case "starting": return "starting";
    case "gateway_down": return "gateway_down";
    default: return "unlinked";
  }
}

export const WA_AVAILABILITY_LABELS: Record<WaAvailability, string> = {
  ready: "Conectado",
  off: "Apagado",
  offline: "Computadora apagada o sin conexión",
  unlinked: "WhatsApp desvinculado: escanee el QR en la computadora del taller",
  starting: "WhatsApp se está conectando",
  gateway_down: "OpenWA no responde en la computadora del taller",
};

/** WhatsApp identifica el chat como <dígitos>@c.us */
export function waChatId(e164: string): string {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `${digits}@c.us` : "";
}

export const WA_SEND_FROM_HOUR = 7;
export const WA_SEND_TO_HOUR = 20;
/** Solo se entrega entre 7:00 y 20:00, hora de Honduras (UTC-6, sin horario de verano). */
export function inWaSendWindow(nowMs: number): boolean {
  const hour = new Date(nowMs - 6 * 3_600_000).getUTCHours();
  return hour >= WA_SEND_FROM_HOUR && hour < WA_SEND_TO_HOUR;
}

type OutboxTimes = { status: WaOutboxStatus; expiresAt: Millis; nextAttemptAt?: Millis; leaseUntil?: Millis };

export function waExpired(m: Pick<OutboxTimes, "expiresAt">, nowMs: number): boolean {
  const exp = ms(m.expiresAt);
  return exp > 0 && nowMs >= exp;
}

/** Pendiente = en cola, o "enviando" con el permiso vencido (el worker se cayó a medio envío). */
export function waPending(m: OutboxTimes, nowMs: number): boolean {
  if (m.status === "queued") return true;
  return m.status === "sending" && ms(m.leaseUntil) <= nowMs;
}

/** ¿El pull puede entregar este mensaje ahora? */
export function waEligible(m: OutboxTimes, nowMs: number): boolean {
  if (!waPending(m, nowMs) || waExpired(m, nowMs)) return false;
  return m.status === "sending" || ms(m.nextAttemptAt) <= nowMs;
}

/** Qué hacer cuando un envío falla. attempts = intentos ya hechos (incluye el que falló). */
export function waAfterFailure(attempts: number, nowMs: number, permanent = false): { status: "queued" | "failed"; nextAttemptAt: number } {
  if (permanent || attempts >= WA_MAX_ATTEMPTS) return { status: "failed", nextAttemptAt: nowMs };
  const wait = WA_RETRY_WAIT_MS[Math.max(0, Math.min(attempts, WA_RETRY_WAIT_MS.length) - 1)]!;
  return { status: "queued", nextAttemptAt: nowMs + wait };
}

/** Texto con el que se detecta un mensaje repetido (mismo número y mismo contenido). */
export function waDedupeText(to: string, body: string): string {
  return `${to.replace(/\D/g, "")}|${body.normalize("NFC").replace(/\s+/g, " ").trim()}`;
}
export function waIsDuplicate(lastAtMs: number | null | undefined, nowMs: number): boolean {
  return !!lastAtMs && nowMs - lastAtMs < WA_DEDUPE_MS;
}

/** Contador diario: devuelve el nuevo conteo, o null si ya se llegó al límite. */
export function waDailyNext(counter: { day?: string; count?: number } | null | undefined, today: string, limit: number): number | null {
  const used = counter?.day === today ? Number(counter.count ?? 0) : 0;
  return used >= limit ? null : used + 1;
}

export const queueWhatsAppSchema = z.object({
  to: z.string().trim().min(5, "Falta el número de WhatsApp").max(25),
  name: z.string().trim().max(120).default(""),
  body: z.string().trim().min(1, "El mensaje está vacío").max(4000, "El mensaje es demasiado largo"),
  context: z.string().trim().max(40).default("mensaje"),
  orderId: z.string().trim().min(1).max(128).nullish(),
  orderCode: z.string().trim().min(1).max(30).nullish(),
  washId: z.string().trim().min(1).max(128).nullish(),
  /** encolar aunque la computadora esté apagada (sale cuando encienda, si no ha vencido) */
  hold: z.boolean().nullish(),
});
export type QueueWhatsAppInput = z.input<typeof queueWhatsAppSchema>;
export const waOutboxIdSchema = z.object({ id: z.string().trim().min(1).max(128) });
