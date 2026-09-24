import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";

/**
 * Copia pública del logo y el nombre del taller (publicBranding/{tid}) para la pantalla de
 * inicio de sesión, que se muestra antes de entrar y no puede leer la configuración.
 */
export const onSettingsBranding = onDocumentWritten({ document: "tenants/{tid}/settings/general", region: REGION }, async (event) => {
  const after = event.data?.after.data();
  if (!after) return;
  const before = event.data?.before.data();
  if (before && before.logoUrl === after.logoUrl && before.name === after.name) return;
  await db.doc(`publicBranding/${event.params.tid}`).set({ logoUrl: after.logoUrl ?? "", name: after.name ?? "" });
});
