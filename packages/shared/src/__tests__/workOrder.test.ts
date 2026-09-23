import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition } from "../workOrderStatus";
import { diagnosisSchema, generateToken, TOKEN_ALPHABET } from "../workOrder";
import { renderTemplate } from "../templates";

describe("máquina de estados", () => {
  it("técnico puede pasar de aprobado a reparación", () => expect(canTransition("technician", "APPROVED", "IN_REPAIR")).toBe(true));
  it("técnico no puede entregar", () => expect(canTransition("technician", "READY", "DELIVERED")).toBe(false));
  it("técnico no puede cancelar", () => expect(canTransition("technician", "RECEIVED", "CANCELLED")).toBe(false));
  it("recepción entrega pero no reabre canceladas", () => {
    expect(canTransition("reception", "READY", "DELIVERED")).toBe(true);
    expect(canTransition("reception", "CANCELLED", "RECEIVED")).toBe(false);
    expect(canTransition("manager", "CANCELLED", "RECEIVED")).toBe(true);
  });
  it("entregado es final", () => expect(allowedTransitions("admin", "DELIVERED")).toEqual([]));
  it("no permite saltos fuera del flujo", () => expect(canTransition("admin", "RECEIVED", "READY")).toBe(false));
  it("vendedor no cambia estados", () => expect(allowedTransitions("seller", "RECEIVED")).toEqual([]));
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
