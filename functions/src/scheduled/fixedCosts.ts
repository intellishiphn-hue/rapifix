import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { col } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { ensureFixedCostsForMonth, hnCurrentMonth } from "../lib/fixedCosts";

/**
 * Todos los días a las 12:20 AM (Honduras): asegura que los gastos fijos del mes actual estén generados
 * como gastos pendientes. Es idempotente: si ya existen no los toca (así el día 1 de cada mes aparecen solos).
 */
export const dailyFixedCosts = onSchedule({ region: REGION, schedule: "20 0 * * *", timeZone: "America/Tegucigalpa" }, async () => {
  const month = hnCurrentMonth();
  const tenants = await db.collection(col.tenants).listDocuments();
  for (const t of tenants) {
    try {
      const r = await ensureFixedCostsForMonth(t.id, month);
      if (r.created) logger.info("Gastos fijos generados", { tid: t.id, month, ...r });
    } catch (err) {
      logger.error("No se pudieron generar los gastos fijos", { tid: t.id, month, err: String(err) });
    }
  }
});
