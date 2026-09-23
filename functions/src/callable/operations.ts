import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  appointmentStatusSchema, col, hnDayKey, maintenanceActionSchema, opsCol, orderCol, saveAppointmentSchema,
  saveEmployeeSchema, saveMaintenanceSchema, type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { computeMaintenanceStatus, nextFrom } from "../lib/maintenance";

const AGENDA: Role[] = ["admin", "manager", "reception"];

/** Crea o edita una cita. Si se indica vehículo u orden, completa los datos del cliente desde ahí. */
export const saveAppointment = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, AGENDA);
  const input = parseInput(saveAppointmentSchema, request.data);
  const tid = caller.tid;

  const [vehicle, order, tech] = await Promise.all([
    input.vehicleId ? db.doc(`${col.vehicles(tid)}/${input.vehicleId}`).get() : null,
    input.workOrderId ? db.doc(`${orderCol.workOrders(tid)}/${input.workOrderId}`).get() : null,
    input.technicianId ? db.doc(`${orderCol.staff(tid)}/${input.technicianId}`).get() : null,
  ]);
  if (vehicle && !vehicle.exists) throw new HttpsError("not-found", "El vehículo no existe.");
  if (order && !order.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (tech && (!tech.exists || tech.get("active") === false)) throw new HttpsError("invalid-argument", "El técnico no existe o está desactivado.");

  const customerId = input.customerId ?? (vehicle?.get("customerId") as string | undefined) ?? (order?.get("customerId") as string | undefined) ?? null;
  const customer = customerId ? await db.doc(`${col.customers(tid)}/${customerId}`).get() : null;
  const v = vehicle?.exists ? vehicle.data()! : order?.exists ? order.get("vehicle") : null;
  const customerName = input.customerName || (customer?.exists ? `${customer.get("firstName")} ${customer.get("lastName")}` : "") || (order?.get("customer.fullName") as string) || "";
  if (!customerName) throw new HttpsError("invalid-argument", "Indique el cliente.");

  const start = input.start;
  const doc = {
    type: input.type,
    start: Timestamp.fromMillis(start),
    end: Timestamp.fromMillis(start + input.durationMin * 60000),
    durationMin: input.durationMin,
    dayKey: hnDayKey(start),
    customerId, customerName,
    phone: input.phone || (customer?.get("whatsapp") as string) || (customer?.get("phone") as string) || "",
    vehicleId: input.vehicleId ?? (order?.get("vehicleId") as string | undefined) ?? null,
    vehicleLabel: v ? `${v.make ?? ""} ${v.model ?? ""} ${v.year ?? ""}`.trim() : "",
    plate: v?.plate ?? "",
    workOrderId: input.workOrderId ?? null,
    workOrderCode: order?.exists ? (order.get("code") as string) : null,
    maintenanceId: input.maintenanceId ?? null,
    technicianId: input.technicianId ?? null,
    technicianName: tech?.exists ? (tech.get("displayName") as string) : "",
    notes: input.notes,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  };

  if (input.appointmentId) {
    const ref = db.doc(`${opsCol.appointments(tid)}/${input.appointmentId}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "La cita no existe.");
    await ref.update(doc);
    return { appointmentId: ref.id };
  }
  const ref = db.collection(opsCol.appointments(tid)).doc();
  await ref.set({ ...doc, status: "scheduled", createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  if (input.maintenanceId) {
    await db.doc(`${opsCol.maintenance(tid)}/${input.maintenanceId}`).update({ appointmentId: ref.id, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  }
  return { appointmentId: ref.id };
});

export const setAppointmentStatus = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, AGENDA);
  const input = parseInput(appointmentStatusSchema, request.data);
  const ref = db.doc(`${opsCol.appointments(caller.tid)}/${input.appointmentId}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "La cita no existe.");
  await ref.update({ status: input.status, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  return { ok: true };
});

/** Mantenimiento manual (o edición de uno existente). */
export const saveMaintenance = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, AGENDA);
  const input = parseInput(saveMaintenanceSchema, request.data);
  const tid = caller.tid;
  const vehicle = await db.doc(`${col.vehicles(tid)}/${input.vehicleId}`).get();
  if (!vehicle.exists) throw new HttpsError("not-found", "El vehículo no existe.");
  const v = vehicle.data()!;
  const customer = await db.doc(`${col.customers(tid)}/${v.customerId}`).get();
  const lastMs = input.lastDate ?? Date.now();
  const next = nextFrom(lastMs, input.lastMileage, input.intervalDays, input.intervalKm);
  const currentMileage = Math.max(Number(v.mileage ?? 0), input.lastMileage);
  const data = {
    vehicleId: vehicle.id, customerId: v.customerId,
    customerName: customer.exists ? `${customer.get("firstName")} ${customer.get("lastName")}` : (v.ownerName ?? ""),
    phone: customer.exists ? ((customer.get("whatsapp") as string) || (customer.get("phone") as string) || "") : "",
    vehicleLabel: `${v.make} ${v.model} ${v.year ?? ""}`.trim(), plate: v.plate,
    serviceId: input.serviceId ?? null, serviceName: input.serviceName,
    lastDate: Timestamp.fromMillis(lastMs), lastMileage: input.lastMileage,
    intervalDays: input.intervalDays, intervalKm: input.intervalKm, ...next,
    status: computeMaintenanceStatus(next.nextDate?.toMillis() ?? null, next.nextMileage, currentMileage),
    notes: input.notes, doneAt: null,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };
  const ref = input.maintenanceId
    ? db.doc(`${opsCol.maintenance(tid)}/${input.maintenanceId}`)
    : input.serviceId ? db.doc(`${opsCol.maintenance(tid)}/${vehicle.id}_${input.serviceId}`) : db.collection(opsCol.maintenance(tid)).doc();
  const existing = await ref.get();
  if (existing.exists) await ref.update(data);
  else await ref.set({ ...data, source: "manual", workOrderId: null, workOrderCode: null, reminderSentAt: null, appointmentId: null, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  return { maintenanceId: ref.id };
});

export const maintenanceAction = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, AGENDA);
  const input = parseInput(maintenanceActionSchema, request.data);
  const tid = caller.tid;
  const ref = db.doc(`${opsCol.maintenance(tid)}/${input.maintenanceId}`);
  const m = await ref.get();
  if (!m.exists) throw new HttpsError("not-found", "El mantenimiento no existe.");
  const base = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
  if (input.action === "reminder_sent") await ref.update({ ...base, reminderSentAt: FieldValue.serverTimestamp() });
  if (input.action === "cancel") await ref.update({ ...base, status: "cancelled" });
  if (input.action === "done") await ref.update({ ...base, status: "done", doneAt: FieldValue.serverTimestamp() });
  if (input.action === "reopen") {
    const v = await db.doc(`${col.vehicles(tid)}/${m.get("vehicleId")}`).get();
    const status = computeMaintenanceStatus((m.get("nextDate") as Timestamp | null)?.toMillis() ?? null, m.get("nextMileage") ?? null, Number(v.get("mileage") ?? 0));
    await ref.update({ ...base, status, doneAt: null });
  }
  return { ok: true };
});

/** Datos del técnico o empleado (teléfono, especialidad, color en la agenda). */
export const saveEmployeeProfile = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(saveEmployeeSchema, request.data);
  const staff = await db.doc(`${orderCol.staff(caller.tid)}/${input.uid}`).get();
  if (!staff.exists) throw new HttpsError("not-found", "El usuario no existe.");
  await db.doc(`${opsCol.employees(caller.tid)}/${input.uid}`).set({
    phone: input.phone, specialty: input.specialty, color: input.color,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  }, { merge: true });
  return { ok: true };
});
