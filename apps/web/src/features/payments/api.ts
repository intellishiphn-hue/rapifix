import { collection, doc, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { catalogCol, type CreateSaleInput, type Payment, type RegisterPaymentInput, type Sale } from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

const paymentsCol = () => collection(db, catalogCol.payments(TENANT_ID));

export const registerPayment = callable<RegisterPaymentInput, { paymentId: string; code: string; balance: number }>("registerPayment");
export const voidPayment = callable<{ paymentId: string; reason: string }, { ok: boolean }>("voidPayment");
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
