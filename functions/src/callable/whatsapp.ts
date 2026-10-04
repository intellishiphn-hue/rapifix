import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import {
  hnDayKey, isValidE164, normalizePhone, queueWhatsAppSchema, ROLES, waAvailability, waChatId, waCol, waDailyNext, waDedupeText,
  waIsDuplicate, waOutboxIdSchema, waTtlMs, WA_DEDUPE_MS, WA_PER_MINUTE, type WaOutboxStatus, type WaStatusDoc,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { actorName } from "../lib/actors";
import { parseInput, requireRole } from "../lib/guards";
import { REGION } from "../lib/params";
import { rateLimit } from "../lib/rateLimit";
import {
  loadWaSettings, mirrorStatus, newWorkerToken, sha256, ts, waCounterRef, waMessageRef, waOutboxRef, waPrivateRef, waStatusRef,
} from "../lib/waAuto";

/** Quienes ven el historial de WhatsApp (igual que la lectura de messages en las reglas). */
const DESK = ["admin", "manager", "reception", "seller"] as const;

/**
 * Pone un mensaje en la cola de WhatsApp automático. Lo manda la computadora del taller
 * (tools/wa-worker + OpenWA). Si el automático no está disponible, el panel usa el envío manual.
 */
export const queueWhatsApp = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ROLES);
  const input = parseInput(queueWhatsAppSchema, request.data);
  const to = normalizePhone(input.to);
  if (!isValidE164(to) || !waChatId(to)) throw new HttpsError("invalid-argument", "El número de WhatsApp no es válido.");

  const settings = await loadWaSettings(caller.tid);
  if (!settings.waAuto) throw new HttpsError("failed-precondition", "El WhatsApp automático está apagado. Use el envío manual.");
  const hold = input.hold === true;
  if (!hold) {
    const status = (await waStatusRef(caller.tid).get()).data() as WaStatusDoc | undefined;
    if (waAvailability(settings, status, Date.now()) !== "ready") {
      throw new HttpsError("failed-precondition", "WhatsApp automático no disponible: la computadora del taller está apagada o WhatsApp está desconectado.");
    }
  }
  await rateLimit("waQueue", [caller.tid], WA_PER_MINUTE, 60);

  const name = await actorName(caller.uid, caller.email);
  const nowMs = Date.now();
  const outRef = db.collection(waCol.outbox(caller.tid)).doc();
  const dedupeRef = db.doc(`${waCol.dedupe(caller.tid)}/${sha256(waDedupeText(to, input.body)).slice(0, 40)}`);
  const counterRef = waCounterRef(caller.tid);

  const result = await db.runTransaction(async (tx) => {
    const [dupe, counter] = await Promise.all([tx.get(dedupeRef), tx.get(counterRef)]);
    if (waIsDuplicate((dupe.get("at") as Timestamp | undefined)?.toMillis(), nowMs)) {
      return { id: String(dupe.get("outboxId") ?? ""), duplicate: true };
    }
    const count = waDailyNext(counter.data(), hnDayKey(nowMs), settings.dailyLimit);
    if (count === null) {
      throw new HttpsError("resource-exhausted", `Se llegó al límite de ${settings.dailyLimit} mensajes automáticos por hoy. Use el envío manual.`);
    }
    const base = {
      to,
      name: input.name.slice(0, 120),
      body: input.body,
      context: input.context || "mensaje",
      orderId: input.orderId ?? null,
      orderCode: input.orderCode ?? null,
      createdBy: caller.uid,
      createdByName: name.slice(0, 120),
    };
    tx.set(outRef, {
      ...base,
      washId: input.washId ?? null,
      status: "queued",
      attempts: 0,
      error: null,
      waMessageId: null,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: null,
      nextAttemptAt: ts(nowMs),
      leaseUntil: null,
      expiresAt: ts(nowMs + waTtlMs(base.context, hold)),
    });
    tx.set(waMessageRef(caller.tid, outRef.id), { ...base, mode: "auto", status: "queued", error: null, at: FieldValue.serverTimestamp() });
    tx.set(dedupeRef, { at: ts(nowMs), outboxId: outRef.id, expireAt: ts(nowMs + WA_DEDUPE_MS * 10) });
    tx.set(counterRef, { day: hnDayKey(nowMs), count, updatedAt: FieldValue.serverTimestamp() });
    return { id: outRef.id, duplicate: false };
  });
  return result;
});

async function changeOutbox(tid: string, id: string, uid: string, desk: boolean, from: WaOutboxStatus[], apply: (nowMs: number, context: string) => Record<string, unknown>, status: WaOutboxStatus) {
  const ref = waOutboxRef(tid, id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "No se encontró el mensaje.");
    if (!desk && snap.get("createdBy") !== uid) throw new HttpsError("permission-denied", "No tiene permiso para realizar esta acción.");
    if (!from.includes(snap.get("status") as WaOutboxStatus)) throw new HttpsError("failed-precondition", "El mensaje ya cambió de estado. Actualice la página.");
    const patch = apply(Date.now(), String(snap.get("context") ?? ""));
    tx.update(ref, { ...patch, status });
    mirrorStatus(tx, tid, id, status, (patch.error as string | null | undefined) ?? null);
  });
  return { ok: true };
}

/** Vuelve a poner en cola un mensaje que falló o se canceló. */
export const retryWhatsApp = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const { id } = parseInput(waOutboxIdSchema, request.data);
  const settings = await loadWaSettings(caller.tid);
  if (!settings.waAuto) throw new HttpsError("failed-precondition", "El WhatsApp automático está apagado.");
  await rateLimit("waQueue", [caller.tid], WA_PER_MINUTE, 60);
  return changeOutbox(caller.tid, id, caller.uid, true, ["failed", "cancelled"], (nowMs, context) => ({
    attempts: 0, error: null, leaseUntil: null, nextAttemptAt: ts(nowMs), expiresAt: ts(nowMs + waTtlMs(context, true)),
  }), "queued");
});

/** Cancela un mensaje que todavía no ha salido. */
export const cancelWhatsApp = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ROLES);
  const { id } = parseInput(waOutboxIdSchema, request.data);
  const desk = (DESK as readonly string[]).includes(caller.role);
  return changeOutbox(caller.tid, id, caller.uid, desk, ["queued"], () => ({ error: "Cancelado desde el panel", leaseUntil: null }), "cancelled");
});

/**
 * Genera la clave de conexión para la computadora del taller. Se devuelve UNA sola vez;
 * en la base solo queda su hash (sha256). Generar una nueva invalida la anterior.
 */
export const createWaWorkerToken = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  await rateLimit("waToken", [caller.uid], 5, 600);
  const token = newWorkerToken();
  const hash = sha256(token);
  const priv = waPrivateRef(caller.tid);
  const previous = String((await priv.get()).get("tokenHash") ?? "");
  const batch = db.batch();
  if (previous) batch.delete(db.doc(`${waCol.tokens}/${previous}`));
  batch.set(db.doc(`${waCol.tokens}/${hash}`), { tid: caller.tid, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  batch.set(priv, { tokenHash: hash, tokenCreatedAt: FieldValue.serverTimestamp(), tokenCreatedBy: caller.uid }, { merge: true });
  batch.set(waStatusRef(caller.tid), { hasToken: true, tokenCreatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  return { token, url: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/waWorker` };
});

export const revokeWaWorkerToken = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const priv = waPrivateRef(caller.tid);
  const previous = String((await priv.get()).get("tokenHash") ?? "");
  const batch = db.batch();
  if (previous) batch.delete(db.doc(`${waCol.tokens}/${previous}`));
  batch.set(priv, { tokenHash: FieldValue.delete(), tokenRevokedAt: FieldValue.serverTimestamp(), tokenRevokedBy: caller.uid }, { merge: true });
  batch.set(waStatusRef(caller.tid), { hasToken: false, tokenCreatedAt: null }, { merge: true });
  await batch.commit();
  return { ok: true };
});
