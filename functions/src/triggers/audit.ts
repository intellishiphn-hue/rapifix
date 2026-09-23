import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { col } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";

/** Colecciones auditadas. Se amplía en cada fase (órdenes, pagos, inventario...). */
const AUDITED = new Set(["customers", "vehicles", "settings"]);

/** Campos mantenidos por el sistema: sus cambios solos no generan registro. */
const SYSTEM_FIELDS = new Set([
  "vehicleCount", "photoCount", "openOrders", "balanceDue", "lastVisitAt",
  "searchKeywords", "updatedAt", "updatedBy", "customer",
]);

function strip(data: Record<string, unknown> | undefined | null) {
  if (!data) return null;
  const { searchKeywords: _k, ...rest } = data;
  return rest;
}

function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
}

/**
 * Registro de auditoría a prueba de manipulación: lo escribe el servidor y
 * las reglas prohíben que cualquier usuario lo edite o borre.
 */
export const auditWriter = onDocumentWrittenWithAuthContext(
  { document: "tenants/{tid}/{collection}/{docId}", region: REGION },
  async (event) => {
    const { tid, collection, docId } = event.params;
    if (!AUDITED.has(collection)) return;

    const before = strip(event.data?.before.data());
    const after = strip(event.data?.after.data());
    const action = !before ? "create" : !after ? "delete" : "update";
    const fields = changedFields(before, after);
    if (action === "update" && fields.every((f) => SYSTEM_FIELDS.has(f))) return;

    await db.collection(col.auditLogs(tid)).add({
      action,
      entity: collection,
      entityId: docId,
      path: event.document,
      actorId: event.authId ?? (after?.updatedBy as string | undefined) ?? null,
      actorType: event.authType ?? "unknown",
      before,
      after,
      changedFields: fields.filter((f) => !SYSTEM_FIELDS.has(f) || f === "customer"),
      at: FieldValue.serverTimestamp(),
    });
  },
);
