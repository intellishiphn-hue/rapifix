import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { col } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";

/** Recalcula cuántos vehículos activos tiene un cliente. Se autocorrige siempre. */
async function recountVehicles(tid: string, customerId: string) {
  const customerRef = db.doc(`${col.customers(tid)}/${customerId}`);
  const snap = await db
    .collection(col.vehicles(tid))
    .where("customerId", "==", customerId)
    .where("archived", "==", false)
    .count()
    .get();
  const exists = (await customerRef.get()).exists;
  if (exists) await customerRef.update({ vehicleCount: snap.data().count });
}

export const onVehicleWritten = onDocumentWritten(
  { document: "tenants/{tid}/vehicles/{vehicleId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const tid = event.params.tid;
    const affected = new Set<string>();
    if (before?.customerId) affected.add(before.customerId);
    if (after?.customerId) affected.add(after.customerId);

    const ownerChanged = before?.customerId !== after?.customerId;
    const archivedChanged = before?.archived !== after?.archived;
    if (!ownerChanged && !archivedChanged) return;

    await Promise.all([...affected].map((id) => recountVehicles(tid, id)));
  },
);

/** Si cambia el nombre o teléfono del cliente, actualiza la copia en sus vehículos. */
export const onCustomerWritten = onDocumentWritten(
  { document: "tenants/{tid}/customers/{customerId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.fullName === after.fullName && before.phone === after.phone) return;

    const { tid, customerId } = event.params;
    const vehicles = await db.collection(col.vehicles(tid)).where("customerId", "==", customerId).get();
    const writer = db.bulkWriter();
    vehicles.forEach((doc) => {
      writer.update(doc.ref, { customer: { fullName: after.fullName, phone: after.phone } });
    });
    await writer.close();
  },
);

/** Mantiene el contador de fotos del vehículo. */
export const onVehiclePhotoWritten = onDocumentWritten(
  { document: "tenants/{tid}/vehicles/{vehicleId}/photos/{photoId}", region: REGION },
  async (event) => {
    const created = !event.data?.before.exists && event.data?.after.exists;
    const deleted = event.data?.before.exists && !event.data?.after.exists;
    if (!created && !deleted) return;
    const { tid, vehicleId } = event.params;
    const vehicleRef = db.doc(`${col.vehicles(tid)}/${vehicleId}`);
    const count = await vehicleRef.collection("photos").count().get();
    await vehicleRef.update({ photoCount: count.data().count });
  },
);
