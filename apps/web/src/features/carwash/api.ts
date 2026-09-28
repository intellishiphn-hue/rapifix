import { useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import {
  carwashCol, carwashSettingsFrom, col,
  type CarwashLoyalty, type CarwashLookupResult, type CarwashMembership, type CarwashPlan, type CarwashService, type CarwashSettings,
  type ChargeWashInput, type LinkWashCustomerInput, type LinkWashCustomerResult, type SaveCarwashPlanInput, type SaveCarwashServiceInput,
  type SaveWashInput, type SaveWashResult, type SellMembershipInput, type SetWashStatusInput, type Wash,
  type AdjustLoyaltyStampsInput, type AdjustLoyaltyStampsResult, type WashPayLinkResult,
  loyaltyWelcomeFor,
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
export const saveWash = callable<SaveWashInput, SaveWashResult>("saveWash");
export const linkWashCustomer = callable<LinkWashCustomerInput, LinkWashCustomerResult>("linkWashCustomer");
export const setWashStatus = callable<SetWashStatusInput, { ok: boolean }>("setWashStatus");
export const assignWasher = callable<{ washId: string; washerId: string | null }, { ok: boolean }>("assignWasher");
export const cancelWash = callable<{ washId: string; reason: string }, { ok: boolean }>("cancelWash");
export const chargeWash = callable<ChargeWashInput, { saleId: string; code: string; paymentIds: string[]; earnedReward: boolean; stamps: number | null }>("chargeWash");
export const sellMembership = callable<SellMembershipInput, { membershipId: string; code: string; saleId: string; saleCode: string; paidUntil: number }>("sellMembership");
export const cancelMembership = callable<{ membershipId: string; reason: string }, { ok: boolean }>("cancelMembership");
export const getWashPayLink = callable<{ washId: string }, WashPayLinkResult>("getWashPayLink");
export const adjustLoyaltyStamps = callable<AdjustLoyaltyStampsInput, AdjustLoyaltyStampsResult>("adjustLoyaltyStamps");

/** Link público del lavado (ver, pagar con tarjeta o subir comprobante) en el dominio actual. */
export const washPayUrl = (token: string) => `${window.location.origin}/lavado/${token}`;

/** Link del lavado: usa el token guardado o lo crea en el servidor (lavados de antes). */
export async function ensureWashPayUrl(w: Pick<Wash, "id" | "payToken">): Promise<string> {
  if (w.payToken) return washPayUrl(w.payToken);
  const { token } = await getWashPayLink({ washId: w.id });
  return washPayUrl(token);
}

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

/**
 * Sellos que se muestran: los de la tarjeta más los de regalo que recibe la tarjeta nueva.
 * Los de regalo se guardan al cobrar el primer lavado, pero se enseñan desde que se registra el carro.
 */
export function loyaltyView(card: CarwashLoyalty | null | undefined, cw: { loyaltyEvery: number; loyaltyStartStamps: number }) {
  const gift = loyaltyWelcomeFor({ exists: !!card, welcomePending: card?.welcomePending }, cw);
  return { count: Math.min(Math.max(0, cw.loyaltyEvery - 1), (card?.count ?? 0) + gift), gift, rewardsAvailable: card?.rewardsAvailable ?? 0 };
}

export function useLoyaltyView(plate: string | undefined) {
  const loyalty = useLoyalty(plate);
  const { settings } = useCarwashSettings();
  const view = loyaltyView(loyalty.data, settings);
  return { ...view, card: loyalty.data, loading: loyalty.loading, every: settings.loyaltyEvery };
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

// ---------------- Historial del carwash de un cliente o vehículo ----------------
const byId = <T extends { id: string }>(...lists: T[][]) => {
  const map = new Map<string, T>();
  for (const l of lists) for (const x of l) map.set(x.id, x);
  return [...map.values()];
};

/**
 * Lavados, tarjetas de lealtad y membresías de un cliente (customerId) o de un vehículo (vehicleId),
 * más lo registrado con sus placas antes de vincularse. Un solo campo por consulta (sin índices compuestos);
 * se ordena en memoria.
 */
export function useCarwashFor(opts: { customerId?: string; vehicleId?: string; plates: string[]; memberships: boolean; enabled?: boolean }) {
  const on = opts.enabled !== false;
  const field = opts.customerId ? "customerId" : "vehicleId";
  const value = opts.customerId ?? opts.vehicleId ?? "";
  const plates = useMemo(() => [...new Set(opts.plates.filter(Boolean))].sort().slice(0, 30), [opts.plates]);
  const pk = plates.join(",");
  const base = on && value ? `${field}:${value}` : "";
  const hasPlates = on && plates.length > 0;

  const w1 = useQueryData<Wash>(base ? query(washesCol(), where(field, "==", value), limit(200)) : null, `cw-for-w1|${base}`);
  const w2 = useQueryData<Wash>(hasPlates ? query(washesCol(), where("plate", "in", plates), limit(200)) : null, `cw-for-w2|${on}|${pk}`);
  const loyaltyCol = collection(db, carwashCol.loyalty(TENANT_ID));
  const l1 = useQueryData<CarwashLoyalty>(base ? query(loyaltyCol, where(field, "==", value), limit(50)) : null, `cw-for-l1|${base}`);
  const l2 = useQueryData<CarwashLoyalty>(hasPlates ? query(loyaltyCol, where(documentId(), "in", plates)) : null, `cw-for-l2|${on}|${pk}`);
  const memCol = collection(db, carwashCol.memberships(TENANT_ID));
  const m1 = useQueryData<CarwashMembership>(
    opts.memberships && on && opts.customerId ? query(memCol, where("customerId", "==", opts.customerId), limit(50)) : null,
    `cw-for-m1|${opts.memberships}|${on}|${opts.customerId ?? ""}`,
  );
  const m2 = useQueryData<CarwashMembership>(
    opts.memberships && hasPlates ? query(memCol, where("plate", "in", plates), limit(50)) : null,
    `cw-for-m2|${opts.memberships}|${on}|${pk}`,
  );

  const washes = useMemo(() => {
    const all = byId(w1.data, w2.data);
    // Por vehículo: solo lo de esa placa o de ese vehículo
    const filtered = opts.vehicleId && !opts.customerId ? all.filter((w) => w.vehicleId === opts.vehicleId || plates.includes(w.plate)) : all;
    return filtered.sort((a, b) => (tsMs(b.createdAt) - tsMs(a.createdAt)));
  }, [w1.data, w2.data, opts.vehicleId, opts.customerId, plates]);
  const loyalty = useMemo(() => byId(l1.data, l2.data).sort((a, b) => tsMs(b.lastWashAt) - tsMs(a.lastWashAt)), [l1.data, l2.data]);
  const memberships = useMemo(() => byId(m1.data, m2.data), [m1.data, m2.data]);
  const loading = w1.loading || w2.loading || l1.loading || l2.loading || m1.loading || m2.loading;
  const error = w1.error ?? w2.error ?? l1.error ?? l2.error ?? m1.error ?? m2.error;
  return { washes, loyalty, memberships, loading, error };
}

const tsMs = (v: unknown): number => {
  if (!v) return 0;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number; seconds?: number };
  return t.toMillis ? t.toMillis() : typeof t.seconds === "number" ? t.seconds * 1000 : 0;
};

/**
 * Qué clientes de una lista tienen historial en el carwash (tarjeta de lealtad o membresía).
 * Consultas "in" de 30 en 30: no una por fila.
 */
export function useCarwashCustomerIds(ids: string[], opts: { enabled: boolean; memberships: boolean }) {
  const [found, setFound] = useState<Set<string>>(new Set());
  const key = opts.enabled ? [...new Set(ids)].sort().join(",") : "";
  useEffect(() => {
    if (!key) {
      setFound(new Set());
      return;
    }
    let cancelled = false;
    const list = key.split(",");
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
    const loyaltyCol = collection(db, carwashCol.loyalty(TENANT_ID));
    const memCol = collection(db, carwashCol.memberships(TENANT_ID));
    Promise.all(
      chunks.flatMap((c) => [
        getDocs(query(loyaltyCol, where("customerId", "in", c))),
        ...(opts.memberships ? [getDocs(query(memCol, where("customerId", "in", c)))] : []),
      ]),
    )
      .then((snaps) => {
        if (cancelled) return;
        const s = new Set<string>();
        for (const snap of snaps) for (const d of snap.docs) {
          const id = d.get("customerId");
          if (typeof id === "string") s.add(id);
        }
        setFound(s);
      })
      .catch(() => !cancelled && setFound(new Set()));
    return () => {
      cancelled = true;
    };
  }, [key, opts.memberships]);
  return found;
}
