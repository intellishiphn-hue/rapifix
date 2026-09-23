import type { Transaction } from "firebase-admin/firestore";
import { col } from "@rapifix/shared";
import { db } from "./admin";

/** Lee el siguiente número de un contador dentro de una transacción (hay que escribirlo con commitCounter). */
export async function readCounter(tx: Transaction, tid: string, name: string, start = 1) {
  const ref = db.doc(`${col.counters(tid)}/${name}`);
  const snap = await tx.get(ref);
  const next = ((snap.exists ? (snap.get("next") as number) : start) || start) as number;
  return { ref, next };
}

export const pad = (n: number, width = 4) => String(n).padStart(width, "0");
