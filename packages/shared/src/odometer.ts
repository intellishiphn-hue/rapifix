import { z } from "zod";

/**
 * Unidad del odómetro. La mayoría de carros marca kilómetros; los traídos de EE. UU.
 * suelen marcar millas. Las lecturas se guardan tal como las marca el odómetro, en la
 * unidad del vehículo. Los cálculos internos (intervalos, km por día) siguen en km.
 */
export const ODOMETER_UNITS = ["km", "mi"] as const;
export type OdometerUnit = (typeof ODOMETER_UNITS)[number];
export const ODOMETER_UNIT_LABELS: Record<OdometerUnit, string> = { km: "Kilómetros", mi: "Millas" };
export const KM_PER_MILE = 1.609344;

/** Documentos viejos no tienen unidad: se toman como km. */
export const odometerUnitSchema = z.enum(ODOMETER_UNITS);

export function normalizeUnit(unit: unknown): OdometerUnit {
  return unit === "mi" ? "mi" : "km";
}

/** Convierte una lectura a km (sin redondear). */
export function toKm(value: number, unit?: OdometerUnit | null): number {
  return normalizeUnit(unit) === "mi" ? value * KM_PER_MILE : value;
}

/** Convierte km a la unidad indicada (sin redondear). */
export function fromKm(km: number, unit?: OdometerUnit | null): number {
  return normalizeUnit(unit) === "mi" ? km / KM_PER_MILE : km;
}

/** Convierte una lectura entre unidades, redondeada a entero. */
export function convertOdometer(value: number, from?: OdometerUnit | null, to?: OdometerUnit | null): number {
  if (normalizeUnit(from) === normalizeUnit(to)) return Math.round(value);
  return Math.round(fromKm(toKm(value, from), to));
}

/** "45,200 km" / "28,100 mi" */
export function formatOdometer(value: number | null | undefined, unit?: OdometerUnit | null): string {
  return `${new Intl.NumberFormat("es-HN").format(Math.round(Number(value ?? 0)))} ${normalizeUnit(unit)}`;
}

/** "Kilometraje" o "Millaje" según la unidad. */
export function odometerNoun(unit?: OdometerUnit | null): string {
  return normalizeUnit(unit) === "mi" ? "Millaje" : "Kilometraje";
}

/** Etiqueta de campo: "Kilometraje (km)" / "Millaje (mi)". */
export function odometerFieldLabel(unit?: OdometerUnit | null, suffix = ""): string {
  const u = normalizeUnit(unit);
  return `${odometerNoun(u)}${suffix ? ` ${suffix}` : ""} (${u})`;
}

/** true si la nueva lectura es menor que la anterior (compara en km si cambió la unidad). */
export function isOdometerLower(value: number, unit: OdometerUnit | null | undefined, previous: number, previousUnit: OdometerUnit | null | undefined): boolean {
  if (normalizeUnit(unit) === normalizeUnit(previousUnit)) return value < previous;
  return toKm(value, unit) < toKm(previous, previousUnit) - 0.5;
}

/** Un intervalo configurado en km expresado en la unidad del vehículo, redondeado. */
export function intervalInUnit(intervalKm: number, unit?: OdometerUnit | null): number {
  return Math.round(fromKm(intervalKm, unit));
}

/**
 * Próximo servicio en la unidad del vehículo: lectura del último servicio + intervalo (en km)
 * convertido. Ej. 28,100 mi + 5,000 km (3,107 mi) = 31,207 mi. null si no hay intervalo.
 */
export function nextServiceReading(lastReading: number, unit: OdometerUnit | null | undefined, intervalKm: number): number | null {
  if (!intervalKm || intervalKm <= 0) return null;
  return Math.round(lastReading + fromKm(intervalKm, unit));
}
