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
