import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const id = z.string().min(1).max(128);

// ---------------- Agenda ----------------
export const APPOINTMENT_TYPES = ["appointment", "reception", "diagnosis", "delivery", "maintenance", "other"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  appointment: "Cita",
  reception: "Recepción de vehículo",
  diagnosis: "Diagnóstico",
  delivery: "Entrega",
  maintenance: "Mantenimiento",
  other: "Otro",
};
export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "done", "no_show", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  done: "Atendida",
  no_show: "No se presentó",
  cancelled: "Cancelada",
};

export interface Appointment extends BaseDoc {
  type: AppointmentType;
  status: AppointmentStatus;
  start: TimestampLike;
  end: TimestampLike;
  durationMin: number;
  /** "YYYY-MM-DD" en hora de Honduras, para consultas por día */
  dayKey: string;
  customerId: string | null;
  customerName: string;
  phone: string;
  vehicleId: string | null;
  vehicleLabel: string;
  plate: string;
  workOrderId: string | null;
  workOrderCode: string | null;
  maintenanceId: string | null;
  technicianId: string | null;
  technicianName: string;
  notes: string;
}

export const saveAppointmentSchema = z.object({
  appointmentId: id.nullish(),
  type: z.enum(APPOINTMENT_TYPES),
  /** epoch ms */
  start: z.number().int().min(0),
  durationMin: z.number().int().min(10, "Mínimo 10 minutos").max(12 * 60),
  customerId: id.nullish(),
  /** para clientes que aún no están registrados */
  customerName: text(120),
  phone: text(30),
  vehicleId: id.nullish(),
  workOrderId: id.nullish(),
  maintenanceId: id.nullish(),
  technicianId: id.nullish(),
  notes: text(1000),
});
export type SaveAppointmentInput = z.infer<typeof saveAppointmentSchema>;

export const appointmentStatusSchema = z.object({
  appointmentId: id,
  status: z.enum(APPOINTMENT_STATUSES),
});

// ---------------- Mantenimiento ----------------
export const MAINTENANCE_STATUSES = ["upcoming", "due", "overdue", "done", "cancelled"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  upcoming: "Programado",
  due: "Próximo",
  overdue: "Vencido",
  done: "Realizado",
  cancelled: "Descartado",
};
/** Se considera "próximo" cuando faltan estos días o kilómetros */
export const MAINTENANCE_DUE_DAYS = 15;
export const MAINTENANCE_DUE_KM = 500;

export interface Maintenance extends BaseDoc {
  vehicleId: string;
  customerId: string;
  customerName: string;
  phone: string;
  vehicleLabel: string;
  plate: string;
  serviceId: string | null;
  serviceName: string;
  lastDate: TimestampLike | null;
  lastMileage: number;
  intervalDays: number; // 0 = no aplica
  intervalKm: number; // 0 = no aplica
  nextDate: TimestampLike | null;
  nextMileage: number | null;
  status: MaintenanceStatus;
  source: "order" | "manual";
  workOrderId: string | null;
  workOrderCode: string | null;
  reminderSentAt: TimestampLike | null;
  appointmentId: string | null;
  notes: string;
  doneAt: TimestampLike | null;
}

export const saveMaintenanceSchema = z.object({
  maintenanceId: id.nullish(),
  vehicleId: id,
  serviceId: id.nullish(),
  serviceName: text(120).min(2, "Indique el servicio"),
  /** epoch ms, fecha del último servicio */
  lastDate: z.number().int().min(0).nullish(),
  lastMileage: z.number().int().min(0).max(5_000_000),
  intervalDays: z.number().int().min(0).max(3650),
  intervalKm: z.number().int().min(0).max(500_000),
  notes: text(500),
}).refine((v) => v.intervalDays > 0 || v.intervalKm > 0, { message: "Indique cada cuántos días o kilómetros" });
export type SaveMaintenanceInput = z.infer<typeof saveMaintenanceSchema>;

export const maintenanceActionSchema = z.object({
  maintenanceId: id,
  action: z.enum(["done", "cancel", "reminder_sent", "reopen"]),
});

// ---------------- Personal / técnicos ----------------
export interface EmployeeProfile {
  id: string; // uid del usuario
  displayName: string;
  role: string;
  phone: string;
  specialty: string;
  color: string; // color en la agenda
  active: boolean;
  updatedAt?: TimestampLike;
}

export const EMPLOYEE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777"] as const;

export const saveEmployeeSchema = z.object({
  uid: id,
  phone: text(30),
  specialty: text(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido"),
});

/** "YYYY-MM-DD" en hora de Honduras (UTC-6, sin horario de verano). */
export function hnDayKey(d: Date | number): string {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms - 6 * 3600 * 1000).toISOString().slice(0, 10);
}
