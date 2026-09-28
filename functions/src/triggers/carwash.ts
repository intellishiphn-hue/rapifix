import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { REGION } from "../lib/params";
import { buildPublicWash } from "../lib/publicWash";

/** Cada cambio del lavado (estado, cobro, edición) se refleja en su página pública /lavado/:token. */
export const onCarwashWashWritten = onDocumentWritten(
  { document: "tenants/{tid}/carwashWashes/{washId}", region: REGION },
  async (event) => {
    const after = event.data?.after.data();
    if (!after?.payToken) return;
    await buildPublicWash(event.params.tid, event.params.washId);
  },
);
