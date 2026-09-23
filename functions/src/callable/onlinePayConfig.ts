import { onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, onlinePayConfigSchema, orderCol } from "@rapifix/shared";
import { buildPortal } from "../lib/portal";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";

const webhookUrl = () => `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/rokiWebhook`;

/**
 * Configuración de pagos en línea. Las llaves se guardan en tenants/{tid}/private/roki, que las
 * reglas de Firestore no dejan leer a nadie: solo las usa el servidor. Nunca se devuelven al panel.
 */
export const getOnlinePayConfig = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const snap = await db.doc(`${catalogCol.privateConfig(caller.tid)}/roki`).get();
  const d = snap.data() ?? {};
  const key = String(d.secretKey ?? "");
  return {
    enabled: !!d.enabled,
    serviceFee: !!d.serviceFee,
    environment: key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : null,
    keyLast4: key ? key.slice(-4) : "",
    hasWebhookSecret: !!d.webhookSecret,
    webhookUrl: webhookUrl(),
    lastEventAt: d.lastEventAt ?? null,
  };
});

export const saveOnlinePayConfig = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const input = parseInput(onlinePayConfigSchema, request.data);
  const update: Record<string, unknown> = {
    enabled: input.enabled,
    serviceFee: input.serviceFee,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  };
  if (input.secretKey) update.secretKey = input.secretKey;
  if (input.webhookSecret) update.webhookSecret = input.webhookSecret;
  const ref = db.doc(`${catalogCol.privateConfig(caller.tid)}/roki`);
  const current = await ref.get();
  if (input.enabled && !input.secretKey && !current.get("secretKey")) {
    const { HttpsError } = await import("firebase-functions/v2/https");
    throw new HttpsError("failed-precondition", "Ingrese la llave secreta de ROKI antes de activar los pagos en línea.");
  }
  await ref.set(update, { merge: true });

  // Muestra u oculta el botón "Pagar en línea" en los links de las órdenes con saldo.
  const withBalance = await db.collection(orderCol.workOrders(caller.tid)).where("balance", ">", 0).limit(300).get();
  await Promise.all(withBalance.docs.map((d) => buildPortal(caller.tid, d.id).catch(() => undefined)));
  return { ok: true, portals: withBalance.size };
});
