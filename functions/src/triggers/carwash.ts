import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { carwashCol } from "@rapifix/shared";
import { db } from "../lib/admin";
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

/**
 * Fotos de ingreso/salida del lavado: mantiene photoCount y photoCounts en el lavado.
 * Ese cambio dispara onCarwashWashWritten, que rehace la página pública con las fotos.
 */
export const onCarwashPhotoWritten = onDocumentWritten(
  { document: "tenants/{tid}/carwashWashes/{washId}/photos/{photoId}", region: REGION },
  async (event) => {
    const created = !event.data?.before.exists && event.data?.after.exists;
    const deleted = event.data?.before.exists && !event.data?.after.exists;
    if (!created && !deleted) return;
    const { tid, washId } = event.params;
    const ref = db.doc(`${carwashCol.washes(tid)}/${washId}`);
    if (!(await ref.get()).exists) return;
    const photos = db.collection(carwashCol.washPhotos(tid, washId));
    const [entry, exit] = await Promise.all([
      photos.where("stage", "==", "entry").count().get(),
      photos.where("stage", "==", "exit").count().get(),
    ]);
    const counts = { entry: entry.data().count, exit: exit.data().count };
    await ref.update({ photoCount: counts.entry + counts.exit, photoCounts: counts });
  },
);
