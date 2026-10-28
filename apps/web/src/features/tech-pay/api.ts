import { useMemo } from "react";
import { collection, doc, limit, query, Timestamp, where } from "firebase/firestore";
import {
  defaultShare, techPayCol,
  type PayTechEarningsInput, type ReviewTechEarningInput, type SaveStaffMemberInput, type StaffEntry, type TechEarning, type TechPayDefault, type TechPayout, type TechPayShare,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { useAuth } from "@/lib/auth/useAuth";
import { useStaffDirectory } from "@/features/work-orders/api";

export const payTechEarnings = callable<PayTechEarningsInput, { payoutId: string; code: string; amount: number; expenseCode: string }>("payTechEarnings");
export const reviewTechEarning = callable<ReviewTechEarningInput, { ok: boolean }>("reviewTechEarning");
export const saveStaffMember = callable<SaveStaffMemberInput, { employeeId: string }>("saveStaffMember");

const earningsCol = () => collection(db, techPayCol.earnings(TENANT_ID));
const payoutsCol = () => collection(db, techPayCol.payouts(TENANT_ID));
const ms = (t: { toMillis?: () => number } | null | undefined) => t?.toMillis?.() ?? 0;
const byMsDesc = <T,>(f: (x: T) => number) => (a: T, b: T) => f(b) - f(a);

/** Configuración de pago por trabajo de cada empleado (employeePay; solo admin y gerencia la leen). */
export function useTechPayConfig(enabled = true) {
  const s = useQueryData<{ id: string; techPay?: TechPayDefault | null }>(enabled ? query(collection(db, techPayCol.config(TENANT_ID)), limit(500)) : null, `employee-pay|${enabled}`);
  const map = useMemo(() => new Map(s.data.map((d) => [d.id, d.techPay ?? null])), [s.data]);
  return { ...s, map };
}

export interface TechPayEmployee extends StaffEntry {
  techPay: TechPayDefault | null;
}

/**
 * Empleados para el pago a técnicos: el personal activo (con o sin acceso al panel) con su configuración.
 * `defaultsFor(ids)`: repartos por defecto de esos empleados (los técnicos de la orden) que tienen pago configurado.
 */
export function useTechPayEmployees() {
  const { can } = useAuth();
  const enabled = can("techpay.manage");
  const staff = useStaffDirectory();
  const config = useTechPayConfig(enabled);
  return useMemo(() => {
    const list: TechPayEmployee[] = staff.active
      .map((s) => ({ ...s, techPay: config.map.get(s.id) ?? null }))
      .sort((a, b) => Number(b.role === "technician") - Number(a.role === "technician") || a.displayName.localeCompare(b.displayName));
    const byId = new Map(list.map((e) => [e.id, e]));
    const defaultsFor = (ids: string[]): TechPayShare[] =>
      ids.map((id) => byId.get(id)).filter((e): e is TechPayEmployee => !!e).map((e) => defaultShare(e, e.techPay)).filter((s): s is TechPayShare => !!s).slice(0, 3);
    return { enabled, employees: list, byId, defaultsFor, loading: staff.loading || config.loading };
  }, [enabled, staff.active, staff.loading, config.map, config.loading]);
}

/** Trabajos pendientes de pago (todas las fechas). */
export function usePendingEarnings() {
  const s = useQueryData<TechEarning>(query(earningsCol(), where("status", "==", "pending"), limit(3000)), "tech-earnings-pending");
  const data = useMemo(() => [...s.data].sort(byMsDesc((e) => ms(e.earnedAt))), [s.data]);
  return { ...s, data };
}

/** Trabajos ganados (órdenes cobradas) en [start, end). */
export function useEarningsInRange(start: Date, end: Date) {
  const s = useQueryData<TechEarning>(
    query(earningsCol(), where("earnedAt", ">=", Timestamp.fromDate(start)), where("earnedAt", "<", Timestamp.fromDate(end)), limit(3000)),
    `tech-earnings-${start.getTime()}-${end.getTime()}`,
  );
  const data = useMemo(() => [...s.data].sort(byMsDesc((e) => ms(e.earnedAt))), [s.data]);
  return { ...s, data };
}

/** Pagos registrados en [start, end). */
export function useTechPayouts(start: Date, end: Date) {
  const s = useQueryData<TechPayout>(
    query(payoutsCol(), where("at", ">=", Timestamp.fromDate(start)), where("at", "<", Timestamp.fromDate(end)), limit(1000)),
    `tech-payouts-${start.getTime()}-${end.getTime()}`,
  );
  const data = useMemo(() => [...s.data].sort(byMsDesc((p) => ms(p.at))), [s.data]);
  return { ...s, data };
}

export function useEarningsToReview() {
  return useQueryData<TechEarning>(query(earningsCol(), where("needsReview", "==", true), limit(200)), "tech-earnings-review");
}

export function useOrderEarnings(orderId: string | undefined, enabled = true) {
  return useQueryData<TechEarning>(orderId && enabled ? query(earningsCol(), where("orderId", "==", orderId), limit(20)) : null, `tech-earnings-order-${orderId}|${enabled}`);
}

export function useTechPayout(id: string | undefined) {
  return useDocData<TechPayout>(id ? doc(db, techPayCol.payouts(TENANT_ID), id) : null, `tech-payout-${id}`);
}

export function usePayoutEarnings(payoutId: string | undefined) {
  return useQueryData<TechEarning>(payoutId ? query(earningsCol(), where("payoutId", "==", payoutId), limit(300)) : null, `tech-payout-earnings-${payoutId}`);
}
