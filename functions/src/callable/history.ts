import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { col, HISTORY_TOKEN_LENGTH, historyLinkSchema, historyPath, PUBLIC_HISTORY, type HistoryLink, type Role } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { secureToken } from "../lib/token";
import { buildHistory, ownerRef, type HistoryOwner } from "../lib/history";

/**
 * "Mi historial RAPIFIX" (docs/HISTORIAL.md): activar, regenerar y desactivar el link privado
 * de un cliente o de una empresa. El link no vence; se puede apagar o cambiar desde el panel.
 * Solo administración, gerencia y recepción (el historial muestra montos y pagos).
 */
const HISTORY_MANAGERS: Role[] = ["admin", "manager", "reception"];

type Action = "enable" | "regenerate" | "disable";
const NOTES: Record<Action, string> = {
  enable: "Activó el link del historial para el cliente",
  regenerate: "Cambió el link del historial (el anterior dejó de funcionar)",
  disable: "Desactivó el link del historial",
};

async function changeLink(request: CallableRequest<unknown>, action: Action) {
  const caller = requireRole(request, HISTORY_MANAGERS);
  const input = parseInput(historyLinkSchema, request.data);
  const tid = caller.tid;
  const owner: HistoryOwner = { kind: input.kind, id: input.id };
  const ref = ownerRef(tid, owner);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", owner.kind === "company" ? "La empresa no existe." : "El cliente no existe.");
    const prev = (snap.get("history") as HistoryLink | undefined) ?? null;
    const oldToken = prev?.token ?? null;
    // Activar un link que ya está activo devuelve el mismo (no se cambia el que el cliente ya tiene)
    if (action === "enable" && prev?.enabled && oldToken) return { token: oldToken, changed: false };

    const token = action === "disable" ? null : secureToken(HISTORY_TOKEN_LENGTH);
    if (oldToken && oldToken !== token) tx.delete(db.doc(`${PUBLIC_HISTORY}/${oldToken}`));
    const next = {
      token,
      enabled: action !== "disable",
      createdAt: token ? FieldValue.serverTimestamp() : (snap.get("history.createdAt") ?? null),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    };
    tx.update(ref, { history: next });
    tx.set(db.collection(col.auditLogs(tid)).doc(), {
      action: "update", entity: owner.kind === "company" ? "companies" : "customers", entityId: owner.id, path: ref.path,
      actorId: caller.uid, actorType: "user",
      // Sin el token: el registro solo dice si quedó activo
      before: { history: { enabled: !!prev?.enabled } }, after: { history: { enabled: next.enabled } },
      changedFields: ["history"], note: NOTES[action],
      at: FieldValue.serverTimestamp(),
    });
    return { token, changed: true };
  });

  // Se construye de inmediato (no se espera a un trigger)
  if (result.token) {
    const built = await buildHistory(tid, owner);
    if (!built) throw new HttpsError("aborted", "El link cambió mientras se preparaba. Intente de nuevo.");
  }
  return { token: result.token, path: result.token ? historyPath(result.token) : null, enabled: !!result.token };
}

export const enableHistoryLink = onCall({ region: REGION }, (request) => changeLink(request, "enable"));
export const regenerateHistoryLink = onCall({ region: REGION }, (request) => changeLink(request, "regenerate"));
export const disableHistoryLink = onCall({ region: REGION }, (request) => changeLink(request, "disable"));
