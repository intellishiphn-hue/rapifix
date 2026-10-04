import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue, type Timestamp } from "firebase-admin/firestore";
import {
  inWaSendWindow, waAfterFailure, waChatId, waCol, waEligible, waExpired, waPending, waSessionState, WA_LEASE_MS, WA_MAX_ATTEMPTS, WA_PULL_MAX,
  type WaOutboxStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { rateLimit } from "../lib/rateLimit";
import { loadWaSettings, mirrorStatus, safeEqualHex, sha256, ts, waOutboxRef, waPrivateRef, waStatusRef } from "../lib/waAuto";

/** Token ya verificado (por instancia, 60 s) para no leer Firestore en cada llamada. Una revocación tarda como mucho 1 minuto. */
const verified = new Map<string, { tid: string; until: number }>();
/** Tope en memoria por token: el worker normal hace unas 15 llamadas por minuto. */
const calls = new Map<string, { start: number; count: number }>();
const MAX_CALLS_PER_MINUTE = 120;

async function tenantOfToken(token: string): Promise<string | null> {
  if (!/^rfw_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hash = sha256(token);
  const cached = verified.get(hash);
  if (cached && cached.until > Date.now()) return cached.tid;
  verified.delete(hash);
  const entry = await db.doc(`${waCol.tokens}/${hash}`).get();
  const tid = entry.get("tid");
  if (typeof tid !== "string" || !tid) return null;
  const stored = String((await waPrivateRef(tid).get()).get("tokenHash") ?? "");
  if (!safeEqualHex(stored, hash)) return null;
  verified.set(hash, { tid, until: Date.now() + 60_000 });
  return tid;
}

function tooManyCalls(key: string): boolean {
  const t = Date.now();
  const c = calls.get(key);
  if (!c || t - c.start > 60_000) {
    calls.set(key, { start: t, count: 1 });
    return false;
  }
  c.count += 1;
  return c.count > MAX_CALLS_PER_MINUTE;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

async function heartbeat(tid: string, body: Record<string, unknown>) {
  const raw = str(body.sessionStatus, 40) || "disconnected";
  const phone = str(body.phone, 20).replace(/\D/g, "");
  const next = { rawStatus: raw, sessionStatus: waSessionState(raw), phone: phone ? `+${phone}` : null, workerVersion: str(body.version, 20) || null };
  const ref = waStatusRef(tid);
  const cur = await ref.get();
  const seen = (cur.get("lastSeenAt") as Timestamp | undefined)?.toMillis() ?? 0;
  const same = cur.get("rawStatus") === next.rawStatus && (cur.get("phone") ?? null) === next.phone && (cur.get("workerVersion") ?? null) === next.workerVersion;
  // Para no escribir cada 8 segundos: solo si cambió algo o pasaron 30 s.
  if (!same || Date.now() - seen > 30_000) await ref.set({ ...next, lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, sessionStatus: next.sessionStatus };
}

type Row = { status: WaOutboxStatus; expiresAt: Timestamp; nextAttemptAt?: Timestamp; leaseUntil?: Timestamp | null; attempts?: number; to: string; body: string };

async function pull(tid: string, body: Record<string, unknown>) {
  const nowMs = Date.now();
  const max = Math.max(1, Math.min(WA_PULL_MAX, Number(body.max) || WA_PULL_MAX));
  const snap = await db.collection(waCol.outbox(tid)).where("status", "in", ["queued", "sending"]).limit(60).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Row) }));

  // Barrido de vencidos: no se mandan avisos viejos.
  const expired = rows.filter((r) => waPending(r, nowMs) && waExpired(r, nowMs));
  await Promise.all(expired.map((r) => db.runTransaction(async (tx) => {
    const cur = await tx.get(waOutboxRef(tid, r.id));
    const d = cur.data() as Row | undefined;
    if (!d || !waPending(d, nowMs) || !waExpired(d, nowMs)) return;
    const error = "Venció sin enviarse (la computadora del taller estaba apagada o fuera de horario)";
    tx.update(cur.ref, { status: "cancelled", error, leaseUntil: null });
    mirrorStatus(tx, tid, r.id, "cancelled", error);
  })));

  if (!(await loadWaSettings(tid)).waAuto) return { messages: [], reason: "apagado" };
  if (!inWaSendWindow(nowMs)) return { messages: [], reason: "fuera_de_horario" };

  const candidates = rows
    .filter((r) => waEligible(r, nowMs))
    .sort((a, b) => (a.nextAttemptAt?.toMillis() ?? 0) - (b.nextAttemptAt?.toMillis() ?? 0))
    .slice(0, max);
  if (!candidates.length) return { messages: [] };

  const messages = await db.runTransaction(async (tx) => {
    const fresh = await tx.getAll(...candidates.map((c) => waOutboxRef(tid, c.id)));
    const out: Array<{ id: string; to: string; chatId: string; body: string; attempt: number }> = [];
    for (const doc of fresh) {
      const d = doc.data() as Row | undefined;
      if (!d || !waEligible(d, nowMs)) continue;
      const attempts = Number(d.attempts ?? 0) + 1;
      const chatId = waChatId(d.to);
      // Un "enviando" con permiso vencido que ya gastó sus intentos, o un número imposible: falla.
      if (!chatId || attempts > WA_MAX_ATTEMPTS) {
        const error = chatId ? "No se pudo confirmar el envío después de 3 intentos" : "Número de WhatsApp no válido";
        tx.update(doc.ref, { status: "failed", error, leaseUntil: null });
        mirrorStatus(tx, tid, doc.id, "failed", error);
        continue;
      }
      tx.update(doc.ref, { status: "sending", attempts, leaseUntil: ts(nowMs + WA_LEASE_MS) });
      mirrorStatus(tx, tid, doc.id, "sending");
      out.push({ id: doc.id, to: d.to, chatId, body: d.body, attempt: attempts });
    }
    return out;
  });
  return { messages };
}

async function ack(tid: string, body: Record<string, unknown>) {
  const id = str(body.id, 128);
  if (!id || id.includes("/")) return { ok: false, error: "id requerido" };
  const ok = body.ok === true;
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const ref = waOutboxRef(tid, id);
    const snap = await tx.get(ref);
    // Idempotente: si ya no está "enviando" (ack repetido, cancelado, etc.) no se toca.
    if (!snap.exists || snap.get("status") !== "sending") return { ok: true, ignored: true };
    if (ok) {
      tx.update(ref, { status: "sent", sentAt: FieldValue.serverTimestamp(), error: null, leaseUntil: null, waMessageId: str(body.waMessageId, 200) || null });
      mirrorStatus(tx, tid, id, "sent");
      return { ok: true, status: "sent" };
    }
    const error = str(body.error, 300) || "No se pudo enviar";
    const attempts = Number(snap.get("attempts") ?? 1);
    if (body.release === true) {
      // WhatsApp se desconectó justo antes de enviar: vuelve a la cola sin gastar el intento.
      tx.update(ref, { status: "queued", attempts: Math.max(0, attempts - 1), error, leaseUntil: null, nextAttemptAt: ts(nowMs + 30_000) });
      mirrorStatus(tx, tid, id, "queued", error);
      return { ok: true, status: "queued" };
    }
    const next = waAfterFailure(attempts, nowMs, body.permanent === true);
    tx.update(ref, { status: next.status, error, leaseUntil: null, nextAttemptAt: ts(next.nextAttemptAt) });
    mirrorStatus(tx, tid, id, next.status, error);
    return { ok: true, status: next.status };
  });
}

/**
 * Punto de conexión del worker de la computadora del taller (tools/wa-worker).
 * POST JSON { action: "heartbeat" | "pull" | "ack", ... } con "Authorization: Bearer <clave>".
 * La computadora del taller solo hace llamadas salientes; nadie se conecta a ella.
 */
export const waWorker = onRequest({ region: REGION, cors: false, maxInstances: 3 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  const ip = String(req.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.ip || "";
  const match = /^Bearer\s+(\S+)$/.exec(String(req.get("authorization") ?? ""));
  let tid: string | null = null;
  try {
    tid = match ? await tenantOfToken(match[1]!) : null;
    if (!tid) {
      // Intentos con clave incorrecta: máximo 10 cada 10 minutos por IP.
      await rateLimit("waWorkerBad", [ip || "sin-ip"], 10, 600);
      res.status(401).json({ error: "Clave de conexión no válida" });
      return;
    }
  } catch (err) {
    const limited = (err as { code?: string }).code === "resource-exhausted";
    if (!limited) logger.error("waWorker: error verificando la clave", { err: String(err) });
    res.status(limited ? 429 : 500).json({ error: limited ? "Demasiados intentos" : "Error interno" });
    return;
  }
  if (tooManyCalls(sha256(match![1]!))) {
    res.status(429).json({ error: "Demasiadas llamadas. Espere un minuto." });
    return;
  }
  const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  try {
    switch (body.action) {
      case "heartbeat": res.json(await heartbeat(tid, body)); return;
      case "pull": res.json(await pull(tid, body)); return;
      case "ack": res.json(await ack(tid, body)); return;
      default: res.status(400).json({ error: "Acción no válida" });
    }
  } catch (err) {
    logger.error("waWorker: error", { tid, action: String(body.action), err: String(err) });
    res.status(500).json({ error: "Error interno" });
  }
});
