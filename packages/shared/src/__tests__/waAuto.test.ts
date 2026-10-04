import { describe, expect, it } from "vitest";
import {
  inWaSendWindow, queueWhatsAppSchema, waAfterFailure, waAutoSettings, waAvailability, waChatId, waDailyNext, waDedupeText, waEligible,
  waExpired, waIsDuplicate, waPending, waSessionState, waTtlMs, waWorkerOnline, WA_TTL_HOLD_MS, WA_TTL_MS, WA_TTL_REMINDER_MS,
} from "../waAuto";

const NOW = Date.UTC(2026, 9, 5, 16, 0, 0); // 10:00 en Honduras
const hn = (h: number, m = 0) => Date.UTC(2026, 9, 5, h + 6, m, 0);

describe("waChatId", () => {
  it("usa solo los dígitos del E.164", () => {
    expect(waChatId("+50499998888")).toBe("50499998888@c.us");
    expect(waChatId("+1 (305) 555-1234")).toBe("13055551234@c.us");
  });
  it("rechaza números vacíos o imposibles", () => {
    expect(waChatId("")).toBe("");
    expect(waChatId("+123")).toBe("");
    expect(waChatId("1234567890123456")).toBe("");
  });
});

describe("ventana horaria (7:00 a 20:00 de Honduras)", () => {
  it("entrega dentro del horario", () => {
    expect(inWaSendWindow(hn(7))).toBe(true);
    expect(inWaSendWindow(hn(12, 30))).toBe(true);
    expect(inWaSendWindow(hn(19, 59))).toBe(true);
  });
  it("no entrega de noche ni de madrugada", () => {
    expect(inWaSendWindow(hn(6, 59))).toBe(false);
    expect(inWaSendWindow(hn(20))).toBe(false);
    expect(inWaSendWindow(hn(23))).toBe(false);
    expect(inWaSendWindow(hn(2))).toBe(false);
  });
});

describe("estado del worker", () => {
  it("traduce los estados de OpenWA", () => {
    expect(waSessionState("ready")).toBe("connected");
    expect(waSessionState("qr_ready")).toBe("qr");
    expect(waSessionState("initializing")).toBe("starting");
    expect(waSessionState("authenticating")).toBe("starting");
    expect(waSessionState("action_required")).toBe("action");
    expect(waSessionState("disconnected")).toBe("disconnected");
    expect(waSessionState("failed")).toBe("disconnected");
    expect(waSessionState("unreachable")).toBe("gateway_down");
    expect(waSessionState(undefined)).toBe("disconnected");
  });
  it("en línea solo si reportó en los últimos 2 minutos", () => {
    expect(waWorkerOnline({ lastSeenAt: { seconds: (NOW - 30_000) / 1000, nanoseconds: 0 } as never }, NOW)).toBe(true);
    expect(waWorkerOnline({ lastSeenAt: { seconds: (NOW - 121_000) / 1000, nanoseconds: 0 } as never }, NOW)).toBe(false);
    expect(waWorkerOnline(null, NOW)).toBe(false);
    expect(waWorkerOnline({}, NOW)).toBe(false);
  });
  it("disponibilidad para el compositor", () => {
    const seen = { seconds: (NOW - 10_000) / 1000, nanoseconds: 0 } as never;
    const old = { seconds: (NOW - 600_000) / 1000, nanoseconds: 0 } as never;
    expect(waAvailability({ waAuto: false }, { lastSeenAt: seen, sessionStatus: "connected" }, NOW)).toBe("off");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: seen, sessionStatus: "connected" }, NOW)).toBe("ready");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: old, sessionStatus: "connected" }, NOW)).toBe("offline");
    expect(waAvailability({ waAuto: true }, null, NOW)).toBe("offline");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: seen, sessionStatus: "qr" }, NOW)).toBe("unlinked");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: seen, sessionStatus: "disconnected" }, NOW)).toBe("unlinked");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: seen, sessionStatus: "starting" }, NOW)).toBe("starting");
    expect(waAvailability({ waAuto: true }, { lastSeenAt: seen, sessionStatus: "gateway_down" }, NOW)).toBe("gateway_down");
  });
  it("configuración con valores por defecto seguros", () => {
    expect(waAutoSettings(null)).toEqual({ waAuto: false, waAutoSilent: false, dailyLimit: 200 });
    expect(waAutoSettings({ waAuto: true, dailyLimit: 50 })).toEqual({ waAuto: true, waAutoSilent: false, dailyLimit: 50 });
    expect(waAutoSettings({ dailyLimit: 999999 }).dailyLimit).toBe(200);
    expect(waAutoSettings({ waAuto: "si" as never }).waAuto).toBe(false);
  });
});

describe("elegibilidad y vencimiento", () => {
  const base = { status: "queued" as const, expiresAt: NOW + 3_600_000, nextAttemptAt: NOW - 1 };
  it("entrega lo que está en cola y no ha vencido", () => {
    expect(waEligible(base, NOW)).toBe(true);
  });
  it("no entrega lo vencido", () => {
    expect(waExpired({ expiresAt: NOW }, NOW)).toBe(true);
    expect(waEligible({ ...base, expiresAt: NOW - 1 }, NOW)).toBe(false);
  });
  it("respeta la espera entre reintentos", () => {
    expect(waEligible({ ...base, nextAttemptAt: NOW + 30_000 }, NOW)).toBe(false);
  });
  it("no entrega lo enviado, fallido o cancelado", () => {
    for (const status of ["sent", "failed", "cancelled"] as const) expect(waEligible({ ...base, status }, NOW)).toBe(false);
  });
  it("un 'enviando' solo se vuelve a entregar si su permiso de 2 minutos venció", () => {
    expect(waEligible({ ...base, status: "sending", leaseUntil: NOW + 60_000 }, NOW)).toBe(false);
    expect(waEligible({ ...base, status: "sending", leaseUntil: NOW - 1 }, NOW)).toBe(true);
    expect(waPending({ ...base, status: "sending", leaseUntil: NOW + 60_000 }, NOW)).toBe(false);
  });
  it("vencimiento según el tipo de mensaje", () => {
    expect(waTtlMs("orden", false)).toBe(WA_TTL_MS);
    expect(waTtlMs("orden", true)).toBe(WA_TTL_HOLD_MS);
    expect(waTtlMs("cita", false)).toBe(WA_TTL_REMINDER_MS);
    expect(waTtlMs("Mantenimiento", true)).toBe(WA_TTL_REMINDER_MS);
  });
});

describe("reintentos", () => {
  it("reintenta con espera y falla al tercer intento", () => {
    expect(waAfterFailure(1, NOW)).toEqual({ status: "queued", nextAttemptAt: NOW + 60_000 });
    expect(waAfterFailure(2, NOW)).toEqual({ status: "queued", nextAttemptAt: NOW + 300_000 });
    expect(waAfterFailure(3, NOW).status).toBe("failed");
  });
  it("un error definitivo (número sin WhatsApp) no se reintenta", () => {
    expect(waAfterFailure(1, NOW, true).status).toBe("failed");
  });
});

describe("anti-duplicados y límite diario", () => {
  it("mismo número y mismo texto dan la misma clave aunque cambien los espacios", () => {
    expect(waDedupeText("+504 9999-8888", "Hola  Juan\n")).toBe(waDedupeText("+50499998888", "Hola Juan"));
    expect(waDedupeText("+50499998888", "Hola Juan")).not.toBe(waDedupeText("+50499998889", "Hola Juan"));
    expect(waDedupeText("+50499998888", "Hola Juan")).not.toBe(waDedupeText("+50499998888", "Hola Ana"));
  });
  it("duplicado solo dentro de 60 segundos", () => {
    expect(waIsDuplicate(NOW - 59_000, NOW)).toBe(true);
    expect(waIsDuplicate(NOW - 60_000, NOW)).toBe(false);
    expect(waIsDuplicate(null, NOW)).toBe(false);
  });
  it("cuenta por día y se reinicia al día siguiente", () => {
    expect(waDailyNext(null, "2026-10-05", 200)).toBe(1);
    expect(waDailyNext({ day: "2026-10-05", count: 10 }, "2026-10-05", 200)).toBe(11);
    expect(waDailyNext({ day: "2026-10-05", count: 200 }, "2026-10-05", 200)).toBeNull();
    expect(waDailyNext({ day: "2026-10-04", count: 200 }, "2026-10-05", 200)).toBe(1);
  });
});

describe("queueWhatsAppSchema", () => {
  it("acepta un mensaje mínimo y pone valores por defecto", () => {
    const r = queueWhatsAppSchema.parse({ to: "+50499998888", body: " Hola " });
    expect(r).toMatchObject({ to: "+50499998888", body: "Hola", name: "", context: "mensaje" });
  });
  it("rechaza mensaje vacío o sin número", () => {
    expect(queueWhatsAppSchema.safeParse({ to: "+50499998888", body: "  " }).success).toBe(false);
    expect(queueWhatsAppSchema.safeParse({ to: "", body: "Hola" }).success).toBe(false);
  });
});
