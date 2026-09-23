import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { buildSearchKeywords, col, orderCol, type ReceptionInput, type Totals, type WorkOrderStatus } from "@rapifix/shared";
import { db } from "./admin";
import type { Caller } from "./guards";
import { secureToken } from "./token";

export async function resolveTechnicians(tid: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const snaps = await Promise.all(unique.map((id) => db.doc(`${orderCol.staff(tid)}/${id}`).get()));
  return snaps.map((s) => {
    if (!s.exists || s.get("active") === false) throw new HttpsError("invalid-argument", "Uno de los técnicos no existe o está desactivado.");
    return { id: s.id, name: (s.get("displayName") as string) ?? "Técnico" };
  });
}

export async function logMileage(vehicleRef: DocumentReference, mileage: number, source: "reception" | "delivery", caller: Caller, name: string, note: string) {
  const v = await vehicleRef.get();
  if (!v.exists || mileage <= ((v.get("mileage") as number) ?? 0)) return;
  const batch = db.batch();
  batch.update(vehicleRef, { mileage, mileageUpdatedAt: FieldValue.serverTimestamp() });
  batch.set(vehicleRef.collection("mileageLog").doc(), { mileage, source, note, at: FieldValue.serverTimestamp(), by: caller.uid, byName: name });
  await batch.commit();
}

export interface NewOrderParams {
  vehicleId: string;
  reason: string;
  type: string;
  priority: string;
  technicianIds: string[];
  promisedAt: string | null;
  reception: ReceptionInput;
  status?: WorkOrderStatus;
  portalToken?: string;
  fromQuote?: { id: string; code: string; totals: Totals };
}

/** Crea la orden con numeración correlativa (una sola orden abierta por vehículo). */
export async function insertWorkOrder(caller: Caller, name: string, p: NewOrderParams): Promise<{ orderId: string; code: string }> {
  const tid = caller.tid;
  const vehicleRef = db.doc(`${col.vehicles(tid)}/${p.vehicleId}`);
  const vehicle = await vehicleRef.get();
  if (!vehicle.exists || vehicle.get("archived")) throw new HttpsError("not-found", "El vehículo no existe o está archivado.");
  const customerId = vehicle.get("customerId") as string;
  const customer = await db.doc(`${col.customers(tid)}/${customerId}`).get();
  if (!customer.exists) throw new HttpsError("not-found", "El cliente del vehículo no existe.");

  const open = await db.collection(orderCol.workOrders(tid)).where("vehicleId", "==", p.vehicleId).where("isOpen", "==", true).limit(1).get();
  if (!open.empty) throw new HttpsError("already-exists", `Este vehículo ya tiene una orden abierta (${open.docs[0]!.get("code")}).`);

  const technicians = await resolveTechnicians(tid, p.technicianIds);
  const settings = await db.doc(`${col.settings(tid)}/general`).get();
  const prefix = (settings.get("workOrderPrefix") as string) || "OT";
  const counterRef = db.doc(`${col.counters(tid)}/workOrders`);
  const ref = db.collection(orderCol.workOrders(tid)).doc();
  const now = FieldValue.serverTimestamp();
  const v = vehicle.data()!;
  const c = customer.data()!;
  const status = p.status ?? "RECEIVED";
  const totals = p.fromQuote?.totals ?? { subtotal: 0, discount: 0, tax: 0, total: 0 };
  let code = "";

  await db.runTransaction(async (tx) => {
    const counter = await tx.get(counterRef);
    const number = (counter.exists ? (counter.get("next") as number) : 1001) || 1001;
    code = `${prefix}-${number}`;
    tx.set(counterRef, { next: number + 1 }, { merge: true });
    tx.set(ref, {
      number, code, status, isOpen: true,
      statusChangedAt: now, statusChangedBy: caller.uid,
      type: p.type, priority: p.priority, reason: p.reason,
      customerId, customer: { fullName: c.fullName, phone: c.phone, whatsapp: c.whatsapp || c.phone },
      vehicleId: p.vehicleId, vehicle: { make: v.make, model: v.model, year: v.year, color: v.color ?? "", plate: v.plate },
      technicianIds: technicians.map((t) => t.id), technicians,
      reception: { ...p.reception, receivedAt: now, receivedBy: caller.uid },
      diagnosis: { reportedProblem: p.reason, technicianDiagnosis: "", recommendations: "", observations: "", testsPerformed: "", obdCodes: [], completedAt: null, completedBy: null },
      qc: null,
      totals, paid: 0, balance: totals.total,
      activeQuoteId: p.fromQuote?.id ?? null,
      portalToken: p.portalToken ?? secureToken(), portalEnabled: true,
      promisedAt: p.promisedAt ? Timestamp.fromDate(new Date(p.promisedAt)) : null,
      deliveredAt: null, mileageOut: null, cancelReason: "", photoCount: 0,
      searchKeywords: buildSearchKeywords([code, String(number), v.plate, v.make, v.model, c.fullName, c.phone]),
      createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid,
    });
    tx.set(ref.collection("events").doc(), {
      type: "created",
      text: p.fromQuote ? `Vehículo recibido. Orden creada desde la cotización aprobada ${p.fromQuote.code}` : `Vehículo recibido. Motivo: ${p.reason}`,
      visibleToCustomer: true, channels: [], fromStatus: null, toStatus: status,
      actorId: caller.uid, actorName: name, at: now,
    });
  });

  await logMileage(vehicleRef, p.reception.mileageIn, "reception", caller, name, `Recepción ${code}`);
  return { orderId: ref.id, code };
}
