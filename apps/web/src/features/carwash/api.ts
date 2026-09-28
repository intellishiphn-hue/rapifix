import { useMemo } from "react";
import { collection, doc, limit, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import {
  carwashCol, carwashSettingsFrom, col,
  type CarwashLoyalty, type CarwashLookupResult, type CarwashMembership, type CarwashPlan, type CarwashService, type CarwashSettings,
  type ChargeWashInput, type SaveCarwashPlanInput, type SaveCarwashServiceInput, type SaveWashInput, type SellMembershipInput,
  type SetWashStatusInput, type Wash,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { useStaffDirectory } from "@/features/work-orders/api";

// ---------------- Cloud Functions ----------------
export const saveCarwashService = callable<SaveCarwashServiceInput, { serviceId: string }>("saveCarwashService");
export const reorderCarwashServices = callable<{ ids: string[] }, { ok: boolean }>("reorderCarwashServices");
export const seedCarwashMenu = callable<void, { created: number }>("seedCarwashMenu");
export const saveCarwashPlan = callable<SaveCarwashPlanInput, { planId: string }>("saveCarwashPlan");
export const carwashLookup = callable<{ plate: string }, CarwashLookupResult>("carwashLookup");
export const saveWash = callable<SaveWashInput, { washId: string; code: string; total: number; paid: boolean }>("saveWash");
export const setWashStatus = callable<SetWashStatusInput, { ok: boolean }>("setWashStatus");
export const assignWasher = callable<{ washId: string; washerId: string | null }, { ok: boolean }>("assignWasher");
export const cancelWash = callable<{ washId: string; reason: string }, { ok: boolean }>("cancelWash");
export const chargeWash = callable<ChargeWashInput, { saleId: string; code: string; paymentIds: string[]; earnedReward: boolean; stamps: number | null }>("chargeWash");
export const sellMembership = callable<SellMembershipInput, { membershipId: string; code: string; saleId: string; saleCode: string; paidUntil: number }>("sellMembership");
export const cancelMembership = callable<{ membershipId: string; reason: string }, { ok: boolean }>("cancelMembership");

// ---------------- Configuración ----------------
export const carwashSettingsRef = () => doc(db, col.settings(TENANT_ID), "carwash");

export function useCarwashSettings() {
  const state = useDocData<Partial<CarwashSettings> & { id: string }>(carwashSettingsRef(), `carwash-settings-${TENANT_ID}`);
  const settings = useMemo(() => carwashSettingsFrom(state.data), [state.data]);
  return { ...state, settings };
}

export async function saveCarwashSettings(input: Omit<CarwashSettings, "updatedAt" | "updatedBy">, uid: string) {
  await setDoc(carwashSettingsRef(), { ...input, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
}

// ---------------- Menú y planes ----------------
export function useCarwashServices() {
  const state = useQueryData<CarwashService>(query(collection(db, carwashCol.services(TENANT_ID))), "carwash-services");
  const sorted = useMemo(() => [...state.data].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name)), [state.data]);
  return { ...state, data: sorted, active: sorted.filter((s) => s.active) };
}

export function useCarwashPlans(enabled = true) {
  const state = useQueryData<CarwashPlan>(enabled ? query(collection(db, carwashCol.plans(TENANT_ID))) : null, `carwash-plans|${enabled}`);
  const sorted = useMemo(() => [...state.data].sort((a, b) => a.name.localeCompare(b.name)), [state.data]);
  return { ...state, data: sorted };
}

// ---------------- Cola ----------------
const washesCol = () => collection(db, carwashCol.washes(TENANT_ID));

/** Carros en cola (en espera, lavando, listos) + entregados desde "since". Un solo campo por consulta: sin índices compuestos. */
export function useWashQueue(since: Date) {
  const open = useQueryData<Wash>(query(washesCol(), where("status", "in", ["waiting", "washing", "ready"]), limit(300)), "carwash-queue-open");
  const delivered = useQueryData<Wash>(
    query(washesCol(), where("deliveredAt", ">=", Timestamp.fromDate(since)), limit(300)),
    `carwash-queue-delivered|${since.getTime()}`,
  );
  const data = useMemo(() => {
    const map = new Map<string, Wash>();
    for (const w of [...delivered.data, ...open.data]) map.set(w.id, w);
    return [...map.values()];
  }, [open.data, delivered.data]);
  return { data, loading: open.loading || delivered.loading, error: open.error ?? delivered.error };
}

/** Lavados registrados en [start, end) en tiempo real (un solo campo de rango). */
export function useWashesInRange(start: Date, end: Date) {
  return useQueryData<Wash>(
    query(washesCol(), where("createdAt", ">=", Timestamp.fromDate(start)), where("createdAt", "<", Timestamp.fromDate(end)), limit(3000)),
    `carwash-range|${start.getTime()}|${end.getTime()}`,
  );
}

export function useWash(id: string | undefined) {
  return useDocData<Wash>(id ? doc(washesCol(), id) : null, `wash-${id}`);
}

export function useLoyalty(plate: string | undefined) {
  return useDocData<CarwashLoyalty>(plate ? doc(db, carwashCol.loyalty(TENANT_ID), plate) : null, `carwash-loyalty-${plate}`);
}

// ---------------- Membresías ----------------
export function useMemberships(enabled = true) {
  return useQueryData<CarwashMembership>(enabled ? query(collection(db, carwashCol.memberships(TENANT_ID)), limit(2000)) : null, `carwash-memberships|${enabled}`);
}

// ---------------- Lavadores ----------------
/** Personal para asignar como lavador: primero los de rol Lavador, luego el resto del personal activo. */
export function useWashers() {
  const staff = useStaffDirectory();
  return useMemo(() => {
    const active = staff.active;
    const washers = active.filter((s) => s.role === "washer");
    const others = active.filter((s) => s.role !== "washer");
    return { washers, others, all: [...washers, ...others], loading: staff.loading };
  }, [staff.active, staff.loading]);
}
