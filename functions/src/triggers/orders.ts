import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { col, orderCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";

/** Mantiene en el cliente: órdenes abiertas y última visita. */
export const onWorkOrderWritten = onDocumentWritten(
  { document: "tenants/{tid}/workOrders/{orderId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const { tid } = event.params;
    const customerId = (after?.customerId ?? before?.customerId) as string | undefined;
    if (!customerId) return;
    const created = !before && !!after;
    if (!created && before?.isOpen === after?.isOpen) return;

    const customerRef = db.doc(`${col.customers(tid)}/${customerId}`);
    if (!(await customerRef.get()).exists) return;
    const open = await db.collection(orderCol.workOrders(tid)).where("customerId", "==", customerId).where("isOpen", "==", true).count().get();
    await customerRef.update({
      openOrders: open.data().count,
      ...(created ? { lastVisitAt: FieldValue.serverTimestamp() } : {}),
    });
  },
);

/** Contador de fotos de la orden. */
export const onOrderPhotoWritten = onDocumentWritten(
  { document: "tenants/{tid}/workOrders/{orderId}/photos/{photoId}", region: REGION },
  async (event) => {
    const created = !event.data?.before.exists && event.data?.after.exists;
    const deleted = event.data?.before.exists && !event.data?.after.exists;
    if (!created && !deleted) return;
    const { tid, orderId } = event.params;
    const ref = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
    const count = await ref.collection("photos").count().get();
    await ref.update({ photoCount: count.data().count });
  },
);

/** Directorio público del personal (nombre y rol) para asignar técnicos. */
export const onUserWritten = onDocumentWritten({ document: "users/{uid}", region: REGION }, async (event) => {
  const after = event.data?.after.data();
  const before = event.data?.before.data();
  const tid = (after?.tid ?? before?.tid) as string | undefined;
  if (!tid) return;
  const ref = db.doc(`${orderCol.staff(tid)}/${event.params.uid}`);
  if (!after) {
    await ref.delete();
    return;
  }
  await ref.set({ displayName: after.displayName ?? "", role: after.role ?? "", active: after.active !== false });
});
