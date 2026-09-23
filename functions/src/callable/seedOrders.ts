import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { buildSearchKeywords, col, EMPTY_RECEPTION, isOpenStatus, orderCol, STATUS_META, type WorkOrderStatus } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { secureToken } from "../lib/token";

const DEMO: Array<{ status: WorkOrderStatus; reason: string; diag?: string; days: number; obd?: string[] }> = [
  { status: "RECEIVED", reason: "Ruido metálico al frenar", days: 0 },
  { status: "DIAGNOSIS", reason: "Luz de check engine encendida y tironeo al acelerar", days: 1, obd: ["P0300", "P0302"] },
  { status: "AWAITING_APPROVAL", reason: "Vibración en el volante a más de 80 km/h", diag: "Discos delanteros deformados y balanceo necesario", days: 2 },
  { status: "IN_REPAIR", reason: "Mantenimiento de 60,000 km", diag: "Cambio de aceite, filtros, bujías y revisión de frenos", days: 3 },
  { status: "READY", reason: "Aire acondicionado no enfría", diag: "Fuga en manguera de alta presión. Se reemplazó y recargó gas", days: 5 },
];

/** Crea órdenes de demostración en distintos estados usando los vehículos existentes. */
export const seedDemoOrders = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const tid = caller.tid;
  const flagRef = db.doc(`tenants/${tid}/meta/demoOrders`);
  if ((await flagRef.get()).exists) throw new HttpsError("already-exists", "Las órdenes demo ya fueron cargadas.");

  const vehicles = await db.collection(col.vehicles(tid)).where("archived", "==", false).limit(DEMO.length).get();
  if (vehicles.empty) throw new HttpsError("failed-precondition", "Primero cargue los clientes y vehículos demo.");
  const name = await actorName(caller.uid, caller.email);
  const counterRef = db.doc(`${col.counters(tid)}/workOrders`);

  let created = 0;
  for (let i = 0; i < vehicles.docs.length; i++) {
    const vDoc = vehicles.docs[i]!;
    const demo = DEMO[i]!;
    const open = await db.collection(orderCol.workOrders(tid)).where("vehicleId", "==", vDoc.id).where("isOpen", "==", true).limit(1).get();
    if (!open.empty) continue;
    const v = vDoc.data();
    const c = (await db.doc(`${col.customers(tid)}/${v.customerId}`).get()).data();
    if (!c) continue;
    const ref = db.collection(orderCol.workOrders(tid)).doc();
    const when = Timestamp.fromMillis(Date.now() - demo.days * 86400000);

    await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const number = (counter.exists ? (counter.get("next") as number) : 1001) || 1001;
      const code = `OT-${number}`;
      tx.set(counterRef, { next: number + 1 }, { merge: true });
      tx.set(ref, {
        number, code, status: demo.status, isOpen: isOpenStatus(demo.status),
        statusChangedAt: when, statusChangedBy: caller.uid, type: i === 3 ? "maintenance" : "repair", priority: i === 1 ? "high" : "normal",
        reason: demo.reason, customerId: v.customerId,
        customer: { fullName: c.fullName, phone: c.phone, whatsapp: c.whatsapp || c.phone },
        vehicleId: vDoc.id, vehicle: { make: v.make, model: v.model, year: v.year, color: v.color ?? "", plate: v.plate },
        technicianIds: [], technicians: [],
        reception: { ...EMPTY_RECEPTION, mileageIn: v.mileage, receivedAt: when, receivedBy: caller.uid },
        diagnosis: { reportedProblem: demo.reason, technicianDiagnosis: demo.diag ?? "", recommendations: "", observations: "", testsPerformed: "", obdCodes: demo.obd ?? [], completedAt: demo.diag ? when : null, completedBy: demo.diag ? caller.uid : null },
        qc: demo.status === "READY" ? { checklist: {}, notes: "", passedAt: when, passedBy: caller.uid } : null,
        totals: { subtotal: 0, discount: 0, tax: 0, total: 0 }, paid: 0, balance: 0,
        portalToken: secureToken(), portalEnabled: true, promisedAt: null, deliveredAt: null, mileageOut: null, cancelReason: "", photoCount: 0,
        searchKeywords: buildSearchKeywords([code, String(number), v.plate, v.make, v.model, c.fullName, c.phone]),
        createdAt: when, createdBy: caller.uid, updatedAt: when, updatedBy: caller.uid,
      });
      const ev = { actorId: caller.uid, actorName: name, channels: [], at: when };
      tx.set(ref.collection("events").doc(), { ...ev, type: "created", text: `Vehículo recibido. Motivo: ${demo.reason}`, fromStatus: null, toStatus: "RECEIVED", visibleToCustomer: true });
      if (demo.status !== "RECEIVED") {
        tx.set(ref.collection("events").doc(), { ...ev, at: FieldValue.serverTimestamp(), type: "status_change", text: `Recibido → ${STATUS_META[demo.status].label} (demo)`, fromStatus: "RECEIVED", toStatus: demo.status, visibleToCustomer: true });
      }
    });
    created++;
  }
  await flagRef.set({ at: FieldValue.serverTimestamp(), by: caller.uid });
  return { orders: created };
});
