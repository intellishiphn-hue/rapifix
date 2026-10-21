import { describe, expect, it } from "vitest";
import {
  availableSlots, bookableDays, hnSlotMs, hnTime, isBookable, publicAppointmentSchema, reasonForCategory, slotOf, slotsForDay, weekdayOf, webPhone,
} from "../index";

// Martes 20 de octubre de 2026, 10:00 en Honduras
const NOW = hnSlotMs("2026-10-20", "10:00");

describe("horario de citas web", () => {
  it("días de la semana", () => {
    expect(weekdayOf("2026-10-25")).toBe(0); // domingo
    expect(weekdayOf("2026-10-24")).toBe(6); // sábado
  });
  it("lunes a viernes: 08:00 a 16:00 (último bloque 1 hora antes del cierre)", () => {
    const s = slotsForDay("2026-10-21");
    expect(s[0]).toBe("08:00");
    expect(s.at(-1)).toBe("16:00");
    expect(s).toHaveLength(17);
  });
  it("sábado: 08:00 a 14:00", () => {
    const s = slotsForDay("2026-10-24");
    expect(s.at(-1)).toBe("14:00");
    expect(s).toHaveLength(13);
  });
  it("domingo cerrado", () => {
    expect(slotsForDay("2026-10-25")).toEqual([]);
  });
  it("solo desde mañana y hasta 30 días, sin domingos", () => {
    const days = bookableDays(NOW);
    expect(days[0]).toBe("2026-10-21");
    expect(days).not.toContain("2026-10-20");
    expect(days.at(-1)! <= "2026-11-19").toBe(true);
    expect(days.every((d) => weekdayOf(d) !== 0)).toBe(true);
    expect(isBookable("2026-10-20", "15:00", NOW)).toBe(false);
    expect(isBookable("2026-11-20", "09:00", NOW)).toBe(false);
    expect(isBookable("2026-10-21", "16:30", NOW)).toBe(false);
    expect(isBookable("2026-10-21", "16:00", NOW)).toBe(true);
  });
  it("capacidad por bloque", () => {
    const s = availableSlots("2026-10-21", { "08:00": 2, "08:30": 1 }, NOW);
    expect(s).not.toContain("08:00");
    expect(s).toContain("08:30");
    expect(availableSlots("2026-10-21", { "08:30": 1 }, NOW, 1)).not.toContain("08:30");
    expect(availableSlots("2026-10-25", {}, NOW)).toEqual([]);
  });
  it("hora de Honduras y bloque de una hora cualquiera", () => {
    const ms = hnSlotMs("2026-10-21", "09:40");
    expect(hnTime(ms)).toBe("09:40");
    expect(slotOf(ms)).toBe("09:30");
    expect(new Date(hnSlotMs("2026-10-21", "08:00")).toISOString()).toBe("2026-10-21T14:00:00.000Z");
  });
});

describe("formulario de cita web", () => {
  const base = { name: "Ana López", phone: "9285-4852", reason: "frenos", date: "2026-10-21", time: "09:00" };
  it("acepta datos válidos y normaliza el teléfono a +504", () => {
    const r = publicAppointmentSchema.parse(base);
    expect(r.comment).toBe("");
    expect(webPhone(r.phone)).toBe("+50492854852");
  });
  it("rechaza teléfono inválido, comentario largo, campos extra y el campo trampa", () => {
    expect(publicAppointmentSchema.safeParse({ ...base, phone: "123" }).success).toBe(false);
    expect(publicAppointmentSchema.safeParse({ ...base, comment: "x".repeat(501) }).success).toBe(false);
    expect(publicAppointmentSchema.safeParse({ ...base, admin: true }).success).toBe(false);
    expect(publicAppointmentSchema.safeParse({ ...base, website: "spam" }).success).toBe(false);
    expect(publicAppointmentSchema.safeParse({ ...base, reason: "hackeo" }).success).toBe(false);
    expect(publicAppointmentSchema.safeParse({ ...base, time: "9:00" }).success).toBe(false);
  });
  it("teléfono internacional", () => {
    expect(publicAppointmentSchema.safeParse({ ...base, phone: "+1 305 555 0123" }).success).toBe(true);
  });
  it("categoría del catálogo a motivo", () => {
    expect(reasonForCategory("frenos")).toBe("frenos");
    expect(reasonForCategory("suspension")).toBe("otro");
  });
});
