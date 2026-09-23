import { useMemo } from "react";
import { collection, orderBy, query, Timestamp, where, type QueryConstraint } from "firebase/firestore";
import {
  EMPLOYEE_COLORS, opsCol,
  type Appointment, type AppointmentStatus, type AppointmentType, type EmployeeProfile, type SaveAppointmentInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { useStaffDirectory } from "@/features/work-orders/api";

export const saveAppointment = callable<SaveAppointmentInput, { appointmentId: string }>("saveAppointment");
export const setAppointmentStatus = callable<{ appointmentId: string; status: AppointmentStatus }, { ok: boolean }>("setAppointmentStatus");

const appointmentsCol = () => collection(db, opsCol.appointments(TENANT_ID));

/** Citas con inicio en [fromMs, toMs). Filtro opcional por técnico (índice technicianId + start). */
export function useAppointments(fromMs: number, toMs: number, technicianId: string | null) {
  const c: QueryConstraint[] = [];
  if (technicianId) c.push(where("technicianId", "==", technicianId));
  c.push(where("start", ">=", Timestamp.fromMillis(fromMs)), where("start", "<", Timestamp.fromMillis(toMs)), orderBy("start"));
  return useQueryData<Appointment>(query(appointmentsCol(), ...c), `appointments|${fromMs}|${toMs}|${technicianId ?? "all"}`);
}

/** Personal activo con su color de agenda. */
export function useAgendaStaff() {
  const staff = useStaffDirectory();
  const employees = useQueryData<EmployeeProfile>(query(collection(db, opsCol.employees(TENANT_ID))), "employees-profiles");
  return useMemo(() => {
    const profiles = new Map(employees.data.map((e) => [e.id, e]));
    const active = staff.active;
    const colors = new Map<string, string>();
    active.forEach((s, i) => colors.set(s.id, profiles.get(s.id)?.color || EMPLOYEE_COLORS[i % EMPLOYEE_COLORS.length]!));
    // Técnicos para asignar; si no hay usuarios con ese rol, todo el personal activo
    const assignable = staff.technicians.length ? staff.technicians : active;
    return {
      loading: staff.loading,
      active,
      assignable,
      colorOf: (id: string | null | undefined) => (id && colors.get(id)) || "#64748b",
    };
  }, [staff.active, staff.technicians, staff.loading, employees.data]);
}

export interface AppointmentPreset {
  type?: AppointmentType;
  start?: number;
  durationMin?: number;
  customerId?: string | null;
  customerName?: string;
  phone?: string;
  vehicleId?: string | null;
  vehicleLabel?: string;
  plate?: string;
  workOrderId?: string | null;
  workOrderCode?: string | null;
  maintenanceId?: string | null;
  technicianId?: string | null;
  notes?: string;
}

export const STATUS_TONE: Record<AppointmentStatus, "gray" | "blue" | "green" | "amber" | "red"> = {
  scheduled: "amber",
  confirmed: "blue",
  done: "green",
  no_show: "red",
  cancelled: "gray",
};
