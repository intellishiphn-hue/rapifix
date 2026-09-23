import { z } from "zod";
import { isValidPhone } from "./phone";
import { FUEL_TYPES, TRANSMISSIONS } from "./types";
import { ROLES } from "./roles";

const trimmed = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Correo no válido");
const requiredPhone = z
  .string()
  .trim()
  .min(1, "El teléfono es obligatorio")
  .refine(isValidPhone, "Teléfono no válido (ej. 9999-8888)");
const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidPhone(v), "Teléfono no válido (ej. 9999-8888)");

export const customerSchema = z.object({
  firstName: trimmed(60).min(1, "El nombre es obligatorio"),
  lastName: trimmed(60).min(1, "El apellido es obligatorio"),
  phone: requiredPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  idNumber: trimmed(20),
  rtn: trimmed(20),
  address: trimmed(250),
  city: trimmed(60),
  notes: trimmed(1000),
  status: z.enum(["active", "inactive"]),
});
export type CustomerInput = z.infer<typeof customerSchema>;

const currentYear = new Date().getFullYear();

export const vehicleSchema = z.object({
  customerId: z.string().min(1, "Seleccione el cliente propietario"),
  make: trimmed(40).min(1, "La marca es obligatoria"),
  model: trimmed(60).min(1, "El modelo es obligatorio"),
  year: z
    .number({ error: "Año no válido" })
    .int("Año no válido")
    .min(1950, "Año no válido")
    .max(currentYear + 1, "Año no válido"),
  color: trimmed(30),
  plate: trimmed(12).min(2, "La placa es obligatoria"),
  vin: trimmed(20).refine((v) => v === "" || /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(v), "VIN no válido (11 a 17 caracteres, sin I, O ni Q)"),
  mileage: z.number({ error: "Kilometraje no válido" }).int().min(0, "Kilometraje no válido").max(2_000_000, "Kilometraje no válido"),
  fuelType: z.enum(FUEL_TYPES),
  engine: trimmed(40),
  transmission: z.enum(TRANSMISSIONS),
  notes: trimmed(1000),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const mileageEntrySchema = z.object({
  mileage: z.number({ error: "Kilometraje no válido" }).int().min(0).max(2_000_000),
  note: trimmed(200),
});

export const settingsSchema = z.object({
  name: trimmed(60).min(1, "El nombre es obligatorio"),
  subtitle: trimmed(100),
  legalName: trimmed(120),
  rtn: trimmed(20),
  address: trimmed(250),
  city: trimmed(60),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  website: trimmed(120),
  hours: trimmed(200),
  currency: z.enum(["HNL", "USD"]),
  taxRate: z.number({ error: "Porcentaje no válido" }).min(0).max(100),
  workOrderPrefix: trimmed(6).min(1, "Obligatorio").regex(/^[A-Z0-9-]+$/, "Solo mayúsculas y números"),
  quotePrefix: trimmed(6).min(1, "Obligatorio").regex(/^[A-Z0-9-]+$/, "Solo mayúsculas y números"),
  avgKmPerMonth: z.number({ error: "Kilómetros no válidos" }).int().min(100, "Mínimo 100 km").max(20000),
  oilChangeKm: z.number({ error: "Kilómetros no válidos" }).int().min(1000, "Mínimo 1,000 km").max(30000),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const createStaffUserSchema = z.object({
  displayName: trimmed(80).min(2, "El nombre es obligatorio"),
  email: z.string().trim().toLowerCase().refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Correo no válido"),
  password: z.string().min(8, "Mínimo 8 caracteres").max(64),
  role: z.enum(ROLES),
  phone: optionalPhone,
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

export const updateStaffUserSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  displayName: trimmed(80).min(2).optional(),
});
export type UpdateStaffUserInput = z.infer<typeof updateStaffUserSchema>;
