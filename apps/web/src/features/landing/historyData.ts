/**
 * Lee el historial público (publicHistory/{token}) con la API REST de Firestore, igual que /lavado
 * con publicCarwash: la página /historial/:token no carga el SDK de Firestore ni módulos del panel.
 * Las reglas permiten leer un documento con el token exacto y no permiten listar.
 */
import {
  HISTORY_TOKEN_RE, HISTORY_VISITS, isHistoryVisitId, parsePublicHistory, parsePublicVisitDetail, PUBLIC_HISTORY, type PublicHistory, type PublicVisitDetail,
} from "@rapifix/shared";
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

export type VisitLoad =
  | { state: "loading" }
  | { state: "ready"; data: PublicVisitDetail }
  /** el detalle todavía no existe (historial armado antes del detalle) o la visita ya no se muestra */
  | { state: "missing" }
  | { state: "error" };

/** Detalle de una visita: publicHistory/{token}/visits/{orderId} (se lee al abrir la visita). */
export async function loadVisitDetail(token: string, orderId: string, signal?: AbortSignal): Promise<VisitLoad> {
  if (!HISTORY_TOKEN_RE.test(token) || !isHistoryVisitId(orderId)) return { state: "missing" };
  try {
    const res = await fetch(publicDocUrl(`${PUBLIC_HISTORY}/${token}/${HISTORY_VISITS}`, orderId), { signal, headers: { Accept: "application/json" }, referrerPolicy: "no-referrer" });
    if (res.status === 404 || res.status === 403) return { state: "missing" };
    if (!res.ok) return { state: "error" };
    const json = (await res.json()) as { fields?: Record<string, FsValue> };
    const data = parsePublicVisitDetail(decodeFs({ mapValue: { fields: json.fields ?? {} } }));
    return data && data.id === orderId ? { state: "ready", data } : { state: "missing" };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { state: "loading" };
    return { state: "error" };
  }
}
