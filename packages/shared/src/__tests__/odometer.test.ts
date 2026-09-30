import { describe, expect, it } from "vitest";
import {
  convertOdometer, evaluateMaintenanceReading, formatOdometer, fromKm, intervalInUnit, isOdometerLower,
  KM_PER_MILE, nextServiceReading, normalizeUnit, odometerFieldLabel, toKm, vehicleSchema,
} from "../index";

const DAY = 86_400_000;

describe("odómetro: conversión", () => {
  it("1 milla = 1.609344 km", () => {
    expect(KM_PER_MILE).toBe(1.609344);
    expect(toKm(1, "mi")).toBeCloseTo(1.609344, 6);
    expect(toKm(100, "km")).toBe(100);
    expect(fromKm(1.609344, "mi")).toBeCloseTo(1, 6);
  });
  it("sin unidad (documentos viejos) se toma como km", () => {
    expect(normalizeUnit(undefined)).toBe("km");
    expect(normalizeUnit(null)).toBe("km");
    expect(normalizeUnit("xx")).toBe("km");
    expect(toKm(500, null)).toBe(500);
  });
  it("convierte entre unidades redondeando", () => {
    expect(convertOdometer(10_000, "mi", "km")).toBe(16_093);
    expect(convertOdometer(16_093, "km", "mi")).toBe(10_000);
    expect(convertOdometer(45_200, "km", "km")).toBe(45_200);
  });
  it("formatea con la unidad", () => {
    expect(formatOdometer(45200, "km")).toBe("45,200 km");
    expect(formatOdometer(28100, "mi")).toBe("28,100 mi");
    expect(formatOdometer(1200, undefined)).toBe("1,200 km");
    expect(odometerFieldLabel("mi")).toBe("Millaje (mi)");
    expect(odometerFieldLabel("km", "de ingreso")).toBe("Kilometraje de ingreso (km)");
  });
  it("compara lecturas en la misma unidad o convirtiendo a km", () => {
    expect(isOdometerLower(100, "mi", 120, "mi")).toBe(true);
    expect(isOdometerLower(100, "mi", 150, "km")).toBe(false); // 100 mi = 160.9 km
    expect(isOdometerLower(100, "km", 100, "mi")).toBe(true);
  });
  it("el vehículo acepta la unidad y usa km por defecto", () => {
    const base = { customerId: "c1", make: "Ford", model: "F-150", year: 2018, color: "", plate: "HAA1234", vin: "", mileage: 28100, fuelType: "gasolina", engine: "", transmission: "automatica", notes: "" };
    expect(vehicleSchema.parse(base).odometerUnit).toBe("km");
    expect(vehicleSchema.parse({ ...base, odometerUnit: "mi" }).odometerUnit).toBe("mi");
    expect(vehicleSchema.safeParse({ ...base, odometerUnit: "yd" }).success).toBe(false);
  });
});

describe("odómetro: próximo servicio", () => {
  it("en km suma el intervalo tal cual", () => {
    expect(nextServiceReading(45_200, "km", 5_000)).toBe(50_200);
  });
  it("en millas convierte el intervalo (5,000 km = 3,107 mi)", () => {
    expect(intervalInUnit(5_000, "mi")).toBe(3_107);
    expect(nextServiceReading(28_100, "mi", 5_000)).toBe(31_207);
  });
  it("sin intervalo no hay próximo", () => {
    expect(nextServiceReading(28_100, "mi", 0)).toBeNull();
  });
  it("evalúa el estado de un mantenimiento en millas con km por día", () => {
    const now = Date.UTC(2026, 8, 1);
    // Leído hace 10 días en 28,100 mi; maneja 50 km/día (≈31 mi/día)
    const reading = { mileage: 28_100, unit: "mi" as const, atMs: now - 10 * DAY };
    const next = nextServiceReading(28_100, "mi", 5_000)!;
    const r = evaluateMaintenanceReading({ nextDateMs: null, nextMileage: next, unit: "mi" }, reading, 50, now);
    expect(r.estimatedMileage).toBe(Math.round(28_100 + (500 / KM_PER_MILE)));
    // 5,000 km a 50 km/día = 100 días desde la lectura: faltan 90
    expect(Math.round((r.dueMs! - now) / DAY)).toBe(90);
    expect(r.status).toBe("upcoming");
  });
  it("si la lectura del vehículo está en otra unidad que el mantenimiento, convierte", () => {
    const now = Date.UTC(2026, 8, 1);
    // Mantenimiento viejo en km (próximo a 50,000 km); el vehículo ahora marca millas: 31,000 mi = 49,890 km
    const r = evaluateMaintenanceReading({ nextDateMs: null, nextMileage: 50_000, unit: "km" }, { mileage: 31_000, unit: "mi", atMs: now }, 40, now);
    expect(r.estimatedMileage).toBe(49_890);
    expect(r.status).toBe("due");
  });
  it("vencido por fecha", () => {
    const now = Date.UTC(2026, 8, 1);
    const r = evaluateMaintenanceReading({ nextDateMs: now - DAY, nextMileage: null, unit: "mi" }, { mileage: 1000, unit: "mi", atMs: now }, 40, now);
    expect(r.status).toBe("overdue");
  });
});
