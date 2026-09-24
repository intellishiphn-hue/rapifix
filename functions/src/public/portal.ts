import { rateLimit, requestIp, requireAppCheck } from "../lib/rateLimit";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { orderCol, portalTokenSchema, quoteCol, respondQuoteSchema } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { buildPortal, buildQuotePortal } from "../lib/portal";
import { applyDecision } from "../lib/quoteDecision";


async function loadByToken(token: string) {
  const portal = await db.doc(`${quoteCol.portal}/${token}`).get();
  if (!portal.exists || portal.get("active") === false) throw new HttpsError("not-found", "Este link no es válido o ya expiró.");
  return { tid: portal.get("tid") as string, orderId: (portal.get("orderId") as string | null) ?? null, quoteId: (portal.get("quote.id") as string | undefined) ?? null };
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
  requireAppCheck(request);
  const input = parseInput(respondQuoteSchema, request.data);
  await rateLimit("respond", [input.token], 10, 600);
  await rateLimit("respond-ip", [requestIp(request)], 60, 600);
  const { tid, orderId, quoteId } = await loadByToken(input.token);
  if (!quoteId) throw new HttpsError("failed-precondition", "No hay una cotización pendiente.");
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const ip = clientIp(request.rawRequest as unknown as { headers: Record<string, unknown>; ip?: string });
  const userAgent = String(request.rawRequest.headers["user-agent"] ?? "").slice(0, 300) || null;
  // El nombre ya lo conocemos: no se le pide al cliente
  const quoteSnap = await quoteRef.get();
  const name = input.name?.trim() || String(quoteSnap.get("customerName") ?? "").trim() || "Cliente";
  const comment = input.comment?.trim() ?? "";

  if (input.action === "question") {
    if (!comment) throw new HttpsError("invalid-argument", "Escriba su pregunta.");
    const q = await quoteRef.get();
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    if (((q.get("questions") as unknown[]) ?? []).length >= 20) throw new HttpsError("resource-exhausted", "Límite de preguntas alcanzado. Contáctenos por WhatsApp.");
    await quoteRef.update({ questions: FieldValue.arrayUnion({ at: new Date(), text: comment, name }), updatedAt: FieldValue.serverTimestamp() });
    if (orderId) {
      const orderRef = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
      await orderRef.collection("events").add({
        type: "customer_update", text: `Pregunta sobre la cotización: ${comment}`, visibleToCustomer: false, channels: ["portal"],
        fromStatus: null, toStatus: null, actorId: "customer", actorName: `${name} (cliente)`, at: FieldValue.serverTimestamp(),
      });
    }
    return { result: "question" as const };
  }

  const res = await applyDecision(tid, quoteId, {
    approved: input.action === "approve", name, comment, channel: "portal", ip, userAgent, recordedBy: null, recordedByName: null,
  });
  return { result: input.action === "approve" ? "approved" : "rejected", approvalId: res.approvalId };
});

/** Marca la cotización como "Vista por el cliente" la primera vez que abre el portal. */
export const markQuoteViewed = onCall({ region: REGION }, async (request) => {
  requireAppCheck(request);
  const { token } = parseInput(portalTokenSchema, request.data);
  await rateLimit("viewed", [token], 30, 600);
  const { tid, orderId, quoteId } = await loadByToken(token);
  if (!quoteId) return { ok: true };
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const changed = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists || q.get("status") !== "sent") return false;
    tx.update(quoteRef, { status: "viewed", viewedAt: FieldValue.serverTimestamp() });
    if (!orderId) return true;
    tx.set(db.doc(`${orderCol.workOrders(tid)}/${orderId}`).collection("events").doc(), {
      type: "note", text: `El cliente abrió la cotización ${q.get("code")}`, visibleToCustomer: false, channels: [],
      fromStatus: null, toStatus: null, actorId: "customer", actorName: "Cliente", at: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (changed) {
    if (orderId) await buildPortal(tid, orderId);
    else await buildQuotePortal(tid, quoteId);
  }
  return { ok: true };
});
