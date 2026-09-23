import type { Role } from "./roles";

/**
 * Timestamp genérico: en el cliente es firebase/firestore Timestamp y en Functions es
 * firebase-admin Timestamp. Ambos exponen toDate() y toMillis().
 */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
}

export interface BaseDoc {
  id: string;
  createdAt: TimestampLike;
  createdBy: string;
  updatedAt: TimestampLike;
  updatedBy: string;
}

export interface UserProfile {
  id: string; // uid
  displayName: string;
  email: string;
  phone?: string;
  tid: string;
  role: Role;
  active: boolean;
  claimsUpdatedAt?: TimestampLike;
  createdAt?: TimestampLike;
  lastLoginAt?: TimestampLike;
}

export type CustomerStatus = "active" | "inactive";

export interface Customer extends BaseDoc {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string; // E.164 +504...
  whatsapp: string; // E.164
  email: string;
  idNumber: string; // identidad
  rtn: string;
  address: string;
  city: string;
  notes: string;
  status: CustomerStatus;
  vehicleCount: number; // mantenido por Cloud Functions
  openOrders: number; // Fase 2
  balanceDue: number; // centavos, Fase 4
  lastVisitAt?: TimestampLike | null;
  searchKeywords: string[];
}

export const FUEL_TYPES = ["gasolina", "diesel", "hibrido", "electrico", "gas"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const FUEL_LABELS: Record<FuelType, string> = {
  gasolina: "Gasolina",
  diesel: "Diésel",
  hibrido: "Híbrido",
  electrico: "Eléctrico",
  gas: "Gas (GLP)",
};

export const TRANSMISSIONS = ["automatica", "manual", "cvt", "otra"] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];
export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  automatica: "Automática",
  manual: "Manual",
  cvt: "CVT",
  otra: "Otra",
};

export interface Vehicle extends BaseDoc {
  customerId: string;
  customer: { fullName: string; phone: string };
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string; // normalizada ABC123
  vin: string;
  mileage: number;
  mileageUpdatedAt?: TimestampLike | null;
  fuelType: FuelType;
  engine: string;
  transmission: Transmission;
  notes: string;
  coverPhotoUrl: string;
  photoCount: number;
  archived: boolean;
  searchKeywords: string[];
}

export interface MileageEntry {
  id: string;
  mileage: number;
  source: "manual" | "reception" | "delivery";
  note: string;
  at: TimestampLike;
  by: string;
  byName: string;
}

export interface VehiclePhoto {
  id: string;
  url: string;
  storagePath: string;
  caption: string;
  at: TimestampLike;
  by: string;
  byName: string;
}

export interface WorkshopSettings {
  name: string;
  subtitle: string;
  legalName: string;
  rtn: string;
  address: string;
  city: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  hours: string;
  logoUrl: string;
  currency: "HNL" | "USD";
  taxRate: number; // porcentaje, ej 15
  workOrderPrefix: string; // OT
  quotePrefix: string; // COT
  /** Kilómetros que maneja un cliente al mes cuando no hay historial (para estimar mantenimientos) */
  avgKmPerMonth: number;
  /** Cada cuántos km se recomienda el cambio de aceite (detección automática) */
  oilChangeKm: number;
  updatedAt?: TimestampLike;
  updatedBy?: string;
}

export const DEFAULT_SETTINGS: WorkshopSettings = {
  name: "RAPIFIX",
  subtitle: "Sistema de Gestión para Taller Automotriz",
  legalName: "",
  rtn: "",
  address: "",
  city: "Tegucigalpa",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  hours: "Lunes a viernes 7:30 AM a 5:30 PM, sábado 8:00 AM a 12:00 PM",
  logoUrl: "",
  currency: "HNL",
  taxRate: 15,
  workOrderPrefix: "OT",
  quotePrefix: "COT",
  avgKmPerMonth: 1500,
  oilChangeKm: 5000,
};

export interface AuditLog {
  id: string;
  action: "create" | "update" | "delete";
  entity: string;
  entityId: string;
  path: string;
  actorId: string | null;
  actorType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  at: TimestampLike;
}
