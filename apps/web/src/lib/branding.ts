import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { storagePath } from "@rapifix/shared";
import { db, storage, TENANT_ID } from "@/lib/firebase";

const KEY = "rapifix.logoUrl";

/**
 * Logo del taller sin iniciar sesión (pantalla de login). Sale de publicBranding/{tid}
 * (copia pública que mantiene el servidor); si aún no existe, del archivo en Storage.
 * Se guarda en el navegador para que aparezca al instante la próxima vez.
 */
export function usePublicLogo(): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    let alive = true;
    const keep = (u: string) => {
      if (!alive) return;
      setUrl(u);
      try { localStorage.setItem(KEY, u); } catch { /* sin almacenamiento */ }
    };
    (async () => {
      try {
        const snap = await getDoc(doc(db, "publicBranding", TENANT_ID));
        const u = snap.get("logoUrl") as string | undefined;
        if (u) return keep(u);
      } catch { /* sigue con Storage */ }
      for (const ext of ["png", "jpg"]) {
        try {
          return keep(await getDownloadURL(ref(storage, storagePath.logo(TENANT_ID, ext))));
        } catch { /* probar la otra extensión */ }
      }
    })();
    return () => { alive = false; };
  }, []);
  return url;
}
