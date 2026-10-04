import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { catalogCol, col, opsCol, waAutoSettings, waCol, type WaAutoSettings } from "@rapifix/shared";
import { db } from "./admin";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Clave de conexión del worker: se muestra una sola vez; en la base solo queda su hash. */
export const newWorkerToken = () => `rfw_${randomBytes(32).toString("base64url")}`;

/** Comparación en tiempo constante de dos hashes en hexadecimal. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export const waPrivateRef = (tid: string) => db.doc(`${catalogCol.privateConfig(tid)}/whatsapp`);
export const waStatusRef = (tid: string) => db.doc(`${waCol.status(tid)}/current`);
export const waCounterRef = (tid: string) => db.doc(`${waCol.status(tid)}/counter`);
export const waOutboxRef = (tid: string, id: string) => db.doc(`${waCol.outbox(tid)}/${id}`);
export const waMessageRef = (tid: string, id: string) => db.doc(`${opsCol.messages(tid)}/${id}`);

export async function loadWaSettings(tid: string): Promise<WaAutoSettings> {
  const snap = await db.doc(`${col.settings(tid)}/whatsapp`).get();
  return waAutoSettings(snap.data() as Partial<WaAutoSettings> | undefined);
}

type Writer = { set: (ref: DocumentReference, data: Record<string, unknown>, opts: { merge: true }) => unknown };

/** Refleja el estado del envío en el historial (messages/{id} tiene el mismo id que la cola). */
export function mirrorStatus(w: Writer, tid: string, id: string, status: string, error: string | null = null) {
  w.set(waMessageRef(tid, id), { status, error }, { merge: true });
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);
export const now = () => FieldValue.serverTimestamp();
