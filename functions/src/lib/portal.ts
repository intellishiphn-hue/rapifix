import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  catalogCol, col, diffQuotes, orderCol, PORTAL_STEPS, publicDiff, quoteCol, RECEPTION_CHECKLIST, STATUS_META,
  type PublicPortal, type Quote, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "./admin";
import { bankList, latestProof } from "./publicWash";

const PERCENT: Record<WorkOrderStatus, number> = {
  RECEIVED: 10, INSPECTION: 20, DIAGNOSIS: 35, AWAITING_QUOTE: 40, QUOTE_SENT: 50, AWAITING_APPROVAL: 50,
  APPROVED: 60, IN_REPAIR: 65, WAITING_PARTS: 65, QUALITY_CONTROL: 85, READY: 100, DELIVERED: 100, CANCELLED: 0,
};

const publicQuote = (q: Quote): NonNullable<PublicPortal["quote"]> => ({
  id: q.id,
  code: q.code,
  status: q.status,
  items: q.items.map((it) => ({ type: it.type, description: it.description, qty: it.qty, unitPrice: it.unitPrice, discount: it.discount, lineTotal: it.lineTotal })),
  totals: q.totals,
  taxRate: q.taxRate,
  notes: q.notes,
  validUntil: q.validUntil,
  decidedAt: q.decision?.at ?? null,
});

/**
 * Actualización pendiente de una cotización aprobada (si el taller ya la envió al cliente).
 * Mientras no la apruebe, la vigente sigue siendo `approved`.
 */
function publicUpdate(approved: Quote, rev: Quote | null): PublicPortal["quoteUpdate"] {
  if (!rev || approved.status !== "approved" || !["sent", "viewed"].includes(rev.status)) return null;
  return { ...publicQuote(rev), changes: publicDiff(diffQuotes(approved, rev)) };
}
const asQuote = (snap: FirebaseFirestore.DocumentSnapshot | null) => (snap && snap.exists ? ({ id: snap.id, ...snap.data() } as Quote) : null);

/**
 * Construye la copia pública y sanitizada de la orden en publicPortal/{token}.
 * El portal NUNCA lee colecciones internas: solo este documento.
 * No incluye teléfono, identidad, dirección, costos ni notas internas.
 */
export async function buildPortal(tid: string, orderId: string): Promise<string | null> {
  // Todo se lee y escribe en una transacción: si la orden o la cotización cambian mientras
  // se arma el portal (por ejemplo, el cliente aprueba en ese instante), Firestore la repite
  // con los datos nuevos. Así una actualización vieja nunca pisa una más reciente.
  return db.runTransaction(async (tx) => {
  const orderSnap = await tx.get(db.doc(`${orderCol.workOrders(tid)}/${orderId}`));
  if (!orderSnap.exists) return null;
  const o = orderSnap.data()!;
  const token = o.portalToken as string | undefined;
  if (!token) return null;

  const [settings, events, photos, quoteSnap, roki, proofs] = await Promise.all([
    tx.get(db.doc(`${col.settings(tid)}/general`)),
    tx.get(orderSnap.ref.collection("events").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(30)),
    tx.get(orderSnap.ref.collection("photos").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(40)),
    o.activeQuoteId ? tx.get(db.doc(`${quoteCol.quotes(tid)}/${o.activeQuoteId}`)) : Promise.resolve(null),
    tx.get(db.doc(`${catalogCol.privateConfig(tid)}/roki`)),
    tx.get(db.collection(catalogCol.paymentProofs(tid)).where("orderId", "==", orderId).limit(30)),
  ]);
  const s = settings.data() ?? {};
  const onlineEnabled = !!roki.get("enabled") && !!roki.get("secretKey");
  const status = o.status as WorkOrderStatus;
  const step = STATUS_META[status].portalStep; // 0..7, -1 cancelado
  const finished = status === "READY" || status === "DELIVERED";
  const steps = PORTAL_STEPS.map((label, i) => ({
    label,
    done: finished ? true : i < step,
    current: !finished && i === step,
  }));
  const nextIdx = Math.min(step + 1, PORTAL_STEPS.length - 1);
  const nextStep = status === "READY" ? "Retiro del vehículo" : status === "DELIVERED" || status === "CANCELLED" ? "" : PORTAL_STEPS[nextIdx]!;

  const q = asQuote(quoteSnap);
  const rev = q?.status === "approved" && q.openRevisionId ? asQuote(await tx.get(db.doc(`${quoteCol.quotes(tid)}/${q.openRevisionId}`))) : null;
  const deliveredAt = o.deliveredAt as Timestamp | null;
  const expired = !!deliveredAt && Date.now() - deliveredAt.toMillis() > 30 * 86400000;

  const portal: Omit<PublicPortal, "updatedAt"> & { updatedAt: FirebaseFirestore.FieldValue } = {
    kind: "order",
    tid,
    orderId,
    orderCode: o.code,
    workshop: {
      name: s.name || "RAPIFIX",
      logoUrl: s.logoUrl || "",
      phone: s.phone || "",
      whatsapp: s.whatsapp || s.phone || "",
      address: s.address || "",
      city: s.city || "",
      hours: s.hours || "",
    },
    customerFirstName: String(o.customer?.fullName ?? "").split(" ")[0] ?? "",
    vehicle: { make: o.vehicle.make, model: o.vehicle.model, year: o.vehicle.year, color: o.vehicle.color ?? "", plate: o.vehicle.plate },
    status,
    statusLabel: STATUS_META[status].label,
    percent: PERCENT[status],
    steps,
    nextStep,
    cancelled: status === "CANCELLED",
    delivered: status === "DELIVERED",
    updates: events.docs.map((d) => ({ at: d.get("at"), text: String(d.get("text") ?? "").replace(/\s*\(demo\)$/, "") })),
    photos: photos.docs.map((d) => ({ url: d.get("url"), caption: d.get("caption") ?? "", stage: d.get("stage") ?? "" })),
    reception: o.reception
      ? {
          receivedAt: o.reception.receivedAt ?? o.createdAt ?? null,
          mileageIn: Number(o.reception.mileageIn ?? 0),
          mileageUnit: o.mileageUnit === "mi" ? "mi" : "km",
          fuelLevel: Number(o.reception.fuelLevel ?? 0),
          items: RECEPTION_CHECKLIST.filter((c) => o.reception.checklist?.[c.key]).map((c) => c.label),
          exteriorNotes: o.reception.exteriorNotes ?? "",
          interiorNotes: o.reception.interiorNotes ?? "",
          accessories: o.reception.accessories ?? "",
          otherObjects: o.reception.otherObjects ?? "",
        }
      : null,
    diagnosis: o.diagnosis?.completedAt
      ? { summary: o.diagnosis.technicianDiagnosis ?? "", recommendations: o.diagnosis.recommendations ?? "" }
      : null,
    quote: q && q.status !== "draft" ? publicQuote(q) : null,
    quoteUpdate: q ? publicUpdate(q, rev) : null,
    active: o.portalEnabled !== false && !expired,
    onlinePayment: {
      enabled: onlineEnabled && status !== "CANCELLED",
      balance: Number(o.balance ?? 0),
      total: Number(o.totals?.total ?? 0),
      paid: Number(o.paid ?? 0),
    },
    banks: bankList(s),
    proof: latestProof(proofs.docs),
    updatedAt: FieldValue.serverTimestamp(),
  };
  tx.set(db.doc(`${quoteCol.portal}/${token}`), portal);
  return token;
  });
}

function workshopInfo(s: FirebaseFirestore.DocumentData) {
  return {
    name: s.name || "RAPIFIX", logoUrl: s.logoUrl || "", phone: s.phone || "", whatsapp: s.whatsapp || s.phone || "",
    address: s.address || "", city: s.city || "", hours: s.hours || "",
  };
}

/** Portal de una cotización directa (sin orden): solo muestra la cotización para aprobar. */
export async function buildQuotePortal(tid: string, quoteId: string): Promise<string | null> {
  return db.runTransaction(async (tx) => {
  const snap = await tx.get(db.doc(`${quoteCol.quotes(tid)}/${quoteId}`));
  if (!snap.exists) return null;
  const asked = { id: snap.id, ...snap.data() } as Quote;
  if (!asked.publicToken || asked.orderId) return asked.publicToken ?? null;
  // Todas las versiones comparten el link. Si hay una aprobada vigente, esa es la que se muestra;
  // su modificación (si ya se envió) va aparte como "actualización pendiente".
  const quoteDoc = (id: string) => tx.get(db.doc(`${quoteCol.quotes(tid)}/${id}`));
  let q = asked;
  let rev: Quote | null = null;
  if (asked.status === "approved") {
    rev = asked.openRevisionId ? asQuote(await quoteDoc(asked.openRevisionId)) : null;
  } else if (asked.revisionOf) {
    const base = asQuote(await quoteDoc(asked.revisionOf));
    if (base?.status === "approved") {
      q = base;
      rev = asked;
    }
  }
  const [settings, vehicle] = await Promise.all([
    tx.get(db.doc(`${col.settings(tid)}/general`)),
    q.vehicleId ? tx.get(db.doc(`${col.vehicles(tid)}/${q.vehicleId}`)) : Promise.resolve(null),
  ]);
  const v = vehicle?.data();
  const portal = {
    kind: "quote",
    tid,
    orderId: null,
    orderCode: q.code,
    workshop: workshopInfo(settings.data() ?? {}),
    customerFirstName: (q.customerName ?? "").split(" ")[0] ?? "",
    vehicle: { make: v?.make ?? "", model: v?.model ?? q.vehicleLabel, year: v?.year ?? 0, color: v?.color ?? "", plate: q.plate },
    status: "RECEIVED",
    statusLabel: "Cotización",
    percent: 0,
    steps: [],
    nextStep: "",
    cancelled: false,
    delivered: false,
    updates: [],
    photos: [],
    diagnosis: null,
    reception: null,
    quote: q.status === "draft" ? null : publicQuote(q),
    quoteUpdate: publicUpdate(q, rev),
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  };
  tx.set(db.doc(`${quoteCol.portal}/${q.publicToken}`), portal);
  return q.publicToken ?? null;
  });
}
