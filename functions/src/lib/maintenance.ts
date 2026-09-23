import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  catalogCol, col, DEFAULT_SETTINGS, MAINTENANCE_DUE_DAYS, opsCol, orderCol, quoteCol, type MaintenanceStatus,
} from "@rapifix/shared";
import { db } from "./admin";

const DAY = 86400000;
/** Auto-detectado (sin servicio configurado): además de los km, a los 6 meses como máximo */
const OIL_MAX_DAYS = 180;
const OIL_RE = /aceite|lubric/i;

export interface MaintenanceDefaults {
  kmPerDay: number;
  oilChangeKm: number;
}

export async function maintenanceDefaults(tid: string): Promise<MaintenanceDefaults> {
  const s = await db.doc(`${col.settings(tid)}/general`).get();
  const perMonth = Number(s.get("avgKmPerMonth") ?? DEFAULT_SETTINGS.avgKmPerMonth) || DEFAULT_SETTINGS.avgKmPerMonth;
  return { kmPerDay: perMonth / 30, oilChangeKm: Number(s.get("oilChangeKm") ?? DEFAULT_SETTINGS.oilChangeKm) || DEFAULT_SETTINGS.oilChangeKm };
}

/**
 * Cuántos km maneja el vehículo al día, calculado con su historial de kilometraje
 * (recepciones y entregas). Si no hay suficiente historial, usa el promedio configurado.
 */
export async function vehicleKmPerDay(tid: string, vehicleId: string, fallback: number): Promise<{ kmPerDay: number; source: "history" | "default" }> {
  const log = await db.collection(col.mileageLog(tid, vehicleId)).orderBy("at", "desc").limit(20).get();
  const pts = log.docs
    .map((d) => ({ km: Number(d.get("mileage") ?? 0), at: (d.get("at") as Timestamp | null)?.toMillis() ?? 0 }))
    .filter((p) => p.km > 0 && p.at > 0);
  if (pts.length >= 2) {
    const newest = pts[0]!;
    const oldest = pts[pts.length - 1]!;
    const days = (newest.at - oldest.at) / DAY;
    const km = newest.km - oldest.km;
    if (days >= 20 && km > 0) return { kmPerDay: Math.min(300, Math.max(3, km / days)), source: "history" };
  }
  return { kmPerDay: fallback, source: "default" };
}

export interface VehicleReading {
  mileage: number;
  atMs: number;
}

/**
 * Estado del mantenimiento: toca por fecha o por kilómetros, lo que llegue primero.
 * Los km de hoy se estiman con lo que maneja el cliente desde la última lectura conocida.
 */
export function evaluateMaintenance(
  m: { nextDateMs: number | null; nextMileage: number | null },
  reading: VehicleReading,
  kmPerDay: number,
  now = Date.now(),
) {
  const estimatedMileage = Math.round(reading.mileage + kmPerDay * Math.max(0, (now - reading.atMs) / DAY));
  const kmDueMs = m.nextMileage != null && kmPerDay > 0
    ? reading.atMs + ((m.nextMileage - reading.mileage) / kmPerDay) * DAY
    : null;
  const candidates = [m.nextDateMs, kmDueMs].filter((x): x is number => x != null);
  const dueMs = candidates.length ? Math.min(...candidates) : null;
  let status: MaintenanceStatus = "upcoming";
  if (dueMs != null && dueMs < now) status = "overdue";
  else if (dueMs != null && dueMs - now <= MAINTENANCE_DUE_DAYS * DAY) status = "due";
  return { status, estimatedMileage, dueDate: dueMs != null ? Timestamp.fromMillis(Math.round(dueMs)) : null };
}

export function nextFrom(lastMs: number | null, lastMileage: number, intervalDays: number, intervalKm: number) {
  return {
    nextDate: intervalDays > 0 && lastMs != null ? Timestamp.fromMillis(lastMs + intervalDays * DAY) : null,
    nextMileage: intervalKm > 0 ? lastMileage + intervalKm : null,
  };
}

/** Última lectura conocida del vehículo (la mayor entre el vehículo y el último servicio). */
export function readingOf(vehicle: FirebaseFirestore.DocumentData | undefined, lastMileage: number, lastMs: number | null): VehicleReading {
  const vKm = Number(vehicle?.mileage ?? 0);
  const vAt = (vehicle?.mileageUpdatedAt as Timestamp | null | undefined)?.toMillis() ?? 0;
  if (vKm >= lastMileage && vAt) return { mileage: vKm, atMs: vAt };
  return { mileage: lastMileage, atMs: lastMs ?? Date.now() };
}

/** Campos calculados que se guardan en el mantenimiento. */
export async function computeFields(
  tid: string,
  vehicleId: string,
  vehicle: FirebaseFirestore.DocumentData | undefined,
  m: { lastMs: number | null; lastMileage: number; nextDate: Timestamp | null; nextMileage: number | null },
  defaults: MaintenanceDefaults,
  rateCache?: Map<string, { kmPerDay: number; source: "history" | "default" }>,
) {
  let rate = rateCache?.get(vehicleId);
  if (!rate) {
    rate = await vehicleKmPerDay(tid, vehicleId, defaults.kmPerDay);
    rateCache?.set(vehicleId, rate);
  }
  const ev = evaluateMaintenance(
    { nextDateMs: m.nextDate?.toMillis() ?? null, nextMileage: m.nextMileage },
    readingOf(vehicle, m.lastMileage, m.lastMs),
    rate.kmPerDay,
  );
  return { ...ev, kmPerDay: Math.round(rate.kmPerDay * 10) / 10, kmSource: rate.source };
}

/**
 * Al entregar una orden: por cada servicio aprobado con intervalo (ej. cambio de aceite cada 5,000 km)
 * crea o actualiza el mantenimiento del vehículo (un registro por vehículo y servicio).
 * Si la orden llevó aceite pero sin un servicio configurado, igual programa "Cambio de aceite".
 */
export async function generateMaintenanceFromOrder(tid: string, orderId: string, defaults?: MaintenanceDefaults): Promise<number> {
  const order = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  if (!order.exists) return 0;
  const o = order.data()!;
  if (!o.vehicleId || o.status !== "DELIVERED") return 0;
  const quotes = await db.collection(quoteCol.quotes(tid)).where("orderId", "==", orderId).where("status", "==", "approved").get();
  const items = quotes.docs.flatMap((q) => (q.get("items") as Array<{ serviceId?: string | null; description: string }>) ?? []);
  if (!items.length) return 0;
  const cfg = defaults ?? (await maintenanceDefaults(tid));

  const serviceIds = [...new Set(items.map((it) => it.serviceId).filter((x): x is string => !!x))];
  const [vehicle, ...services] = await Promise.all([
    db.doc(`${col.vehicles(tid)}/${o.vehicleId}`).get(),
    ...serviceIds.map((id) => db.doc(`${catalogCol.services(tid)}/${id}`).get()),
  ]);

  const plans: Array<{ key: string; serviceId: string | null; name: string; intervalDays: number; intervalKm: number }> = [];
  for (const s of services) {
    if (!s.exists) continue;
    const intervalDays = Number(s.get("intervalDays") ?? 0);
    const intervalKm = Number(s.get("intervalKm") ?? 0);
    if (intervalDays || intervalKm) plans.push({ key: s.id, serviceId: s.id, name: s.get("name"), intervalDays, intervalKm });
  }
  const oilCovered = plans.some((p) => OIL_RE.test(p.name));
  if (!oilCovered && items.some((it) => OIL_RE.test(it.description ?? ""))) {
    plans.push({ key: "aceite", serviceId: null, name: "Cambio de aceite", intervalDays: OIL_MAX_DAYS, intervalKm: cfg.oilChangeKm });
  }
  if (!plans.length) return 0;

  const deliveredMs = (o.deliveredAt as Timestamp | null)?.toMillis() ?? Date.now();
  const mileage = Number(o.mileageOut ?? o.reception?.mileageIn ?? vehicle.get("mileage") ?? 0);
  const batch = db.batch();
  let n = 0;
  for (const p of plans) {
    const ref = db.doc(`${opsCol.maintenance(tid)}/${o.vehicleId}_${p.key}`);
    const existing = await ref.get();
    // No retroceder: si ya hay un registro de un servicio más reciente, se deja
    const prevLast = (existing.get("lastDate") as Timestamp | null)?.toMillis() ?? 0;
    if (existing.exists && prevLast > deliveredMs) continue;
    const next = nextFrom(deliveredMs, mileage, p.intervalDays, p.intervalKm);
    const calc = await computeFields(tid, o.vehicleId, vehicle.data(), { lastMs: deliveredMs, lastMileage: mileage, ...next }, cfg);
    batch.set(ref, {
      vehicleId: o.vehicleId, customerId: o.customerId,
      customerName: o.customer?.fullName ?? "", phone: o.customer?.whatsapp || o.customer?.phone || "",
      vehicleLabel: `${o.vehicle?.make ?? ""} ${o.vehicle?.model ?? ""} ${o.vehicle?.year ?? ""}`.trim(), plate: o.vehicle?.plate ?? "",
      serviceId: p.serviceId, serviceName: p.name,
      lastDate: Timestamp.fromMillis(deliveredMs), lastMileage: mileage, intervalDays: p.intervalDays, intervalKm: p.intervalKm,
      ...next, ...calc,
      source: "order", workOrderId: orderId, workOrderCode: o.code,
      reminderSentAt: null, appointmentId: null, notes: "", doneAt: null,
      createdAt: existing.exists ? existing.get("createdAt") : FieldValue.serverTimestamp(), createdBy: "system",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: "system",
    });
    n++;
  }
  if (n) await batch.commit();
  return n;
}
