import { logger } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { catalogCol, col, deleteWorkOrderSchema, opsCol, orderCol, quoteCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";

/**
 * Elimina una orden por completo (admin y gerencia): la orden, su historial, fotos, cotizaciones
 * y el link del cliente. Para no descuadrar la caja ni el inventario, no deja eliminar si tiene
 * pagos válidos (primero se anulan) o repuestos ya descontados del inventario (mejor cancelarla).
 * Queda un registro en la auditoría.
 */
export const deleteWorkOrder = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(deleteWorkOrderSchema, request.data);
  const tid = caller.tid;
  const ref = db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La orden no existe.");
  const o = snap.data()!;

  const payments = await db.collection(catalogCol.payments(tid)).where("orderId", "==", ref.id).where("status", "==", "valid").limit(1).get();
  if (!payments.empty) {
    throw new HttpsError("failed-precondition", "La orden tiene pagos registrados. Anúlelos primero en la pestaña Pagos (o cancele la orden en vez de eliminarla).");
  }
  if (Object.keys((o.consumed as Record<string, unknown>) ?? {}).length) {
    throw new HttpsError("failed-precondition", "Esta orden ya descontó repuestos del inventario. Cancélela en vez de eliminarla para no descuadrar el inventario.");
  }

  const name = await actorName(caller.uid, caller.email);
  const quotes = await db.collection(quoteCol.quotes(tid)).where("orderId", "==", ref.id).get();

  // Registro de auditoría (antes de borrar)
  await db.collection(col.auditLogs(tid)).add({
    action: "delete", entity: "workOrders", entityId: ref.id, path: ref.path,
    actorId: caller.uid, actorName: name,
    before: { code: o.code, status: o.status, customer: o.customer?.fullName ?? "", vehicle: `${o.vehicle?.make ?? ""} ${o.vehicle?.model ?? ""} ${o.vehicle?.plate ?? ""}`.trim(), total: o.totals?.total ?? 0 },
    after: null, changedFields: [], reason: input.reason, at: FieldValue.serverTimestamp(),
  });

  // Link del cliente, cotizaciones, citas que apuntaban a la orden
  if (o.portalToken) await db.doc(`${quoteCol.portal}/${o.portalToken}`).delete().catch(() => undefined);
  for (const q of quotes.docs) await q.ref.delete();
  const appts = await db.collection(opsCol.appointments(tid)).where("workOrderId", "==", ref.id).get();
  for (const a of appts.docs) await a.ref.update({ workOrderId: null, workOrderCode: null });

  // Orden con su historial y fotos (subcolecciones), y los archivos de las fotos
  await db.recursiveDelete(ref);
  try {
    await getStorage().bucket().deleteFiles({ prefix: `tenants/${tid}/workOrders/${ref.id}/` });
  } catch (err) {
    logger.warn("No se pudieron borrar las fotos de la orden", { orderId: ref.id, err: String(err) });
  }
  logger.info("Orden eliminada", { tid, orderId: ref.id, code: o.code, by: caller.uid });
  return { ok: true, code: o.code as string };
});
