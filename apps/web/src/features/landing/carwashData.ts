/**
 * Lee la copia pública del carwash (publicCarwash/{tid}) con la API REST de Firestore.
 * Así la página /lavado no carga el SDK de Firestore. El documento es de solo lectura pública
 * (ver firestore.rules) y no tiene precios ni datos de clientes.
 */
import { DEFAULT_TENANT_ID, PUBLIC_CARWASH, type PublicCarwash, type PublicCarwashPlan, type PublicCarwashService, type VehicleSize, VEHICLE_SIZES } from "@rapifix/shared";

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};

/** Convierte el formato de valores de la API REST a JSON simple */
export function decodeFs(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue?.values ?? []).map(decodeFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, decodeFs(x)]));
  return undefined;
}

const isSize = (s: unknown): s is VehicleSize => typeof s === "string" && (VEHICLE_SIZES as readonly string[]).includes(s);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Valida y limpia el documento (nunca confía en la forma del JSON) */
export function parsePublicCarwash(raw: unknown): PublicCarwash {
  const d = (raw ?? {}) as Record<string, unknown>;
  const services: PublicCarwashService[] = (Array.isArray(d.services) ? d.services : [])
    .map((x) => x as Record<string, unknown>)
    .map((s) => ({
      id: text(s.id, 80),
      name: text(s.name, 80),
      description: text(s.description, 400),
      kind: s.kind === "extra" ? ("extra" as const) : ("wash" as const),
      sizes: (Array.isArray(s.sizes) ? s.sizes : []).filter(isSize),
      quoteSizes: (Array.isArray(s.quoteSizes) ? s.quoteSizes : []).filter(isSize),
    }))
    .filter((s) => s.name);
  const plans: PublicCarwashPlan[] = (Array.isArray(d.plans) ? d.plans : [])
    .map((x) => x as Record<string, unknown>)
    .filter((p) => isSize(p.size))
    .map((p) => ({
      id: text(p.id, 80),
      name: text(p.name, 80),
      size: p.size as VehicleSize,
      washesPerMonth: typeof p.washesPerMonth === "number" && p.washesPerMonth > 0 ? Math.floor(p.washesPerMonth) : null,
      includedNames: (Array.isArray(p.includedNames) ? p.includedNames : []).map((n) => text(n, 80)).filter(Boolean),
    }))
    .filter((p) => p.name);
  const l = (d.loyalty ?? {}) as Record<string, unknown>;
  return {
    services,
    plans,
    loyalty: { every: Math.max(0, Math.floor(Number(l.every) || 0)), startStamps: Math.max(0, Math.floor(Number(l.startStamps) || 0)) },
  };
}

export function publicCarwashUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const tid = (import.meta.env.VITE_TENANT_ID as string | undefined) || DEFAULT_TENANT_ID;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${PUBLIC_CARWASH}/${tid}`;
}

export type CarwashLoad = { state: "loading" } | { state: "ready"; data: PublicCarwash } | { state: "empty" } | { state: "error" };

export async function loadPublicCarwash(signal?: AbortSignal): Promise<CarwashLoad> {
  try {
    const res = await fetch(publicCarwashUrl(), { signal, headers: { Accept: "application/json" } });
    // 404: el documento aún no se publica (nadie ha guardado el menú desde el panel)
    if (res.status === 404) return { state: "empty" };
    if (!res.ok) return { state: "error" };
    const json = (await res.json()) as { fields?: Record<string, FsValue> };
    const data = parsePublicCarwash(decodeFs({ mapValue: { fields: json.fields ?? {} } }));
    return { state: "ready", data };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { state: "loading" };
    return { state: "error" };
  }
}
