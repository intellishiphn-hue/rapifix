import { collection, doc, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { useMemo } from "react";
import {
  col, companyCol,
  type Company, type CommissionPayout, type Customer, type PayCommissionsInput, type ReferralCommission, type Referrer, type SaveReferrerInput, type VoidCommissionInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

export const saveReferrer = callable<SaveReferrerInput, { referrerId: string }>("saveReferrer");
export const payCommissions = callable<PayCommissionsInput, { payoutId: string; code: string; amount: number; expenseCode: string }>("payCommissions");
export const voidCommission = callable<VoidCommissionInput, { ok: boolean }>("voidCommission");

const commissionsCol = () => collection(db, companyCol.commissions(TENANT_ID));
const payoutsCol = () => collection(db, companyCol.commissionPayouts(TENANT_ID));

export function useReferrers(enabled = true) {
  return useQueryData<Referrer>(enabled ? query(collection(db, companyCol.referrers(TENANT_ID)), orderBy("name"), limit(500)) : null, `referrers|${enabled}`);
}

export function useReferrer(id: string | undefined) {
  return useDocData<Referrer>(id ? doc(db, companyCol.referrers(TENANT_ID), id) : null, `referrer-${id}`);
}

const byMsDesc = <T,>(f: (x: T) => number) => (a: T, b: T) => f(b) - f(a);
const ms = (t: { toMillis?: () => number } | null | undefined) => t?.toMillis?.() ?? 0;

/** Todas las comisiones pendientes (sin importar la fecha). */
export function usePendingCommissions() {
  const s = useQueryData<ReferralCommission>(query(commissionsCol(), where("status", "==", "pending"), limit(2000)), "commissions-pending");
  const data = useMemo(() => [...s.data].sort(byMsDesc((c) => ms(c.earnedAt))), [s.data]);
  return { ...s, data };
}

/** Comisiones ganadas en [start, end) (un solo campo de rango). */
export function useCommissionsEarned(start: Date, end: Date) {
  const s = useQueryData<ReferralCommission>(
    query(commissionsCol(), where("earnedAt", ">=", Timestamp.fromDate(start)), where("earnedAt", "<", Timestamp.fromDate(end)), limit(3000)),
    `commissions-earned-${start.getTime()}-${end.getTime()}`,
  );
  const data = useMemo(() => [...s.data].sort(byMsDesc((c) => ms(c.earnedAt))), [s.data]);
  return { ...s, data };
}

/** Comisiones de un referido (todas). */
export function useReferrerCommissions(referrerId: string | undefined) {
  const s = useQueryData<ReferralCommission>(referrerId ? query(commissionsCol(), where("referrerId", "==", referrerId), limit(3000)) : null, `commissions-ref-${referrerId}`);
  const data = useMemo(() => [...s.data].sort(byMsDesc((c) => ms(c.earnedAt))), [s.data]);
  return { ...s, data };
}

/** Comisiones con aviso por revisar (pagadas y la orden cambió). */
export function useCommissionsToReview() {
  return useQueryData<ReferralCommission>(query(commissionsCol(), where("needsReview", "==", true), limit(200)), "commissions-review");
}

export function usePayouts(start: Date, end: Date) {
  const s = useQueryData<CommissionPayout>(
    query(payoutsCol(), where("at", ">=", Timestamp.fromDate(start)), where("at", "<", Timestamp.fromDate(end)), limit(1000)),
    `payouts-${start.getTime()}-${end.getTime()}`,
  );
  const data = useMemo(() => [...s.data].sort(byMsDesc((p) => ms(p.at))), [s.data]);
  return { ...s, data };
}

export function useReferrerPayouts(referrerId: string | undefined) {
  const s = useQueryData<CommissionPayout>(referrerId ? query(payoutsCol(), where("referrerId", "==", referrerId), limit(500)) : null, `payouts-ref-${referrerId}`);
  const data = useMemo(() => [...s.data].sort(byMsDesc((p) => ms(p.at))), [s.data]);
  return { ...s, data };
}

export function usePayout(id: string | undefined) {
  return useDocData<CommissionPayout>(id ? doc(db, companyCol.commissionPayouts(TENANT_ID), id) : null, `payout-${id}`);
}

/** Empresas y clientes que refirió una persona. */
export function useReferred(referrerId: string | undefined) {
  const companies = useQueryData<Company>(referrerId ? query(collection(db, companyCol.companies(TENANT_ID)), where("referral.referrerId", "==", referrerId), limit(200)) : null, `referred-co-${referrerId}`);
  const customers = useQueryData<Customer>(referrerId ? query(collection(db, col.customers(TENANT_ID)), where("referral.referrerId", "==", referrerId), limit(200)) : null, `referred-cu-${referrerId}`);
  return { companies, customers };
}

/** Comisiones incluidas en un pago. */
export function usePayoutCommissions(payoutId: string | undefined) {
  return useQueryData<ReferralCommission>(payoutId ? query(commissionsCol(), where("payoutId", "==", payoutId), limit(300)) : null, `payout-commissions-${payoutId}`);
}
