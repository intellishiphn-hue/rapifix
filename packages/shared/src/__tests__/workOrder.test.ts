import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition } from "../workOrderStatus";
import { diagnosisSchema, generateToken, TOKEN_ALPHABET } from "../workOrder";
import { renderTemplate } from "../templates";

describe("cambio de estado libre", () => {
  it("técnico puede elegir cualquier estado de trabajo", () => {
    expect(canTransition("technician", "RECEIVED", "IN_REPAIR")).toBe(true);
    expect(canTransition("technician", "IN_REPAIR", "DIAGNOSIS")).toBe(true);
    expect(canTransition("technician", "QUALITY_CONTROL", "READY")).toBe(true);
  });
  it("técnico no entrega ni cancela", () => {
    expect(canTransition("technician", "READY", "DELIVERED")).toBe(false);
    expect(canTransition("technician", "RECEIVED", "CANCELLED")).toBe(false);
  });
  it("recepción entrega pero no reabre", () => {
    expect(canTransition("reception", "READY", "DELIVERED")).toBe(true);
    expect(canTransition("reception", "DELIVERED", "IN_REPAIR")).toBe(false);
    expect(canTransition("manager", "CANCELLED", "RECEIVED")).toBe(true);
  });
  it("vendedor no cambia estados", () => expect(allowedTransitions("seller", "RECEIVED")).toEqual([]));
  it("no incluye el estado actual", () => expect(allowedTransitions("admin", "RECEIVED")).not.toContain("RECEIVED"));
});

describe("utilidades de orden", () => {
  it("token de 10 caracteres sin confusos", () => {
    const t = generateToken();
    expect(t).toHaveLength(10);
    expect([...t].every((c) => TOKEN_ALPHABET.includes(c))).toBe(true);
    expect(t).not.toMatch(/[01OIL]/);
  });
  it("valida códigos OBD", () => {
    const base = { reportedProblem: "", technicianDiagnosis: "", recommendations: "", observations: "", testsPerformed: "" };
    expect(diagnosisSchema.safeParse({ ...base, obdCodes: ["p0300"] }).success).toBe(true);
    expect(diagnosisSchema.safeParse({ ...base, obdCodes: ["X123"] }).success).toBe(false);
  });
  it("renderiza plantillas y quita variables vacías", () => {
    expect(renderTemplate("Hola {{cliente}}, su {{vehiculo}} está listo. {{link}}", { cliente: "Juan", vehiculo: "Corolla" })).toBe("Hola Juan, su Corolla está listo.");
  });
});

import { changeStatusSchema } from "../workOrder";
describe("cambio de estado", () => {
  it("acepta note y mileageOut en null (así los envía Firebase)", () => {
    expect(changeStatusSchema.safeParse({ orderId: "x", toStatus: "IN_REPAIR", note: null, mileageOut: null }).success).toBe(true);
  });
});

describe("plantillas con link", () => {
  it("incluye el link cuando existe", () => {
    expect(renderTemplate("Hola {{cliente}}. Avance: {{link}}", { cliente: "Ana", link: "https://x/orden/ABC" })).toBe("Hola Ana. Avance: https://x/orden/ABC");
  });
  it("quita la frase del link cuando no existe", () => {
    expect(renderTemplate("Hola {{cliente}}, listo. Puede ver los detalles aquí: {{link}}", { cliente: "Ana" })).toBe("Hola Ana, listo.");
  });
});

import { DEFAULT_TEMPLATES } from "../templates";
describe("mensaje de cotización con el formato de RAPIFIX", () => {
  it("coincide con el ejemplo", () => {
    const t = DEFAULT_TEMPLATES.find((x) => x.key === "cotizacion_enviada")!;
    const msg = renderTemplate(t.body, { cliente: "SERGIO", vehiculo: "Toyota PRADO 2026", orden: "OT-1002", total: "L 1,955.00", link: "https://rapifix-prod-a1b2c.web.app/orden/TTW66KVJ6F", taller: "RAPIFIX" });
    expect(msg).toBe("¡Hola SERGIO! 🏁\n\nLe enviamos la cotización de su vehículo: *Toyota PRADO 2026*\n(Orden OT-1002)\n\n*El total es de L 1,955.00*\n\nPuede revisarla y aprobarla aquí: https://rapifix-prod-a1b2c.web.app/orden/TTW66KVJ6F\n\nGracias por su preferencia en *RAPIFIX* 🚗");
  });
  it("sin link quita la línea completa", () => {
    const t = DEFAULT_TEMPLATES.find((x) => x.key === "reparacion")!;
    const msg = renderTemplate(t.body, { cliente: "Ana", vehiculo: "Kia Rio", orden: "OT-1", taller: "RAPIFIX" });
    expect(msg).not.toContain("aquí");
    expect(msg).not.toMatch(/\n\n\n/);
  });
});

import { whatsappLink } from "../phone";
describe("link de WhatsApp", () => {
  it("usa api.whatsapp.com y codifica emojis en UTF-8", () => {
    const url = whatsappLink("+50499998888", "Hola 🏁");
    expect(url).toBe("https://api.whatsapp.com/send?phone=50499998888&text=Hola%20%F0%9F%8F%81");
  });
});
