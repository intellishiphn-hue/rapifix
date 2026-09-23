import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { formatMoney, orderCol, portalTokenSchema, quoteCol, respondQuoteSchema, type WorkOrderStatus } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { buildPortal } from "../lib/portal";

const APPROVABLE_FROM: WorkOrderStatus[] = ["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE", "QUOTE_SENT", "AWAITING_APPROVAL"];

async function loadByToken(token: string) {
  const portal = await db.doc(`${quoteCol.portal}/${token}`).get();
  if (!portal.exists || portal.get("active") === false) throw new HttpsError("not-found", "Este link no es válido o ya expiró.");
  return { tid: portal.get("tid") as string, orderId: portal.get("orderId") as string, quoteId: (portal.get("quote.id") as string | undefined) ?? null };
}

function clientIp(raw: { headers: Record<string, unknown>; ip?: string }): string | null {
  const fwd = raw.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : typeof fwd === "string" ? fwd : "")?.split(",")[0]?.trim();
  return first || raw.ip || null;
}

/**
 * Respuesta del cliente desde el portal público (sin cuenta): aprobar, rechazar o preguntar.
 * Guarda fecha y hora del servidor, identificador de aprobación, IP y navegador.
 */
export const respondToQuote = onCall({ region: REGION }, async (request) => {
  const input = parseInput(respondQuoteSchema, request.data);
  const { tid, orderId, quoteId } = await loadByToken(input.token);
  if (!quoteId) throw new HttpsError("failed-precondition", "No hay una cotización pendiente.");
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const orderRef = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
  const ip = clientIp(request.rawRequest as unknown as { headers: Record<string, unknown>; ip?: string });
  const userAgent = String(request.rawRequest.headers["user-agent"] ?? "").slice(0, 300) || null;
  const name = input.name?.trim() || "Cliente";
  const comment = input.comment?.trim() ?? "";

  const res = await db.runTransaction(async (tx) => {
    const [q, o] = await Promise.all([tx.get(quoteRef), tx.get(orderRef)]);
    if (!q.exists || !o.exists) throw new HttpsError("not-found", "La cotización no existe.");
    const status = q.get("status") as string;
    const event = (text: string, visible: boolean, extra: Record<string, unknown> = {}) =>
      tx.set(orderRef.collection("events").doc(), {
        type: "customer_update", text, visibleToCustomer: visible, channels: ["portal"], fromStatus: null, toStatus: null,
        actorId: "customer", actorName: `${name} (cliente)`, at: FieldValue.serverTimestamp(), ...extra,
      });

    if (input.action === "question") {
      if (!comment) throw new HttpsError("invalid-argument", "Escriba su pregunta.");
      if (((q.get("questions") as unknown[]) ?? []).length >= 20) throw new HttpsError("resource-exhausted", "Límite de preguntas alcanzado. Contáctenos por WhatsApp.");
      tx.update(quoteRef, { questions: FieldValue.arrayUnion({ at: new Date(), text: comment, name }) });
      event(`Pregunta sobre la cotización: ${comment}`, false);
      tx.update(orderRef, { updatedAt: FieldValue.serverTimestamp() });
      return { result: "question" as const };
    }

    if (!["sent", "viewed"].includes(status)) {
      throw new HttpsError("failed-precondition", status === "approved" ? "Esta cotización ya fue aprobada." : "Esta cotización ya no está disponible para responder.");
    }
    const validUntil = q.get("validUntil") as FirebaseFirestore.Timestamp | null;
    if (validUntil && validUntil.toMillis() < Date.now()) {
      tx.update(quoteRef, { status: "expired" });
      throw new HttpsError("deadline-exceeded", "La cotización expiró. Contáctenos para actualizarla.");
    }

    const approved = input.action === "approve";
    const approvalId = randomUUID();
    tx.update(quoteRef, {
      status: approved ? "approved" : "rejected",
      decision: { result: approved ? "approved" : "rejected", at: FieldValue.serverTimestamp(), approvalId, ip, userAgent, name, comment },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "customer",
    });

    const from = o.get("status") as WorkOrderStatus;
    const orderUpdate: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    let to: WorkOrderStatus | null = null;
    if (o.get("isOpen") && APPROVABLE_FROM.includes(from)) {
      to = approved ? "APPROVED" : "AWAITING_QUOTE";
      orderUpdate.status = to;
      orderUpdate.statusChangedAt = FieldValue.serverTimestamp();
      orderUpdate.statusChangedBy = "customer";
    }
    tx.update(orderRef, orderUpdate);
    const total = formatMoney((q.get("totals") as { total: number }).total);
    event(
      approved ? `Cotización ${q.get("code")} aprobada por el cliente (${total})${comment ? `. Comentario: ${comment}` : ""}` : `Cotización ${q.get("code")} rechazada por el cliente${comment ? `. Motivo: ${comment}` : ""}`,
      true,
      { type: to ? "status_change" : "customer_update", fromStatus: to ? from : null, toStatus: to },
    );
    return { result: approved ? ("approved" as const) : ("rejected" as const), approvalId };
  });

  await buildPortal(tid, orderId);
  return res;
});

/** Marca la cotización como "Vista por el cliente" la primera vez que abre el portal. */
export const markQuoteViewed = onCall({ region: REGION }, async (request) => {
  const { token } = parseInput(portalTokenSchema, request.data);
  const { tid, orderId, quoteId } = await loadByToken(token);
  if (!quoteId) return { ok: true };
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const changed = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists || q.get("status") !== "sent") return false;
    tx.update(quoteRef, { status: "viewed", viewedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`${orderCol.workOrders(tid)}/${orderId}`).collection("events").doc(), {
      type: "note", text: `El cliente abrió la cotización ${q.get("code")}`, visibleToCustomer: false, channels: [],
      fromStatus: null, toStatus: null, actorId: "customer", actorName: "Cliente", at: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (changed) await buildPortal(tid, orderId);
  return { ok: true };
});
