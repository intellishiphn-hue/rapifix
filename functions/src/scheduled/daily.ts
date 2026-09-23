import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { col, opsCol, quoteCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { computeMaintenanceStatus, generateMaintenanceFromOrder } from "../lib/maintenance";
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
    const open = await db.collection(opsCol.maintenance(tid)).where("status", "in", ["upcoming", "due", "overdue"]).get();
    const vehicleIds = [...new Set(open.docs.map((d) => d.get("vehicleId") as string))];
    const mileage = new Map<string, number>();
    for (let i = 0; i < vehicleIds.length; i += 100) {
      const refs = vehicleIds.slice(i, i + 100).map((id) => db.doc(`${col.vehicles(tid)}/${id}`));
      if (refs.length) (await db.getAll(...refs)).forEach((v) => mileage.set(v.id, Number(v.get("mileage") ?? 0)));
    }
    let changed = 0;
    let batch = db.batch();
    for (const m of open.docs) {
      const status = computeMaintenanceStatus((m.get("nextDate") as Timestamp | null)?.toMillis() ?? null, m.get("nextMileage") ?? null, mileage.get(m.get("vehicleId")) ?? 0);
      if (status === m.get("status")) continue;
      batch.update(m.ref, { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: "system" });
      if (++changed % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    await batch.commit();

    const expiredQuotes = await db.collection(quoteCol.quotes(tid)).where("status", "in", ["sent", "viewed"]).where("validUntil", "<", Timestamp.now()).get();
    for (const q of expiredQuotes.docs) {
      await q.ref.update({ status: "expired", updatedAt: FieldValue.serverTimestamp(), updatedBy: "system" });
      if (q.get("orderId")) await buildPortal(tid, q.get("orderId"));
      else await buildQuotePortal(tid, q.id);
    }
    logger.info("Revisión diaria", { tid, maintenanceChanged: changed, quotesExpired: expiredQuotes.size });
  }
});
