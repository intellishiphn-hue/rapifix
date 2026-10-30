/**
 * Lee el historial público (publicHistory/{token}) con la API REST de Firestore, igual que /lavado
 * con publicCarwash: la página /historial/:token no carga el SDK de Firestore ni módulos del panel.
 * Las reglas permiten leer un documento con el token exacto y no permiten listar.
 */
import { HISTORY_TOKEN_RE, parsePublicHistory, PUBLIC_HISTORY, type PublicHistory } from "@rapifix/shared";
import { decodeFs, publicDocUrl, type FsValue } from "./carwashData";

export type HistoryLoad =
  | { state: "loading" }
  | { state: "ready"; data: PublicHistory }
  /** no existe, se desactivó o el token no tiene la forma correcta */
  | { state: "missing" }
  | { state: "error" };

export async function loadPublicHistory(token: string, signal?: AbortSignal): Promise<HistoryLoad> {
  if (!HISTORY_TOKEN_RE.test(token)) return { state: "missing" };
  try {
    const res = await fetch(publicDocUrl(PUBLIC_HISTORY, token), { signal, headers: { Accept: "application/json" }, referrerPolicy: "no-referrer" });
    if (res.status === 404 || res.status === 403) return { state: "missing" };
    if (!res.ok) return { state: "error" };
    const json = (await res.json()) as { fields?: Record<string, FsValue> };
    const data = parsePublicHistory(decodeFs({ mapValue: { fields: json.fields ?? {} } }));
    if (!data.active) return { state: "missing" };
    return { state: "ready", data };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { state: "loading" };
    return { state: "error" };
  }
}
