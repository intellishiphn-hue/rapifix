import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { formatMoney, orderCol, quoteCol, DECISION_CHANNEL_LABELS, type DecisionChannel, type WorkOrderStatus } from "@rapifix/shared";
import { db } from "./admin";
import { buildPortal, buildQuotePortal } from "./portal";

const APPROVABLE_FROM: WorkOrderStatus[] = ["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE", "QUOTE_SENT", "AWAITING_APPROVAL"];

export interface DecisionInput {
  approved: boolean;
  name: string;
  comment: string;
  channel: DecisionChannel;
  ip: string | null;
  userAgent: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
}

/**
 * Aplica la aprobación o rechazo de una cotización (desde el link del cliente o
 * registrada por el taller). Si la cotización pertenece a una orden, la orden avanza sola.
 */
export async function applyDecision(tid: string, quoteId: string, d: DecisionInput) {
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const res = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    const status = q.get("status") as string;
    if (!["sent", "viewed"].includes(status)) {
      throw new HttpsError("failed-precondition", status === "approved" ? "Esta cotización ya fue aprobada." : status === "draft" ? "Primero envíe la cotización." : "Esta cotización ya no está disponible para responder.");
    }
    const validUntil = q.get("validUntil") as FirebaseFirestore.Timestamp | null;
    if (!d.recordedBy && validUntil && validUntil.toMillis() < Date.now()) {
      tx.update(quoteRef, { status: "expired" });
      throw new HttpsError("deadline-exceeded", "La cotización expiró. Contáctenos para actualizarla.");
    }
    const orderId = (q.get("orderId") as string | null) ?? null;
    const orderRef = orderId ? db.doc(`${orderCol.workOrders(tid)}/${orderId}`) : null;
    const o = orderRef ? await tx.get(orderRef) : null;

    const approvalId = randomUUID();
    tx.update(quoteRef, {
      status: d.approved ? "approved" : "rejected",
      decision: {
        result: d.approved ? "approved" : "rejected", at: FieldValue.serverTimestamp(), approvalId,
        ip: d.ip, userAgent: d.userAgent, name: d.name, comment: d.comment, channel: d.channel,
        recordedBy: d.recordedBy, recordedByName: d.recordedByName,
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: d.recordedBy ?? "customer",
    });

    if (orderRef && o?.exists) {
      const from = o.get("status") as WorkOrderStatus;
      const upd: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      let to: WorkOrderStatus | null = null;
      if (o.get("isOpen") && APPROVABLE_FROM.includes(from)) {
        to = d.approved ? "APPROVED" : "AWAITING_QUOTE";
        upd.status = to;
        upd.statusChangedAt = FieldValue.serverTimestamp();
        upd.statusChangedBy = d.recordedBy ?? "customer";
      }
      tx.update(orderRef, upd);
      const total = formatMoney((q.get("totals") as { total: number }).total);
      const via = d.channel === "portal" ? "" : ` (${DECISION_CHANNEL_LABELS[d.channel].toLowerCase()}, registrada por ${d.recordedByName})`;
      tx.set(orderRef.collection("events").doc(), {
        type: to ? "status_change" : "customer_update",
        text: d.approved
          ? `Cotización ${q.get("code")} aprobada por ${d.name} (${total})${via}${d.comment ? `. Comentario: ${d.comment}` : ""}`
          : `Cotización ${q.get("code")} rechazada por ${d.name}${via}${d.comment ? `. Motivo: ${d.comment}` : ""}`,
        visibleToCustomer: true, channels: ["portal"], fromStatus: to ? from : null, toStatus: to,
        actorId: d.recordedBy ?? "customer", actorName: d.recordedByName ?? `${d.name} (cliente)`, at: FieldValue.serverTimestamp(),
      });
    }
    return { orderId, approvalId };
  });

  if (res.orderId) await buildPortal(tid, res.orderId);
  else await buildQuotePortal(tid, quoteId);
  return res;
}
