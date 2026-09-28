import { collection, doc, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { catalogCol, paymentStoragePath, type AttachPaymentReceiptInput, type CreateSaleInput, type Payment, type RegisterPaymentInput, type Sale } from "@rapifix/shared";
import { callable, db, storage, TENANT_ID } from "@/lib/firebase";
import { newId, uploadImage } from "@/lib/storage";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

const paymentsCol = () => collection(db, catalogCol.payments(TENANT_ID));

export const registerPayment = callable<RegisterPaymentInput, { paymentId: string; code: string; balance: number }>("registerPayment");
export const voidPayment = callable<{ paymentId: string; reason: string }, { ok: boolean }>("voidPayment");
export const attachPaymentReceipt = callable<AttachPaymentReceiptInput, { ok: boolean }>("attachPaymentReceipt");

/** Sube el comprobante de pago (foto comprimida o PDF) y devuelve su ruta en Storage. */
export async function uploadPaymentReceipt(file: File, onProgress?: (pct: number) => void): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera 10 MB.");
  const id = newId();
  if (file.type === "application/pdf") {
    const path = paymentStoragePath.receipt(TENANT_ID, id, "pdf");
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: "application/pdf" });
    await new Promise<void>((resolve, reject) => {
      task.on("state_changed", (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, () => resolve());
    });
    return path;
  }
  if (file.type.startsWith("image/")) {
    const path = paymentStoragePath.receipt(TENANT_ID, id, "jpg");
    await uploadImage(file, path, onProgress);
    return path;
  }
  throw new Error("El comprobante debe ser una foto o un PDF.");
}

export async function openPaymentReceipt(path: string) {
  const w = window.open("", "_blank");
  try {
    const url = await getDownloadURL(ref(storage, path));
    if (w) w.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (err) {
    w?.close();
    throw err;
  }
}

export const createSale = callable<CreateSaleInput, { saleId: string; code: string; paymentIds: string[]; balance: number }>("createSale");

export function useOrderPayments(orderId: string | undefined, enabled = true) {
  return useQueryData<Payment>(orderId && enabled ? query(paymentsCol(), where("orderId", "==", orderId), orderBy("at", "desc")) : null, `payments-order-${orderId}-${enabled}`);
}

export function useSalePayments(saleId: string | undefined) {
  return useQueryData<Payment>(saleId ? query(paymentsCol(), where("saleId", "==", saleId), orderBy("at", "desc")) : null, `payments-sale-${saleId}`);
}

export type Range = "today" | "week" | "month" | "all";
export function rangeStart(r: Range): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "today") return d;
  if (r === "week") return new Date(d.getTime() - 6 * 86400000);
  if (r === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return null;
}

export function usePayments(range: Range) {
  const start = rangeStart(range);
  return useQueryData<Payment>(
    query(paymentsCol(), ...(start ? [where("at", ">=", Timestamp.fromDate(start))] : []), orderBy("at", "desc"), limit(500)),
    `payments-${range}-${start?.getTime() ?? 0}`,
  );
}

export function usePayment(id: string | undefined) {
  return useDocData<Payment>(id ? doc(db, catalogCol.payments(TENANT_ID), id) : null, `payment-${id}`);
}

export function useSale(id: string | undefined) {
  return useDocData<Sale>(id ? doc(db, catalogCol.sales(TENANT_ID), id) : null, `sale-${id}`);
}

export function useSales(range: Range) {
  const start = rangeStart(range);
  return useQueryData<Sale>(
    query(collection(db, catalogCol.sales(TENANT_ID)), ...(start ? [where("at", ">=", Timestamp.fromDate(start))] : []), orderBy("at", "desc"), limit(300)),
    `sales-${range}-${start?.getTime() ?? 0}`,
  );
}
