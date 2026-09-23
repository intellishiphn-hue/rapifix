import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { catalogCol, col, MAINTENANCE_DUE_DAYS, MAINTENANCE_DUE_KM, opsCol, orderCol, quoteCol, type MaintenanceStatus } from "@rapifix/shared";
import { db } from "./admin";

const DAY = 86400000;

/** Próximo / vencido según fecha o kilometraje (lo que llegue primero). */
export function computeMaintenanceStatus(nextDateMs: number | null, nextMileage: number | null, currentMileage: number, now = Date.now()): MaintenanceStatus {
  const byDateOver = nextDateMs != null && nextDateMs < now;
  const byKmOver = nextMileage != null && currentMileage >= nextMileage;
  if (byDateOver || byKmOver) return "overdue";
  const byDateDue = nextDateMs != null && nextDateMs - now <= MAINTENANCE_DUE_DAYS * DAY;
  const byKmDue = nextMileage != null && nextMileage - currentMileage <= MAINTENANCE_DUE_KM;
  return byDateDue || byKmDue ? "due" : "upcoming";
}

export function nextFrom(lastMs: number | null, lastMileage: number, intervalDays: number, intervalKm: number) {
  return {
    nextDate: intervalDays > 0 && lastMs != null ? Timestamp.fromMillis(lastMs + intervalDays * DAY) : null,
    nextMileage: intervalKm > 0 ? lastMileage + intervalKm : null,
  };
}

/**
 * Al entregar una orden: por cada servicio aprobado que tenga intervalo (ej. cambio de aceite cada
 * 5,000 km o 90 días) crea o actualiza el mantenimiento del vehículo. Un registro por vehículo y servicio.
 */
export async function generateMaintenanceFromOrder(tid: string, orderId: string): Promise<number> {
  const order = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  if (!order.exists) return 0;
  const o = order.data()!;
  if (!o.vehicleId) return 0;
  const quotes = await db.collection(quoteCol.quotes(tid)).where("orderId", "==", orderId).where("status", "==", "approved").get();
  const serviceIds = new Set<string>();
  quotes.docs.forEach((q) => ((q.get("items") as Array<{ serviceId?: string | null }>) ?? []).forEach((it) => it.serviceId && serviceIds.add(it.serviceId)));
  if (!serviceIds.size) return 0;

  const [vehicle, ...services] = await Promise.all([
    db.doc(`${col.vehicles(tid)}/${o.vehicleId}`).get(),
    ...[...serviceIds].map((id) => db.doc(`${catalogCol.services(tid)}/${id}`).get()),
  ]);
  const deliveredMs = (o.deliveredAt as Timestamp | null)?.toMillis() ?? Date.now();
  const mileage = Number(o.mileageOut ?? o.reception?.mileageIn ?? vehicle.get("mileage") ?? 0);
  const currentMileage = Math.max(mileage, Number(vehicle.get("mileage") ?? 0));
  const batch = db.batch();
  let n = 0;
  for (const s of services) {
    if (!s.exists) continue;
    const intervalDays = Number(s.get("intervalDays") ?? 0);
    const intervalKm = Number(s.get("intervalKm") ?? 0);
    if (!intervalDays && !intervalKm) continue;
    const next = nextFrom(deliveredMs, mileage, intervalDays, intervalKm);
    const ref = db.doc(`${opsCol.maintenance(tid)}/${o.vehicleId}_${s.id}`);
    batch.set(ref, {
      vehicleId: o.vehicleId, customerId: o.customerId,
      customerName: o.customer?.fullName ?? "", phone: o.customer?.whatsapp || o.customer?.phone || "",
      vehicleLabel: `${o.vehicle?.make ?? ""} ${o.vehicle?.model ?? ""} ${o.vehicle?.year ?? ""}`.trim(), plate: o.vehicle?.plate ?? "",
      serviceId: s.id, serviceName: s.get("name"),
      lastDate: Timestamp.fromMillis(deliveredMs), lastMileage: mileage, intervalDays, intervalKm,
      ...next,
      status: computeMaintenanceStatus(next.nextDate?.toMillis() ?? null, next.nextMileage, currentMileage),
      source: "order", workOrderId: orderId, workOrderCode: o.code,
      reminderSentAt: null, appointmentId: null, notes: "", doneAt: null,
      createdAt: FieldValue.serverTimestamp(), createdBy: "system", updatedAt: FieldValue.serverTimestamp(), updatedBy: "system",
    });
    n++;
  }
  if (n) await batch.commit();
  return n;
}
