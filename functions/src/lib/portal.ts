import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  col, orderCol, PORTAL_STEPS, quoteCol, STATUS_META,
  type PublicPortal, type Quote, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "./admin";

const PERCENT: Record<WorkOrderStatus, number> = {
  RECEIVED: 10, INSPECTION: 20, DIAGNOSIS: 35, AWAITING_QUOTE: 40, QUOTE_SENT: 50, AWAITING_APPROVAL: 50,
  APPROVED: 60, IN_REPAIR: 65, WAITING_PARTS: 65, QUALITY_CONTROL: 85, READY: 100, DELIVERED: 100, CANCELLED: 0,
};

/**
 * Construye la copia pública y sanitizada de la orden en publicPortal/{token}.
 * El portal NUNCA lee colecciones internas: solo este documento.
 * No incluye teléfono, identidad, dirección, costos ni notas internas.
 */
export async function buildPortal(tid: string, orderId: string): Promise<string | null> {
  const orderSnap = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  if (!orderSnap.exists) return null;
  const o = orderSnap.data()!;
  const token = o.portalToken as string | undefined;
  if (!token) return null;

  const [settings, events, photos, quoteSnap] = await Promise.all([
    db.doc(`${col.settings(tid)}/general`).get(),
    orderSnap.ref.collection("events").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(30).get(),
    orderSnap.ref.collection("photos").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(40).get(),
    o.activeQuoteId ? db.doc(`${quoteCol.quotes(tid)}/${o.activeQuoteId}`).get() : Promise.resolve(null),
  ]);
  const s = settings.data() ?? {};
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

  const q = quoteSnap && quoteSnap.exists ? ({ id: quoteSnap.id, ...quoteSnap.data() } as Quote) : null;
  const deliveredAt = o.deliveredAt as Timestamp | null;
  const expired = !!deliveredAt && Date.now() - deliveredAt.toMillis() > 30 * 86400000;

  const portal: Omit<PublicPortal, "updatedAt"> & { updatedAt: FirebaseFirestore.FieldValue } = {
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
    diagnosis: o.diagnosis?.completedAt
      ? { summary: o.diagnosis.technicianDiagnosis ?? "", recommendations: o.diagnosis.recommendations ?? "" }
      : null,
    quote: q && q.status !== "draft"
      ? {
          id: q.id,
          code: q.code,
          status: q.status,
          items: q.items.map((it) => ({ type: it.type, description: it.description, qty: it.qty, unitPrice: it.unitPrice, discount: it.discount, lineTotal: it.lineTotal })),
          totals: q.totals,
          taxRate: q.taxRate,
          notes: q.notes,
          validUntil: q.validUntil,
          decidedAt: q.decision?.at ?? null,
        }
      : null,
    active: o.portalEnabled !== false && !expired,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc(`${quoteCol.portal}/${token}`).set(portal);
  return token;
}
