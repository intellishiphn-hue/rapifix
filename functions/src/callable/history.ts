import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import {
  col, companyCol, HISTORY_TOKEN_LENGTH, historyBulkSchema, historyLinkSchema, historyLinkState, historyPath, PUBLIC_HISTORY, VISIT_DETAILS_V,
  type HistoryBulkResult, type HistoryLink, type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { secureToken } from "../lib/token";
import { buildHistory, deleteVisitDetails, enableHistoryFor, hasHistoryActivity, ownerRef, type HistoryOwner } from "../lib/history";

/**
 * "Mi historial RAPIFIX" (docs/HISTORIAL.md): activar, regenerar y desactivar el link privado
 * de un cliente o de una empresa. El link no vence; se puede apagar o cambiar desde el panel.
 * Solo administración, gerencia y recepción (el historial muestra montos y pagos).
 */
const HISTORY_MANAGERS: Role[] = ["admin", "manager", "reception"];

type Action = "regenerate" | "disable";
const NOTES: Record<Action, string> = {
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
    const token = action === "disable" ? null : secureToken(HISTORY_TOKEN_LENGTH);
    if (oldToken && oldToken !== token) tx.delete(db.doc(`${PUBLIC_HISTORY}/${oldToken}`));
    const next = {
      token,
      enabled: action !== "disable",
      source: prev?.source ?? "manual",
      createdAt: token ? FieldValue.serverTimestamp() : (snap.get("history.createdAt") ?? null),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
      // Desactivado a propósito: la activación automática ya no lo vuelve a encender
      disabledAt: action === "disable" ? FieldValue.serverTimestamp() : null,
      disabledBy: action === "disable" ? caller.uid : null,
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
    return { token, oldToken };
  });

  // Los detalles de visita del token viejo se borran (el link anterior deja de funcionar del todo)
  await deleteVisitDetails(result.oldToken);
  // Se construye de inmediato (no se espera a un trigger)
  if (result.token) {
    const built = await buildHistory(tid, owner, { full: true });
    if (!built) throw new HttpsError("aborted", "El link cambió mientras se preparaba. Intente de nuevo.");
  }
  return { token: result.token, path: result.token ? historyPath(result.token) : null, enabled: !!result.token };
}

export const enableHistoryLink = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, HISTORY_MANAGERS);
  const input = parseInput(historyLinkSchema, request.data);
  const owner: HistoryOwner = { kind: input.kind, id: input.id };
  const r = await enableHistoryFor(caller.tid, owner, "manual", caller.uid);
  if (!r.token) throw new HttpsError("not-found", owner.kind === "company" ? "La empresa no existe." : "El cliente no existe.");
  // Ya estaba activo: se asegura que el documento exista (no cambia el link que el cliente ya tiene)
  if (!r.changed) await buildHistory(caller.tid, owner);
  return { token: r.token, path: historyPath(r.token), enabled: true };
});
export const regenerateHistoryLink = onCall({ region: REGION }, (request) => changeLink(request, "regenerate"));
export const disableHistoryLink = onCall({ region: REGION }, (request) => changeLink(request, "disable"));

/**
 * "Activar historial a todos" (Clientes o Empresas). Solo administración y gerencia.
 * Activa a los que NUNCA lo tuvieron y tienen al menos una orden o un lavado; no toca a los desactivados
 * a propósito. A los ya activos que aún no tenían el detalle de visitas se los completa.
 * Trabaja por páginas (orden por id) y se detiene antes del tiempo límite: devuelve un cursor y el panel
 * vuelve a llamar hasta que `done` sea true. No envía mensajes.
 */
const BULK_PAGE = 50;
const BULK_BUDGET_MS = 75_000;
export const enableHistoryLinksBulk = onCall({ region: REGION, timeoutSeconds: 120, memory: "512MiB" }, async (request): Promise<HistoryBulkResult> => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(historyBulkSchema, request.data);
  const tid = caller.tid;
  const started = Date.now();
  const path = input.kind === "company" ? companyCol.companies(tid) : col.customers(tid);
  let q = db.collection(path).orderBy(FieldPath.documentId()).limit(BULK_PAGE);
  if (input.cursor) q = q.startAfter(input.cursor);
  const [page, total] = await Promise.all([
    q.get(),
    input.cursor ? Promise.resolve(null) : db.collection(path).count().get().then((c) => c.data().count),
  ]);

  // Ya activos: ¿su historial ya tiene el detalle de visitas?
  const activeTokens = page.docs.map((d) => d.get("history") as HistoryLink | undefined).filter((h) => historyLinkState(h) === "active").map((h) => h!.token!);
  const withDetails = new Set<string>();
  for (let i = 0; i < activeTokens.length; i += 30) {
    const snap = await db.collection(PUBLIC_HISTORY).where(FieldPath.documentId(), "in", activeTokens.slice(i, i + 30)).select("detailsV").get();
    for (const d of snap.docs) if (d.get("detailsV") === VISIT_DETAILS_V) withDetails.add(d.id);
  }

  const out: HistoryBulkResult = { activated: 0, upgraded: 0, scanned: 0, skippedDisabled: 0, noActivity: 0, total, cursor: null, done: false };
  let last: string | null = input.cursor ?? null;
  let stopped = false;
  for (let i = 0; i < page.docs.length; i += 5) {
    if (Date.now() - started > BULK_BUDGET_MS) {
      stopped = true;
      break;
    }
    const group = page.docs.slice(i, i + 5);
    await Promise.all(group.map(async (d) => {
      const owner: HistoryOwner = { kind: input.kind, id: d.id };
      const link = d.get("history") as HistoryLink | undefined;
      const state = historyLinkState(link);
      try {
        if (state === "disabled") out.skippedDisabled++;
        else if (state === "active") {
          if (!withDetails.has(link!.token!)) {
            await buildHistory(tid, owner, { full: true });
            out.upgraded++;
          }
        } else if (await hasHistoryActivity(tid, owner)) {
          const r = await enableHistoryFor(tid, owner, "bulk", caller.uid);
          if (r.changed) out.activated++;
        } else out.noActivity++;
      } catch (err) {
        console.error("activar historial a todos", tid, owner, err);
      }
      out.scanned++;
    }));
    last = group[group.length - 1]!.id;
  }
  out.done = !stopped && page.docs.length < BULK_PAGE;
  out.cursor = out.done ? null : last;
  return out;
});
