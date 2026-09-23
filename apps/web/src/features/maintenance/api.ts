import { collection, limit, orderBy, query, where } from "firebase/firestore";
import {
  opsCol, templateBody, renderTemplate,
  type Maintenance, type MaintenanceStatus, type SaveMaintenanceInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { formatDate, formatKm, formatPlate } from "@/lib/format";

export const saveMaintenance = callable<SaveMaintenanceInput, { maintenanceId: string }>("saveMaintenance");
export const maintenanceAction = callable<{ maintenanceId: string; action: "done" | "cancel" | "reminder_sent" | "reopen" }, { ok: boolean }>("maintenanceAction");

const maintenanceCol = () => collection(db, opsCol.maintenance(TENANT_ID));

/** Índice status + dueDate (fecha estimada en que toca). Con status null no consulta. */
export function useMaintenanceByStatus(status: MaintenanceStatus | null, max = 300) {
  return useQueryData<Maintenance>(
    status ? query(maintenanceCol(), where("status", "==", status), orderBy("dueDate"), limit(max)) : null,
    `maintenance|${status}|${max}`,
  );
}

/** Índice vehicleId + nextDate. */
export function useVehicleMaintenance(vehicleId: string | undefined, enabled = true) {
  return useQueryData<Maintenance>(
    vehicleId && enabled ? query(maintenanceCol(), where("vehicleId", "==", vehicleId), orderBy("nextDate"), limit(50)) : null,
    `vehicle-maintenance|${vehicleId}|${enabled}`,
  );
}

export const MAINT_TONE: Record<MaintenanceStatus, "gray" | "blue" | "green" | "amber" | "red"> = {
  upcoming: "blue",
  due: "amber",
  overdue: "red",
  done: "green",
  cancelled: "gray",
};

/** "15 ene 2027 o 85,000 km" */
export function nextLabel(m: Maintenance): string {
  return [m.nextDate ? formatDate(m.nextDate) : "", m.nextMileage ? formatKm(m.nextMileage) : ""].filter(Boolean).join(" o ");
}

/** "Toca aprox. 12 dic 2026 · hoy ≈ 84,300 km" (estimado con lo que maneja el cliente) */
export function estimateLabel(m: Maintenance): string {
  const parts = [m.dueDate ? `Toca aprox. ${formatDate(m.dueDate)}` : "", m.nextMileage && m.estimatedMileage ? `hoy ≈ ${formatKm(m.estimatedMileage)}` : ""];
  return parts.filter(Boolean).join(" · ");
}

/** Plantilla "mantenimiento" con el servicio y el último servicio registrado. */
export function maintenanceMessage(m: Maintenance, taller: string): string {
    const service = /^cambio de aceite/i.test(m.serviceName) ? "su cambio de aceite" : m.serviceName.charAt(0).toLowerCase() + m.serviceName.slice(1);
  const last = [m.lastDate ? `el ${formatDate(m.lastDate)}` : "", m.lastMileage ? `a los ${formatKm(m.lastMileage)}` : ""].filter(Boolean).join(" ");
  return renderTemplate(templateBody("mantenimiento"), {
    cliente: m.customerName.split(" ")[0] || m.customerName,
    vehiculo: m.vehicleLabel,
    placa: formatPlate(m.plate),
    servicio: service,
    ultimo: last ? `Su último servicio con nosotros fue ${last}.` : "",
    taller,
  });
}

/** Pendientes de avisar: próximos o vencidos sin recordatorio en los últimos 30 días. */
export function needsReminder(m: Maintenance, now = Date.now()): boolean {
  if (m.status !== "due" && m.status !== "overdue") return false;
  if (!m.phone) return false;
  const sent = m.reminderSentAt?.toMillis?.() ?? 0;
  return now - sent > 30 * 86400000;
}

export const backfillMaintenance = callable<Record<string, never>, { orders: number; maintenance: number }>("backfillMaintenance");
