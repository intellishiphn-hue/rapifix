import { HttpsError } from "firebase-functions/v2/https";

/** Banco/terminal y comprobante de un pago manual. Valida que el comprobante sea de este taller. */
export function paymentExtras(tid: string, p: { method: string; bank?: string | null; receiptPath?: string | null }) {
  const bank = p.method === "cash" ? "" : (p.bank ?? "").trim();
  const receiptPath = p.method === "cash" ? null : p.receiptPath || null;
  if (receiptPath && !receiptPath.startsWith(`tenants/${tid}/paymentReceipts/`)) {
    throw new HttpsError("invalid-argument", "Comprobante no válido.");
  }
  const receiptType = receiptPath ? (receiptPath.endsWith(".pdf") ? "pdf" : "image") : null;
  return { bank, receiptPath, receiptType };
}
