import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  catalogCol, col, DEFAULT_SETTINGS, evaluateMaintenanceReading, nextServiceReading, normalizeUnit, opsCol, orderCol, quoteCol,
  toKm, type OdometerUnit,
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
 * Las lecturas en millas se convierten a km; las viejas sin unidad se toman en la unidad del vehículo.
 */
export async function vehicleKmPerDay(
  tid: string, vehicleId: string, fallback: number, vehicleUnit?: OdometerUnit | null,
): Promise<{ kmPerDay: number; source: "history" | "default" }> {
  const log = await db.collection(col.mileageLog(tid, vehicleId)).orderBy("at", "desc").limit(20).get();
  const pts = log.docs
    .map((d) => ({
      km: toKm(Number(d.get("mileage") ?? 0), normalizeUnit(d.get("unit") ?? vehicleUnit)),
      at: (d.get("at") as Timestamp | null)?.toMillis() ?? 0,
    }))
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
  unit: OdometerUnit;
  atMs: number;
}

/**
 * Estado del mantenimiento: toca por fecha o por distancia, lo que llegue primero.
 * Los cálculos van en km; `nextMileage` y el resultado `estimatedMileage` en la unidad del mantenimiento.
 */
export function evaluateMaintenance(
  m: { nextDateMs: number | null; nextMileage: number | null; unit?: OdometerUnit | null },
  reading: VehicleReading,
  kmPerDay: number,
  now = Date.now(),
) {
  const r = evaluateMaintenanceReading(m, reading, kmPerDay, now);
  return { status: r.status, estimatedMileage: r.estimatedMileage, dueDate: r.dueMs != null ? Timestamp.fromMillis(Math.round(r.dueMs)) : null };
}

/** Próxima fecha y lectura. `lastMileage` y `nextMileage` en la unidad del vehículo; `intervalKm` en km. */
export function nextFrom(lastMs: number | null, lastMileage: number, intervalDays: number, intervalKm: number, unit?: OdometerUnit | null) {
  return {
    nextDate: intervalDays > 0 && lastMs != null ? Timestamp.fromMillis(lastMs + intervalDays * DAY) : null,
    nextMileage: nextServiceReading(lastMileage, unit, intervalKm),
  };
}

/** Última lectura conocida del vehículo (la mayor entre el vehículo y el último servicio, comparada en km). */
export function readingOf(
  vehicle: FirebaseFirestore.DocumentData | undefined, lastMileage: number, lastMs: number | null, lastUnit?: OdometerUnit | null,
): VehicleReading {
  const vUnit = normalizeUnit(vehicle?.odometerUnit);
  const vKm = Number(vehicle?.mileage ?? 0);
  const vAt = (vehicle?.mileageUpdatedAt as Timestamp | null | undefined)?.toMillis() ?? 0;
  if (toKm(vKm, vUnit) >= toKm(lastMileage, lastUnit) - 0.5 && vAt) return { mileage: vKm, unit: vUnit, atMs: vAt };
  return { mileage: lastMileage, unit: normalizeUnit(lastUnit), atMs: lastMs ?? Date.now() };
}

/** Campos calculados que se guardan en el mantenimiento. */
export async function computeFields(
  tid: string,
  vehicleId: string,
  vehicle: FirebaseFirestore.DocumentData | undefined,
  m: { lastMs: number | null; lastMileage: number; nextDate: Timestamp | null; nextMileage: number | null; unit?: OdometerUnit | null },
  defaults: MaintenanceDefaults,
  rateCache?: Map<string, { kmPerDay: number; source: "history" | "default" }>,
) {
  let rate = rateCache?.get(vehicleId);
  if (!rate) {
    rate = await vehicleKmPerDay(tid, vehicleId, defaults.kmPerDay, normalizeUnit(vehicle?.odometerUnit));
    rateCache?.set(vehicleId, rate);
  }
  const ev = evaluateMaintenance(
    { nextDateMs: m.nextDate?.toMillis() ?? null, nextMileage: m.nextMileage, unit: m.unit },
    readingOf(vehicle, m.lastMileage, m.lastMs, m.unit),
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
  // La lectura de la orden va en la unidad de la orden (órdenes viejas: km); si no hay, la del vehículo
  const fromOrder = o.mileageOut ?? o.reception?.mileageIn;
  const mileage = Number(fromOrder ?? vehicle.get("mileage") ?? 0);
  const unit: OdometerUnit = normalizeUnit(fromOrder != null ? o.mileageUnit : vehicle.get("odometerUnit"));
  const batch = db.batch();
  let n = 0;
  for (const p of plans) {
    const ref = db.doc(`${opsCol.maintenance(tid)}/${o.vehicleId}_${p.key}`);
    const existing = await ref.get();
    // No retroceder: si ya hay un registro de un servicio más reciente, se deja
    const prevLast = (existing.get("lastDate") as Timestamp | null)?.toMillis() ?? 0;
    if (existing.exists && prevLast > deliveredMs) continue;
    const next = nextFrom(deliveredMs, mileage, p.intervalDays, p.intervalKm, unit);
    const calc = await computeFields(tid, o.vehicleId, vehicle.data(), { lastMs: deliveredMs, lastMileage: mileage, unit, ...next }, cfg);
    batch.set(ref, {
      vehicleId: o.vehicleId, customerId: o.customerId,
      customerName: o.customer?.fullName ?? "", phone: o.customer?.whatsapp || o.customer?.phone || "",
      vehicleLabel: `${o.vehicle?.make ?? ""} ${o.vehicle?.model ?? ""} ${o.vehicle?.year ?? ""}`.trim(), plate: o.vehicle?.plate ?? "",
      serviceId: p.serviceId, serviceName: p.name,
      lastDate: Timestamp.fromMillis(deliveredMs), lastMileage: mileage, odometerUnit: unit, intervalDays: p.intervalDays, intervalKm: p.intervalKm,
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
