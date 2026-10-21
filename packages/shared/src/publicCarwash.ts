import { VEHICLE_SIZES, type CarwashPlan, type CarwashService, type CarwashSettings, type VehicleSize } from "./carwash";

/**
 * Copia pública del carwash para la página /lavado (publicCarwash/{tid}).
 * Solo campos que se pueden mostrar: sin precios, costos, comisiones ni datos de clientes.
 * La regenera el servidor cuando cambian los servicios, los planes o la configuración del carwash.
 */
export const PUBLIC_CARWASH = "publicCarwash";

export interface PublicCarwashService {
  id: string;
  name: string;
  description: string;
  kind: "wash" | "extra";
  /** tipos de vehículo para los que el servicio tiene tarifa (fija o a convenir) */
  sizes: VehicleSize[];
  /** tipos de vehículo cuyo precio es a convenir (requiere evaluación) */
  quoteSizes: VehicleSize[];
}

export interface PublicCarwashPlan {
  id: string;
  name: string;
  size: VehicleSize;
  /** null = ilimitado */
  washesPerMonth: number | null;
  includedNames: string[];
}

export interface PublicCarwash {
  services: PublicCarwashService[];
  plans: PublicCarwashPlan[];
  /** every = cada cuántos lavados pagados se gana uno (0 = programa desactivado) */
  loyalty: { every: number; startStamps: number };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function buildPublicCarwash(services: CarwashService[], plans: CarwashPlan[], settings: Pick<CarwashSettings, "loyaltyEvery" | "loyaltyStartStamps">): PublicCarwash {
  const active = services.filter((s) => s.active === true).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || str(a.name, 80).localeCompare(str(b.name, 80)));
  const names = new Map(services.map((s) => [s.id, str(s.name, 80)]));
  const activeIds = new Set(active.map((s) => s.id));
  return {
    services: active
      .map((s) => {
        const prices = (s.prices ?? {}) as Partial<Record<VehicleSize, number | null>>;
        const sizes = VEHICLE_SIZES.filter((z) => z in prices && (prices[z] === null || (typeof prices[z] === "number" && (prices[z] as number) >= 0)));
        return {
          id: s.id,
          name: str(s.name, 80),
          description: str(s.description, 400),
          kind: s.kind === "extra" ? ("extra" as const) : ("wash" as const),
          sizes,
          quoteSizes: sizes.filter((z) => prices[z] === null),
        };
      })
      .filter((s) => s.name),
    plans: plans
      .filter((p) => p.active === true && (VEHICLE_SIZES as readonly string[]).includes(p.size))
      .sort((a, b) => VEHICLE_SIZES.indexOf(a.size) - VEHICLE_SIZES.indexOf(b.size) || str(a.name, 80).localeCompare(str(b.name, 80)))
      .map((p) => ({
        id: p.id,
        name: str(p.name, 80),
        size: p.size,
        washesPerMonth: typeof p.washesPerMonth === "number" && p.washesPerMonth > 0 ? Math.floor(p.washesPerMonth) : null,
        includedNames: (p.includedServiceIds ?? []).filter((id) => activeIds.has(id)).map((id) => names.get(id) ?? "").filter(Boolean),
      }))
      .filter((p) => p.name),
    loyalty: {
      every: Math.max(0, Math.floor(Number(settings.loyaltyEvery) || 0)),
      startStamps: Math.max(0, Math.floor(Number(settings.loyaltyStartStamps) || 0)),
    },
  };
}
