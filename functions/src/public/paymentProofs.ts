import { logger } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
  base64Bytes, carwashCol, catalogCol, formatMoney, orderCol, paymentStoragePath, PROOF_EXT, PROOF_MAX_BYTES, PROOF_MAX_PENDING, quoteCol,
  sniffProofType, submitPaymentProofSchema,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { rateLimit, requestIp, requireAppCheck } from "../lib/rateLimit";
import { buildPublicWash, loadWashByToken } from "../lib/publicWash";
import { buildPortal } from "../lib/portal";

const bad = (msg: string) => new HttpsError("failed-precondition", msg);

interface ProofTarget {
  tid: string;
  kind: "wash" | "order";
  id: string;
  code: string;
  customerName: string;
  plate: string;
  balance: number;
}

/** Lavado u orden del link, con las mismas condiciones que el pago en línea. */
async function resolveTarget(token: string, kind: "wash" | "order"): Promise<ProofTarget> {
  if (kind === "wash") {
    const { tid, washId } = await loadWashByToken(token);
    const w = await db.doc(`${carwashCol.washes(tid)}/${washId}`).get();
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    if (w.get("status") === "cancelled") throw bad("El lavado está cancelado.");
    const total = Number(w.get("total") ?? 0);
    if (w.get("paid") || w.get("saleId") || total <= 0) throw bad("Este lavado ya está pagado.");
    return { tid, kind, id: washId, code: String(w.get("code")), customerName: String(w.get("customerName") ?? ""), plate: String(w.get("plate") ?? ""), balance: total };
  }
  const portal = await db.doc(`${quoteCol.portal}/${token}`).get();
  if (!portal.exists || portal.get("active") === false || portal.get("kind") === "quote" || !portal.get("orderId")) {
    throw new HttpsError("not-found", "Este link no es válido para pagos.");
  }
  const tid = portal.get("tid") as string;
  const orderId = portal.get("orderId") as string;
  const order = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  if (!order.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (order.get("status") === "CANCELLED") throw bad("La orden está cancelada.");
  const balance = Number(order.get("balance") ?? 0);
  if (balance <= 0) throw bad("Esta orden no tiene saldo pendiente.");
  // Igual que el pago en línea: primero se aprueba la cotización y después se paga
  const activeQuoteId = order.get("activeQuoteId") as string | null;
  if (activeQuoteId) {
    const aq = await db.doc(`${quoteCol.quotes(tid)}/${activeQuoteId}`).get();
    if (aq.exists && ["sent", "viewed"].includes(aq.get("status"))) throw bad("Primero apruebe la cotización. Después podrá pagar aquí mismo.");
  }
  return {
    tid, kind, id: orderId, code: String(order.get("code")), customerName: String(order.get("customer.fullName") ?? ""),
    plate: String(order.get("vehicle.plate") ?? ""), balance,
  };
}

/**
 * El cliente sube el comprobante de su transferencia o depósito desde su link (sin cuenta).
 * NUNCA marca nada como pagado: queda "por revisar" hasta que caja lo aprueba.
 */
export const submitPaymentProof = onCall({ region: REGION }, async (request) => {
  requireAppCheck(request);
  const input = parseInput(submitPaymentProofSchema, request.data);
  await rateLimit("proof", [input.token], 6, 3600);
  await rateLimit("proof-ip", [requestIp(request)], 20, 3600);

  if (base64Bytes(input.fileBase64) > PROOF_MAX_BYTES) throw new HttpsError("invalid-argument", "El archivo supera 5 MB. Tome una foto más liviana o envíe un PDF más pequeño.");
  const data = Buffer.from(input.fileBase64, "base64");
  if (data.length < 100 || data.length > PROOF_MAX_BYTES) throw new HttpsError("invalid-argument", "El archivo no es válido o supera 5 MB.");
  // El tipo se toma del contenido real del archivo (no solo de lo que dice el navegador)
  const type = sniffProofType(data);
  if (!type) throw new HttpsError("invalid-argument", "El comprobante debe ser una foto (JPG, PNG o WEBP) o un PDF.");

  const t = await resolveTarget(input.token, input.kind);
  if (input.amount > Math.max(t.balance * 3, t.balance + 100_000)) throw new HttpsError("invalid-argument", `Revise el monto: el saldo es ${formatMoney(t.balance)}.`);

  const proofsCol = db.collection(catalogCol.paymentProofs(t.tid));
  const field = t.kind === "wash" ? "washId" : "orderId";
  const pendingQuery = proofsCol.where(field, "==", t.id).where("status", "==", "pending").limit(PROOF_MAX_PENDING + 1);
  if ((await pendingQuery.get()).size >= PROOF_MAX_PENDING) throw bad("Ya tiene comprobantes en revisión. Espere a que los verifiquemos.");

  const proofRef = proofsCol.doc();
  const path = paymentStoragePath.receipt(t.tid, proofRef.id, PROOF_EXT[type]);
  const file = getStorage().bucket().file(path);
  await file.save(data, { contentType: type, resumable: false, metadata: { cacheControl: "private, max-age=0" } });

  try {
    await db.runTransaction(async (tx) => {
      const pending = await tx.get(pendingQuery);
      if (pending.size >= PROOF_MAX_PENDING) throw bad("Ya tiene comprobantes en revisión. Espere a que los verifiquemos.");
      tx.set(proofRef, {
        kind: t.kind, washId: t.kind === "wash" ? t.id : null, orderId: t.kind === "order" ? t.id : null,
        code: t.code, customerName: t.customerName, plate: t.plate,
        amount: input.amount, bank: input.bank.trim(), reference: input.reference.trim(),
        receiptPath: path, receiptType: type === "application/pdf" ? "pdf" : "image",
        status: "pending", createdAt: FieldValue.serverTimestamp(),
        reviewedBy: null, reviewedByName: null, reviewedAt: null, rejectReason: "", paymentId: null, method: null,
      });
    });
  } catch (err) {
    await file.delete().catch(() => undefined);
    throw err;
  }
  logger.info("Comprobante recibido", { tid: t.tid, kind: t.kind, id: t.id, proofId: proofRef.id });
  if (t.kind === "wash") await buildPublicWash(t.tid, t.id).catch(() => null);
  else await buildPortal(t.tid, t.id).catch(() => null);
  return { ok: true };
});
