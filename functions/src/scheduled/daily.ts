import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { col, opsCol, quoteCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { computeFields, generateMaintenanceFromOrder, maintenanceDefaults } from "../lib/maintenance";
import { buildPortal, buildQuotePortal } from "../lib/portal";

/** Al pasar una orden a Entregado, programa los mantenimientos de sus servicios. */
export const onOrderDelivered = onDocumentUpdated({ document: "tenants/{tid}/workOrders/{orderId}", region: REGION }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || before?.status === after.status || after.status !== "DELIVERED") return;
  const n = await generateMaintenanceFromOrder(event.params.tid, event.params.orderId);
  if (n) logger.info("Mantenimientos programados", { orderId: event.params.orderId, n });
});

/**
 * Todos los días a las 6:00 AM (Honduras):
 * - actualiza el estado de los mantenimientos (programado → próximo → vencido) según fecha y kilometraje
 * - vence las cotizaciones enviadas cuya fecha de validez ya pasó
 */
export const dailyMaintenance = onSchedule({ region: REGION, schedule: "0 6 * * *", timeZone: "America/Tegucigalpa" }, async () => {
  const tenants = await db.collection(col.tenants).listDocuments();
  for (const t of tenants) {
    const tid = t.id;
    const changed = await refreshTenantMaintenance(tid);

    const expiredQuotes = await db.collection(quoteCol.quotes(tid)).where("status", "in", ["sent", "viewed"]).where("validUntil", "<", Timestamp.now()).get();
    for (const q of expiredQuotes.docs) {
      await q.ref.update({ status: "expired", updatedAt: FieldValue.serverTimestamp(), updatedBy: "system" });
      if (q.get("orderId")) await buildPortal(tid, q.get("orderId"));
      else await buildQuotePortal(tid, q.id);
    }
    logger.info("Revisión diaria", { tid, maintenanceChanged: changed, quotesExpired: expiredQuotes.size });
  }
});

/** Recalcula km estimados, fecha en que toca y estado de todos los mantenimientos abiertos. */
export async function refreshTenantMaintenance(tid: string): Promise<number> {
    const open = await db.collection(opsCol.maintenance(tid)).where("status", "in", ["upcoming", "due", "overdue"]).get();
    const defaults = await maintenanceDefaults(tid);
    const vehicleIds = [...new Set(open.docs.map((d) => d.get("vehicleId") as string))];
    const vehicles = new Map<string, FirebaseFirestore.DocumentData | undefined>();
    for (let i = 0; i < vehicleIds.length; i += 100) {
      const refs = vehicleIds.slice(i, i + 100).map((id) => db.doc(`${col.vehicles(tid)}/${id}`));
      if (refs.length) (await db.getAll(...refs)).forEach((v) => vehicles.set(v.id, v.data()));
    }
    const rates = new Map<string, { kmPerDay: number; source: "history" | "default" }>();
    let changed = 0;
    let batch = db.batch();
    for (const m of open.docs) {
      const vehicleId = m.get("vehicleId") as string;
      const calc = await computeFields(tid, vehicleId, vehicles.get(vehicleId), {
        lastMs: (m.get("lastDate") as Timestamp | null)?.toMillis() ?? null, lastMileage: Number(m.get("lastMileage") ?? 0),
        nextDate: (m.get("nextDate") as Timestamp | null) ?? null, nextMileage: m.get("nextMileage") ?? null,
      }, defaults, rates);
      batch.update(m.ref, { ...calc, updatedAt: FieldValue.serverTimestamp(), updatedBy: "system" });
      if (calc.status !== m.get("status")) changed++;
      if ((open.docs.indexOf(m) + 1) % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();
    return changed;
}
