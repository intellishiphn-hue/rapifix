import { useCallback, useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import {
  col, waAutoSettings, waAvailability, waCol, type QueueWhatsAppInput, type WaAutoSettings, type WaAvailability, type WaOutbox, type WaStatusDoc,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

export const WA_DOC_URL = "https://github.com/intellishiphn-hue/rapifix/blob/main/docs/WHATSAPP-AUTOMATICO.md";

export const queueWhatsApp = callable<QueueWhatsAppInput, { id: string; duplicate: boolean }>("queueWhatsApp");
export const retryWhatsApp = callable<{ id: string }, { ok: boolean }>("retryWhatsApp");
export const cancelWhatsApp = callable<{ id: string }, { ok: boolean }>("cancelWhatsApp");
export const createWaWorkerToken = callable<Record<string, never>, { token: string; url: string }>("createWaWorkerToken");
export const revokeWaWorkerToken = callable<Record<string, never>, { ok: boolean }>("revokeWaWorkerToken");

const waSettingsRef = () => doc(db, col.settings(TENANT_ID), "whatsapp");
const waStatusRef = () => doc(db, waCol.status(TENANT_ID), "current");
const outboxRef = (id: string) => doc(db, waCol.outbox(TENANT_ID), id);

export async function saveWaAutoSettings(patch: Partial<WaAutoSettings>, uid: string) {
  await setDoc(waSettingsRef(), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
}

/** Reloj que avanza cada 20 s, para notar cuando la computadora del taller deja de reportar. */
function useNow(everyMs = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Configuración y estado en vivo del WhatsApp automático. */
export function useWaAuto(): { settings: WaAutoSettings; status: WaStatusDoc | null; availability: WaAvailability; loading: boolean } {
  const cfg = useDocData<Partial<WaAutoSettings> & { id: string }>(waSettingsRef(), `wa-settings-${TENANT_ID}`);
  const st = useDocData<WaStatusDoc & { id: string }>(waStatusRef(), `wa-status-${TENANT_ID}`);
  const now = useNow();
  const settings = waAutoSettings(cfg.data);
  return { settings, status: st.data, availability: waAvailability(settings, st.data, now), loading: cfg.loading || st.loading };
}

export function useOutbox(max = 100) {
  return useQueryData<WaOutbox>(query(collection(db, waCol.outbox(TENANT_ID)), orderBy("createdAt", "desc"), limit(max)), `waOutbox|${max}`);
}

export function useOutboxDoc(id: string | null) {
  return useDocData<WaOutbox>(id ? outboxRef(id) : null, `waOutbox-${id ?? "none"}`);
}

/** Sigue un mensaje de la cola con un aviso que cambia solo: Enviando → Enviado / No se pudo enviar. */
export function trackOutbox(id: string, name: string) {
  const toastId = `wa-${id}`;
  toast.loading(`Enviando mensaje a ${name}…`, { id: toastId });
  let done = false;
  const finish = () => {
    done = true;
    unsub();
    clearTimeout(timer);
  };
  const unsub = onSnapshot(outboxRef(id), (snap) => {
    const m = snap.data() as WaOutbox | undefined;
    if (!m || done) return;
    if (m.status === "sent") {
      toast.success(`Mensaje enviado a ${name}`, { id: toastId });
      finish();
    } else if (m.status === "failed" || m.status === "cancelled") {
      toast.error(`No se pudo enviar el mensaje a ${name}${m.error ? `: ${m.error}` : ""}`, { id: toastId, duration: 10_000 });
      finish();
    }
  }, () => {
    toast.dismiss(toastId);
    finish();
  });
  const timer = setTimeout(() => {
    if (done) return;
    toast.message(`El mensaje para ${name} sigue en cola. Revíselo en WhatsApp → En cola.`, { id: toastId });
    finish();
  }, 90_000);
}

export interface WaTarget {
  phone: string;
  name: string;
  body: string;
  context: string;
  orderId?: string | null;
  orderCode?: string | null;
  washId?: string | null;
  hold?: boolean;
}

/** Encola un mensaje (omite los campos vacíos: Firebase convierte undefined en null). */
export async function enqueueWhatsApp(t: WaTarget): Promise<string> {
  const r = await queueWhatsApp({
    to: t.phone,
    name: t.name.slice(0, 120),
    body: t.body.trim(),
    context: t.context.slice(0, 40),
    ...(t.orderId ? { orderId: t.orderId } : {}),
    ...(t.orderCode ? { orderCode: t.orderCode } : {}),
    ...(t.washId ? { washId: t.washId } : {}),
    ...(t.hold ? { hold: true } : {}),
  });
  return r.id;
}

/**
 * "Enviar sin preguntar": si está activo y la computadora del taller está conectada, encola el aviso
 * y devuelve true. Si no, devuelve false y quien llama abre el compositor como siempre.
 */
export function useWaSilentSend() {
  const { settings, availability } = useWaAuto();
  const enabled = settings.waAutoSilent && availability === "ready";
  return useCallback(async (t: WaTarget): Promise<boolean> => {
    if (!enabled || !t.phone || !t.body.trim()) return false;
    try {
      const id = await enqueueWhatsApp(t);
      if (id) trackOutbox(id, t.name);
      return true;
    } catch (err) {
      toast.error(`${errorMessage(err)} Puede enviarlo a mano.`);
      return false;
    }
  }, [enabled]);
}
