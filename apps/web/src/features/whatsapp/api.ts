import { useEffect } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { col, opsCol, setTemplateOverrides, type MessageLog } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

export const templatesRef = () => doc(db, col.settings(TENANT_ID), "templates");

/** Carga los textos editados de las plantillas al iniciar sesión (los usa todo el panel). */
export function useTemplateOverridesSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      templatesRef(),
      (snap) => setTemplateOverrides((snap.data()?.bodies as Record<string, string> | undefined) ?? {}),
      () => undefined,
    );
  }, [enabled]);
}

export function useTemplateOverrides() {
  const state = useDocData<{ id: string; bodies?: Record<string, string> }>(templatesRef(), `templates-${TENANT_ID}`);
  return { ...state, bodies: state.data?.bodies ?? {} };
}

/** Guarda el texto de una plantilla ("" = volver al texto de fábrica). */
export async function saveTemplate(key: string, body: string, uid: string) {
  await setDoc(templatesRef(), { bodies: { [key]: body }, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
}

export function useMessageLog(max = 300) {
  return useQueryData<MessageLog>(query(collection(db, opsCol.messages(TENANT_ID)), orderBy("at", "desc"), limit(max)), `messages|${max}`);
}
