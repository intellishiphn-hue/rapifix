import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { col, DEFAULT_SETTINGS, normalizePhone, storagePath, type SettingsInput, type WorkshopSettings } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDocData } from "@/lib/firestore/hooks";
import { uploadImage } from "@/lib/storage";

export const settingsRef = () => doc(db, col.settings(TENANT_ID), "general");

export function useSettings() {
  const state = useDocData<WorkshopSettings & { id: string }>(settingsRef(), `settings-${TENANT_ID}`);
  return { ...state, settings: { ...DEFAULT_SETTINGS, ...(state.data ?? {}) } as WorkshopSettings };
}

export async function saveSettings(input: SettingsInput, uid: string) {
  await setDoc(
    settingsRef(),
    {
      ...input,
      phone: input.phone ? normalizePhone(input.phone) : "",
      whatsapp: input.whatsapp ? normalizePhone(input.whatsapp) : "",
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );
}

export async function uploadLogo(file: File, uid: string, onProgress?: (p: number) => void) {
  const isPng = file.type === "image/png";
  const url = await uploadImage(file, storagePath.logo(TENANT_ID, isPng ? "png" : "jpg"), onProgress, {
    maxWidthOrHeight: 800,
    contentType: isPng ? "image/png" : "image/jpeg",
  });
  await setDoc(settingsRef(), { logoUrl: url, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
  return url;
}
