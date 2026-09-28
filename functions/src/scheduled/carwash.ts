import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { carwashCol, col } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";

/**
 * Todos los días a las 6:20 AM (Honduras): marca como vencidas las membresías del carwash
 * cuya fecha pagada ya pasó. (El panel también las calcula como vencidas al leerlas.)
 */
export const carwashDaily = onSchedule({ region: REGION, schedule: "20 6 * * *", timeZone: "America/Tegucigalpa" }, async () => {
  const tenants = await db.collection(col.tenants).listDocuments();
  const now = Timestamp.now().toMillis();
  for (const t of tenants) {
    const snap = await db.collection(carwashCol.memberships(t.id)).where("status", "==", "active").get();
    const expired = snap.docs.filter((d) => {
      const until = d.get("paidUntil");
      return until instanceof Timestamp && until.toMillis() <= now;
    });
    for (let i = 0; i < expired.length; i += 400) {
      const batch = db.batch();
      expired.slice(i, i + 400).forEach((d) => batch.update(d.ref, { status: "expired", updatedAt: FieldValue.serverTimestamp() }));
      await batch.commit();
    }
    if (expired.length) logger.info("Membresías del carwash vencidas", { tid: t.id, n: expired.length });
  }
});
