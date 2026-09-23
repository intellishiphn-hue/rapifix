import { logger } from "firebase-functions/v2";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { catalogCol, onlinePayStartSchema, orderCol, portalTokenSchema, quoteCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { applyOnlinePayment, markOnlinePayment } from "../lib/onlinePayments";
import { getRokiConfig, hondurasTime, rokiRequest, toDecimal, verifyRokiSignature, type RokiPayment } from "../lib/roki";

const PROJECT = process.env.GCLOUD_PROJECT ?? "";
const ALLOWED_ORIGINS = [`https://${PROJECT}.web.app`, `https://${PROJECT}.firebaseapp.com`, "http://localhost:5173"];

async function loadPortal(token: string) {
  const portal = await db.doc(`${quoteCol.portal}/${token}`).get();
  if (!portal.exists || portal.get("active") === false || portal.get("kind") === "quote" || !portal.get("orderId")) {
    throw new HttpsError("not-found", "Este link no es válido para pagos.");
  }
  return { tid: portal.get("tid") as string, orderId: portal.get("orderId") as string };
}

/** Crea (o reutiliza) el cobro en ROKI por el saldo de la orden y devuelve el link de pago. Público. */
export const createOnlinePayment = onCall({ region: REGION }, async (request) => {
  const input = parseInput(onlinePayStartSchema, request.data);
  const origin = input.origin.replace(/\/$/, "");
  if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpsError("permission-denied", "Origen no permitido.");
  const { tid, orderId } = await loadPortal(input.token);
  const cfg = await getRokiConfig(tid);
  if (!cfg?.enabled || !cfg.secretKey) throw new HttpsError("failed-precondition", "Los pagos en línea no están activos. Contacte al taller.");

  const order = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  if (!order.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (order.get("status") === "CANCELLED") throw new HttpsError("failed-precondition", "La orden está cancelada.");
  const balance = Number(order.get("balance") ?? 0);
  if (balance <= 0) throw new HttpsError("failed-precondition", "Esta orden no tiene saldo pendiente.");

  // Reutiliza un link vigente por el mismo monto (evita cobros duplicados por doble clic)
  const opsCol = db.collection(catalogCol.onlinePayments(tid));
  const pending = await opsCol.where("orderId", "==", orderId).where("status", "==", "pending").get();
  const reusable = pending.docs.find((d) => d.get("amount") === balance && (d.get("expiresAt") as Timestamp).toMillis() > Date.now() + 10 * 60000);
  if (reusable) return { checkoutUrl: reusable.get("checkoutUrl") as string };

  const opRef = opsCol.doc();
  const expires = new Date(Date.now() + 60 * 60000);
  await opRef.set({
    orderId, orderCode: order.get("code"), amount: balance, status: "creating", rokiPaymentId: null, transactionId: null,
    checkoutUrl: "", serviceFee: 0, paymentId: null, error: "", expiresAt: Timestamp.fromDate(expires),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  const portalUrl = `${origin}/orden/${input.token}`;
  const phone = String(order.get("customer.whatsapp") || order.get("customer.phone") || "");
  const v = order.get("vehicle") ?? {};
  try {
    const p = await rokiRequest<RokiPayment>(cfg.secretKey, "POST", "/payments", {
      amount: toDecimal(balance),
      currency_code: "340",
      external_reference: `${tid}:${order.get("code")}`,
      name: `Orden ${order.get("code")}`,
      description: `${v.make ?? ""} ${v.model ?? ""} ${v.year ?? ""} (${v.plate ?? ""}) · saldo de la orden`.trim(),
      metadata: { tid, orderId, orderCode: String(order.get("code")), onlinePaymentId: opRef.id },
      success_url: `${portalUrl}?pago=ok`,
      cancel_url: `${portalUrl}?pago=cancelado`,
      expires_at: hondurasTime(expires),
      customer: { name: String(order.get("customer.fullName") ?? ""), ...(phone ? { phone } : {}) },
      lock_customer_fields: false,
      reusable: false,
      service_fee_enabled: cfg.serviceFee,
    }, `rapifix-${tid}-${opRef.id}`);
    await opRef.update({ status: "pending", rokiPaymentId: p.id, checkoutUrl: p.checkout_url, updatedAt: FieldValue.serverTimestamp() });
    return { checkoutUrl: p.checkout_url };
  } catch (err) {
    await opRef.update({ status: "error", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
});

/** Al regresar del pago, consulta a ROKI directamente (no se confía en la redirección). Público. */
export const checkOnlinePayment = onCall({ region: REGION }, async (request) => {
  const { token } = parseInput(portalTokenSchema, request.data);
  const { tid, orderId } = await loadPortal(token);
  const cfg = await getRokiConfig(tid);
  if (!cfg?.secretKey) return { status: "disabled" };
  const ops = await db.collection(catalogCol.onlinePayments(tid)).where("orderId", "==", orderId).where("status", "==", "pending").get();
  let status = "pending";
  for (const op of ops.docs) {
    const id = op.get("rokiPaymentId") as number | null;
    if (!id) continue;
    const p = await rokiRequest<RokiPayment>(cfg.secretKey, "GET", `/payments/${id}`);
    if (p.status === "paid") {
      await applyOnlinePayment(tid, op.id, p);
      status = "paid";
    } else if (p.status === "expired" || p.status === "disabled") {
      await markOnlinePayment(tid, op.id, "expired", p);
    }
  }
  return { status };
});

function routeEvent(type: string): "paid" | "failed" | "expired" | "voided" | "refunded" | null {
  switch (type) {
    case "payment.approved": return "paid";
    case "payment.failed": return "failed";
    case "payment.expired": return "expired";
    case "payment.voided": return "voided";
    case "payment.refunded": return "refunded";
    default: return null;
  }
}

/**
 * Webhook de ROKI (confirmación oficial del cobro). Registrar esta URL en el portal de ROKI:
 * https://us-central1-<proyecto>.cloudfunctions.net/rokiWebhook
 * Firma HMAC sobre el cuerpo crudo, deduplicación por id de evento, respuesta rápida.
 */
export const rokiWebhook = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  const raw = req.rawBody;
  let event: { id?: string; type?: string; data?: RokiPayment };
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }
  const data = event.data;
  const meta = (data && !Array.isArray(data.metadata) ? data.metadata : {}) as Record<string, string>;
  const tid = meta.tid;
  const onlinePaymentId = meta.onlinePaymentId;
  if (!tid || !/^[a-z0-9-]{2,40}$/.test(tid)) {
    // Evento que no es de RAPIFIX (u otra app en la misma cuenta): se acepta y se ignora.
    res.status(200).send("ignored");
    return;
  }
  const cfg = await getRokiConfig(tid);
  if (!cfg?.webhookSecret || !verifyRokiSignature(raw, req.get("ROKI-Signature"), cfg.webhookSecret)) {
    logger.warn("ROKI webhook con firma inválida", { tid, type: event.type });
    res.status(400).send("Invalid signature");
    return;
  }
  const eventId = String(req.get("ROKI-Webhook-Event-Id") ?? event.id ?? "");
  const eventRef = db.doc(`${catalogCol.rokiEvents(tid)}/${eventId}`);
  try {
    await eventRef.create({ type: event.type ?? "", rokiPaymentId: data?.id ?? null, onlinePaymentId: onlinePaymentId ?? null, receivedAt: FieldValue.serverTimestamp() });
  } catch {
    res.status(200).send("duplicate");
    return;
  }
  await db.doc(`${catalogCol.privateConfig(tid)}/roki`).set({ lastEventAt: FieldValue.serverTimestamp() }, { merge: true });

  const status = routeEvent(String(event.type));
  try {
    if (status && onlinePaymentId && data) {
      if (status === "paid") await applyOnlinePayment(tid, onlinePaymentId, data);
      else await markOnlinePayment(tid, onlinePaymentId, status, data);
    }
    res.status(200).send("ok");
  } catch (err) {
    logger.error("ROKI webhook: error procesando", { tid, eventId, err: String(err) });
    await eventRef.delete().catch(() => undefined); // permitir que el reintento de ROKI lo procese
    res.status(500).send("error");
  }
});

/** Respaldo: cada 15 minutos consulta los cobros pendientes por si se perdió algún webhook. */
export const reconcileOnlinePayments = onSchedule({ region: REGION, schedule: "every 15 minutes", timeZone: "America/Tegucigalpa" }, async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - 5 * 60000);
  const pend = await db.collectionGroup("onlinePayments").where("status", "==", "pending").where("createdAt", "<=", cutoff).limit(50).get();
  for (const op of pend.docs) {
    const tid = op.ref.parent.parent?.id;
    const id = op.get("rokiPaymentId") as number | null;
    if (!tid || !id) continue;
    const cfg = await getRokiConfig(tid);
    if (!cfg?.secretKey) continue;
    try {
      const p = await rokiRequest<RokiPayment>(cfg.secretKey, "GET", `/payments/${id}`);
      if (p.status === "paid") await applyOnlinePayment(tid, op.id, p);
      else if (p.status === "expired" || p.status === "disabled") await markOnlinePayment(tid, op.id, "expired", p);
      else if ((op.get("expiresAt") as Timestamp).toMillis() < Date.now() - 3 * 3600000) await markOnlinePayment(tid, op.id, "expired", p);
    } catch (err) {
      logger.warn("Conciliación ROKI falló para un cobro", { tid, op: op.id, err: String(err) });
    }
  }
});
