import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import {
  consumedByItem, formatMoney, orderCol, quoteCol, stockImpact, stockNoticeText, DECISION_CHANNEL_LABELS,
  type DecisionChannel, type DiffItem, type WorkOrderStatus,
} from "@rapifix/shared";
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

    // ----- ¿Modifica una cotización ya aprobada? -----
    // Se buscan TODAS las aprobadas de la orden (debe quedar una sola): la que esta versión reemplaza.
    const quotes = db.collection(quoteCol.quotes(tid));
    const revisionOf = (q.get("revisionOf") as string | null) ?? null;
    const baseSnap = revisionOf ? await tx.get(quotes.doc(revisionOf)) : null;
    const approvedNow = orderId
      ? (await tx.get(quotes.where("orderId", "==", orderId).where("status", "==", "approved"))).docs.filter((x) => x.id !== quoteId)
      : baseSnap?.exists && baseSnap.get("status") === "approved" ? [baseSnap] : [];
    const isRevision = !!revisionOf || approvedNow.length > 0;
    const base = approvedNow.find((x) => x.id === revisionOf) ?? (revisionOf ? null : approvedNow[0] ?? null);
    if (d.approved && isRevision && !base) {
      throw new HttpsError("failed-precondition", "Esta actualización ya no corresponde a la cotización vigente. Pida al taller una nueva.");
    }

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
    const via = d.channel === "portal" ? "" : ` (${DECISION_CHANNEL_LABELS[d.channel].toLowerCase()}, registrada por ${d.recordedByName})`;
    const actor = { actorId: d.recordedBy ?? "customer", actorName: d.recordedByName ?? `${d.name} (cliente)`, at: FieldValue.serverTimestamp() };
    const label = `${q.get("code")}${Number(q.get("version") ?? 1) > 1 ? ` v${q.get("version")}` : ""}`;

    if (isRevision) {
      const newTotal = (q.get("totals") as { total: number }).total;
      if (d.approved) {
        // En la misma transacción: la aprobada anterior queda "Reemplazada" y esta pasa a ser la única aprobada.
        for (const prev of approvedNow) {
          tx.update(prev.ref, { status: "superseded", supersededBy: quoteId, supersededAt: FieldValue.serverTimestamp(), openRevisionId: null, updatedAt: FieldValue.serverTimestamp() });
        }
      } else if (baseSnap?.exists && baseSnap.get("openRevisionId") === quoteId) {
        tx.update(baseSnap.ref, { openRevisionId: null });
      }
      if (orderRef && o?.exists) {
        const event = (text: string, visibleToCustomer: boolean) =>
          tx.set(orderRef.collection("events").doc(), {
            type: visibleToCustomer ? "customer_update" : "note", text, visibleToCustomer, channels: visibleToCustomer ? ["portal"] : [],
            fromStatus: null, toStatus: null, ...actor,
          });
        if (d.approved && base) {
          // La orden pasa a usar la versión nueva. Su estado NO cambia y los pagos se conservan.
          const paid = Number(o.get("paid") ?? 0);
          const upd: Record<string, unknown> = { activeQuoteId: quoteId, totals: q.get("totals"), balance: newTotal - paid, updatedAt: FieldValue.serverTimestamp() };
          // Repuestos que ya salieron del inventario: la marca pasa a la línea de la versión nueva (para no descontar dos veces)
          const consumed = (o.get("consumed") as Record<string, { qty: number }> | undefined) ?? {};
          const impact = stockImpact(base.get("items") as DiffItem[], q.get("items") as DiffItem[], consumedByItem(consumed, base.id));
          for (const itemId of impact.carry) upd[`consumed.${quoteId}_${itemId}`] = consumed[`${base.id}_${itemId}`];
          tx.update(orderRef, upd);
          const before = formatMoney((base.get("totals") as { total: number }).total);
          event(`Actualización de cotización aprobada por ${d.name}: nuevo total ${formatMoney(newTotal)} (antes ${before})${via}${d.comment ? `. Comentario: ${d.comment}` : ""}`, true);
          if (paid > newTotal) event(`Saldo a favor del cliente de ${formatMoney(paid - newTotal)}: revisar devolución.`, false);
          for (const n of impact.notices) event(stockNoticeText(n), false);
        } else {
          // Rechazo: la orden no retrocede y sigue vigente la cotización aprobada anterior.
          tx.update(orderRef, { updatedAt: FieldValue.serverTimestamp() });
          event(`El cliente no aprobó la actualización de la cotización ${label}; sigue vigente la cotización anterior${via}${d.comment ? `. Motivo: ${d.comment}` : ""}`, true);
        }
      }
      return { orderId, approvalId, portalQuoteId: d.approved ? quoteId : revisionOf ?? quoteId };
    }

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
      tx.set(orderRef.collection("events").doc(), {
        type: to ? "status_change" : "customer_update",
        text: d.approved
          ? `Cotización ${q.get("code")} aprobada por ${d.name} (${total})${via}${d.comment ? `. Comentario: ${d.comment}` : ""}`
          : `Cotización ${q.get("code")} rechazada por ${d.name}${via}${d.comment ? `. Motivo: ${d.comment}` : ""}`,
        visibleToCustomer: true, channels: ["portal"], fromStatus: to ? from : null, toStatus: to,
        ...actor,
      });
    }
    return { orderId, approvalId, portalQuoteId: quoteId };

  });

  if (res.orderId) await buildPortal(tid, res.orderId);
  else await buildQuotePortal(tid, res.portalQuoteId);
  return { orderId: res.orderId, approvalId: res.approvalId };
}
