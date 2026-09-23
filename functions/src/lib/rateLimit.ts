import { createHash } from "node:crypto";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Límite de intentos para los botones públicos (link del cliente), por link y por IP.
 * Se guarda en rateLimits/{clave}, colección que las reglas no dejan leer ni escribir desde el navegador.
 */
export async function rateLimit(name: string, keys: string[], max: number, windowSec: number) {
  const now = Date.now();
  for (const k of keys) {
    if (!k) continue;
    const id = `${name}_${createHash("sha256").update(k).digest("hex").slice(0, 32)}`;
    const ref = db.doc(`rateLimits/${id}`);
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const start = (snap.get("windowStart") as Timestamp | undefined)?.toMillis() ?? 0;
      if (!snap.exists || now - start > windowSec * 1000) {
        tx.set(ref, { windowStart: Timestamp.fromMillis(now), count: 1, expireAt: Timestamp.fromMillis(now + windowSec * 2000) });
        return true;
      }
      if (Number(snap.get("count") ?? 0) >= max) return false;
      tx.update(ref, { count: FieldValue.increment(1) });
      return true;
    });
    if (!ok) throw new HttpsError("resource-exhausted", "Demasiados intentos. Espere unos minutos e intente de nuevo.");
  }
}

export function requestIp(request: CallableRequest<unknown>): string {
  const raw = request.rawRequest as unknown as { headers: Record<string, unknown>; ip?: string };
  const fwd = String(raw.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return fwd || raw.ip || "";
}

/**
 * App Check (protección contra bots). Se activa con APP_CHECK_ENFORCE=true en functions/.env.<proyecto>
 * después de registrar la app en Firebase Console → App Check (ver docs/FASE-7.md).
 */
export function requireAppCheck(request: CallableRequest<unknown>) {
  if (process.env.APP_CHECK_ENFORCE === "true" && !request.app) {
    throw new HttpsError("failed-precondition", "No se pudo verificar el navegador. Recargue la página e intente de nuevo.");
  }
}
