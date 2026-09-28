import { describe, expect, it } from "vitest";
import { isPlaceholderPlate, saveWashSchema } from "../carwash";

describe("carwash: placas marcador (sin placa real)", () => {
  it("reconoce los marcadores comunes, con cualquier formato", () => {
    for (const p of [
      "PENDIENTE", "pendiente", " Pendiente ", "PEND", "Pendient", "SIN PLACA", "sin-placa", "S/P", "SP", "N/A", "NA",
      "NO TIENE", "ninguna", "NO PLACA", "TEMP", "Temporal", "PROVISIONAL", "XXX", "xx", "XXXXXXX", "0", "000", "0000000",
      "", "   ", "-", "A", "7", "S/N", "SN", "SIN NUMERO", "POR CONFIRMAR", "NUEVO", "nueva", "AGENCIA",
    ]) {
      expect(isPlaceholderPlate(p), p).toBe(true);
    }
  });

  it("un marcador con número para distinguirlos sigue siendo marcador", () => {
    for (const p of ["PENDIENTE 2", "PENDIENTE-10", "TEMP01", "SINPLACA3", "NUEVO 1"]) expect(isPlaceholderPlate(p), p).toBe(true);
  });

  it("las placas reales no son marcador", () => {
    for (const p of ["HAB1234", "PCD 1234", "P-123-ABC", "hab-1234", "XAB1234", "TEM1234", "PEN1234", "NA1234", "SP12", "AB", "M1234567", "0001ABC"]) {
      expect(isPlaceholderPlate(p), p).toBe(false);
    }
  });

  it("el registro acepta el marcador como placa (se registra, pero no suma sellos)", () => {
    const r = saveWashSchema.safeParse({
      plate: "Pendiente", size: "turismo", customerName: "Juan", phone: "", items: [{ serviceId: "s1" }], notes: "", useReward: false, useMembership: false,
    });
    expect(r.success).toBe(true);
    expect(r.success && isPlaceholderPlate(r.data.plate)).toBe(true);
  });
});
