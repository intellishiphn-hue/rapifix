import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, formatMoney, PAYMENT_METHOD_LABELS, reviewPaymentProofSchema, type ReviewPaymentProofResult } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { CASHIERS, loadCarwashConfig, readWashCharge, writeWashCharge } from "../lib/carwash";
import { readPaymentTarget, writePaymentToTarget } from "../lib/payments";
import { buildPublicWash } from "../lib/publicWash";
import { buildPortal } from "../lib/portal";

const bad = (msg: string) => new HttpsError("failed-precondition", msg);

/**
 * Caja aprueba o rechaza un comprobante que subió el cliente.
 * Aprobar registra el pago (transferencia o depósito, con el banco y la foto del comprobante) con la misma
 * lógica de chargeWash (lavado) o registerPayment (orden). En transacción e idempotente: no se aprueba dos veces.
 */
export const reviewPaymentProof = onCall({ region: REGION }, async (request): Promise<ReviewPaymentProofResult> => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(reviewPaymentProofSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const cfg = await loadCarwashConfig(tid);
  const proofRef = db.doc(`${catalogCol.paymentProofs(tid)}/${input.proofId}`);

  const result = await db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const proof = await tx.get(proofRef);
    if (!proof.exists) throw new HttpsError("not-found", "El comprobante no existe.");
    const status = proof.get("status") as string;
    const kind = proof.get("kind") as "wash" | "order";
    const washId = (proof.get("washId") as string | null) ?? null;
    const orderId = (proof.get("orderId") as string | null) ?? null;
    if (status !== "pending") {
      const same = (input.action === "approve" && status === "approved") || (input.action === "reject" && status === "rejected");
      if (same) return { status, paymentId: (proof.get("paymentId") as string | null) ?? null, already: true, kind, washId, orderId } as const;
      throw bad(`Este comprobante ya fue ${status === "approved" ? "aprobado" : "rechazado"}.`);
    }
    const reviewed = { reviewedBy: caller.uid, reviewedByName: name, reviewedAt: FieldValue.serverTimestamp() };

    if (input.action === "reject") {
      tx.update(proofRef, { status: "rejected", rejectReason: (input.reason ?? "").trim(), ...reviewed });
      return { status: "rejected", paymentId: null, already: false, kind, washId, orderId } as const;
    }

    const method = input.method ?? "transfer";
    const line = {
      method, reference: String(proof.get("reference") ?? ""), bank: String(proof.get("bank") ?? "") || null, receiptPath: String(proof.get("receiptPath") ?? "") || null,
    };
    let paymentId: string;
    let amount: number;
    if (kind === "wash") {
      if (!washId) throw bad("El comprobante no tiene lavado.");
      const r = await readWashCharge(tx, tid, washId);
      if (!r.wash.exists) throw new HttpsError("not-found", "El lavado ya no existe. Rechace el comprobante.");
      if (r.wash.get("saleId")) throw bad(`El lavado ya fue cobrado (${r.wash.get("saleCode")}). Si el cliente pagó dos veces, rechace este comprobante y gestione la devolución.`);
      const total = Number(r.wash.get("total") ?? 0);
      amount = input.amount ?? total;
      if (amount !== total) throw bad(`El lavado se cobra completo: ${formatMoney(total)}. Si el cliente transfirió otro monto, rechace el comprobante y cobre en caja con Cobrar.`);
      // ---------- escrituras ----------
      const res = writeWashCharge(tx, r, { cfg, uid: caller.uid, byName: name, discount: 0, payments: [{ amount, ...line }], mode: "exact" });
      paymentId = res.paymentIds[0]!;
    } else {
      if (!orderId) throw bad("El comprobante no tiene orden.");
      const r = await readPaymentTarget(tx, tid, { orderId });
      const balance = Number(r.target.get("totals.total") ?? 0) - Number(r.target.get("paid") ?? 0);
      amount = input.amount ?? Math.min(Number(proof.get("amount") ?? 0), balance);
      if (amount <= 0) throw bad("La orden ya no tiene saldo pendiente. Rechace el comprobante si es un pago doble.");
      // ---------- escrituras ----------
      const res = writePaymentToTarget(tx, r, {
        amount, ...line, uid: caller.uid, byName: name,
        note: `Comprobante enviado por el cliente (${PAYMENT_METHOD_LABELS[method]}${line.bank ? `, ${line.bank}` : ""})`,
        customerText: `Recibimos su pago de ${formatMoney(amount)}. ¡Gracias!`,
      });
      paymentId = res.paymentId;
    }
    tx.update(proofRef, { status: "approved", method, paymentId, approvedAmount: amount, ...reviewed });
    return { status: "approved", paymentId, already: false, kind, washId, orderId } as const;
  });

  if (result.kind === "wash" && result.washId) await buildPublicWash(tid, result.washId).catch(() => null);
  if (result.kind === "order" && result.orderId) await buildPortal(tid, result.orderId).catch(() => null);
  return { status: result.status as ReviewPaymentProofResult["status"], paymentId: result.paymentId, already: result.already };
});
