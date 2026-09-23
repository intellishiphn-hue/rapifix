import imageCompression from "browser-image-compression";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebase";

/**
 * Comprime una foto en el navegador (máx. 1600px, ~0.8 calidad) y la sube a Storage.
 * Una foto de celular de 5 MB queda en unos 300 KB.
 */
export async function uploadImage(
  file: File,
  path: string,
  onProgress?: (pct: number) => void,
  options: { maxWidthOrHeight?: number; contentType?: string } = {},
): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: options.maxWidthOrHeight ?? 1600,
    maxSizeMB: 1,
    initialQuality: 0.8,
    fileType: options.contentType ?? "image/jpeg",
    useWebWorker: true,
  });
  const task = uploadBytesResumable(ref(storage, path), compressed, {
    contentType: options.contentType ?? "image/jpeg",
    cacheControl: "public, max-age=31536000",
  });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      reject,
      () => resolve(),
    );
  });
  return getDownloadURL(task.snapshot.ref);
}

export const newId = () =>
  (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 20);
