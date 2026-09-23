import { collection, limit, orderBy, query, where } from "firebase/firestore";
import {
  DEFAULT_TEMPLATES, opsCol, renderTemplate,
  type Maintenance, type MaintenanceStatus, type SaveMaintenanceInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { formatDate, formatKm, formatPlate } from "@/lib/format";

export const saveMaintenance = callable<SaveMaintenanceInput, { maintenanceId: string }>("saveMaintenance");
export const maintenanceAction = callable<{ maintenanceId: string; action: "done" | "cancel" | "reminder_sent" | "reopen" }, { ok: boolean }>("maintenanceAction");

const maintenanceCol = () => collection(db, opsCol.maintenance(TENANT_ID));

/** Índice status + nextDate. Con status null no consulta. */
export function useMaintenanceByStatus(status: MaintenanceStatus | null, max = 300) {
  return useQueryData<Maintenance>(
    status ? query(maintenanceCol(), where("status", "==", status), orderBy("nextDate"), limit(max)) : null,
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

/** Plantilla "mantenimiento" con el servicio y la fecha/km sugeridos. */
export function maintenanceMessage(m: Maintenance, taller: string): string {
  const t = DEFAULT_TEMPLATES.find((x) => x.key === "mantenimiento");
  const base = renderTemplate(t?.body ?? "", {
    cliente: m.customerName.split(" ")[0] || m.customerName,
    vehiculo: m.vehicleLabel,
    placa: formatPlate(m.plate),
    taller,
  });
  const when = [m.nextDate ? `el ${formatDate(m.nextDate)}` : "", m.nextMileage ? `a los ${formatKm(m.nextMileage)}` : ""].filter(Boolean).join(" o ");
  const detail = [`Servicio: *${m.serviceName}*`, when ? `${m.status === "overdue" ? "Le correspondía" : "Le corresponde"} ${when}.` : ""].filter(Boolean).join("\n");
  const marker = "¿Le agendamos";
  const i = base.indexOf(marker);
  return i >= 0 ? `${base.slice(0, i)}${detail}\n\n${base.slice(i)}` : `${base}\n\n${detail}`;
}
