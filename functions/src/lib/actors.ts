import { db } from "./admin";

const cache = new Map<string, string>();

/** Nombre visible de un usuario (para el historial). */
export async function actorName(uid: string, fallback?: string): Promise<string> {
  if (cache.has(uid)) return cache.get(uid)!;
  const snap = await db.doc(`users/${uid}`).get();
  const name = (snap.get("displayName") as string | undefined) || fallback || "Usuario";
  cache.set(uid, name);
  return name;
}
