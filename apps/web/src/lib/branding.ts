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

/** Ícono de la pestaña del navegador con el logo del taller (en vez del ícono genérico). */
export function FaviconFromLogo() {
  const logo = usePublicLogo();
  useEffect(() => {
    if (!logo) return;
    for (const rel of ["icon", "apple-touch-icon"]) {
      let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.removeAttribute("type");
      link.href = logo;
    }
  }, [logo]);
  return null;
}
