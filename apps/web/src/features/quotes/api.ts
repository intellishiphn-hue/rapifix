import { collection, doc, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import { quoteCol, type Quote, type QuoteStatus, type SaveQuoteInput } from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { useAuth } from "@/lib/auth/useAuth";

const quotesCol = () => collection(db, quoteCol.quotes(TENANT_ID));

export const saveQuote = callable<SaveQuoteInput, { quoteId: string }>("saveQuote");
export const sendQuote = callable<{ quoteId: string }, { orderId: string | null; token: string | null }>("sendQuote");
export const newQuoteVersion = callable<{ quoteId: string }, { quoteId: string }>("newQuoteVersion");
export const ensurePortal = callable<{ orderId: string }, { token: string }>("ensurePortal");

function scope(role: string | null, uid: string | undefined): QueryConstraint[] {
  return role === "technician" && uid ? [where("technicianIds", "array-contains", uid)] : [];
}

export function useOrderQuotes(orderId: string | undefined) {
  const { role, user } = useAuth();
  return useQueryData<Quote>(
    orderId ? query(quotesCol(), ...scope(role, user?.uid), where("orderId", "==", orderId), orderBy("createdAt", "desc"), limit(20)) : null,
    `order-quotes-${orderId}-${role}`,
  );
}

export function useQuotesList(status: QuoteStatus | "all", pageSize: number) {
  const c: QueryConstraint[] = status === "all" ? [orderBy("createdAt", "desc")] : [where("status", "==", status), orderBy("createdAt", "desc")];
  const state = useQueryData<Quote>(query(quotesCol(), ...c, limit(pageSize)), `quotes-${status}-${pageSize}`);
  return { ...state, hasMore: state.data.length >= pageSize };
}

export function useQuote(id: string | undefined) {
  return useDocData<Quote>(id ? doc(db, quoteCol.quotes(TENANT_ID), id) : null, `quote-${id}`);
}

export const recordQuoteDecision = callable<import("@rapifix/shared").RecordDecisionInput, { approvalId: string }>("recordQuoteDecision");
export const convertQuoteToOrder = callable<import("@rapifix/shared").ConvertQuoteInput, { orderId: string; code: string }>("convertQuoteToOrder");

/** Cotizaciones directas aprobadas que todavía no tienen orden (el carro no ha llegado). */
export function usePendingIntakeQuotes(enabled = true) {
  return useQueryData<Quote>(enabled ? query(quotesCol(), where("status", "==", "approved"), where("orderId", "==", null), limit(20)) : null, `quotes-pending-intake|${enabled}`);
}
