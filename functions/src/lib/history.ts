import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  buildHistoryView, carwashCol, catalogCol, col, companyCol, isPlaceholderPlate, opsCol, orderCol, PUBLIC_HISTORY, quoteCol,
  type CompanyTerms, type HistoryKind, type HistoryLink, type HistoryRaw, type RawHistoryLoyalty, type RawHistoryMaintenance,
  type RawHistoryMembership, type RawHistoryOrder, type RawHistoryPayment, type RawHistoryQuote, type RawHistoryVehicle, type RawHistoryWash,
} from "@rapifix/shared";
import { db } from "./admin";
import { loadCarwashConfig } from "./carwash";
import { workshopInfo } from "./publicWash";

/**
 * "Mi historial RAPIFIX" (docs/HISTORIAL.md): copia pública y mínima en publicHistory/{token}
 * de un cliente o una empresa. La arma el servidor con buildHistoryView (packages/shared/src/history.ts),
 * que solo copia campos de una lista blanca. Si el link no está activo no se construye nada.
 */

export interface HistoryOwner {
  kind: HistoryKind;
  id: string;
}

export const ownerRef = (tid: string, o: HistoryOwner) =>
  db.doc(o.kind === "company" ? `${companyCol.companies(tid)}/${o.id}` : `${col.customers(tid)}/${o.id}`);

/** Convierte todos los Timestamp (también anidados) a epoch ms. */
function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toMillis();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  return v;
}
const docs = <T>(snaps: FirebaseFirestore.QuerySnapshot[]) =>
  snaps.flatMap((s) => s.docs).map((d) => ({ id: d.id, ...(plain(d.data()) as Record<string, unknown>) }) as T);

const chunks = <T>(list: T[], size = 30): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Consulta `field in values` en grupos de 30 (límite de Firestore). */
async function whereIn(path: string, field: string, values: string[], max = 500) {
  const uniq = [...new Set(values.filter(Boolean))];
  return Promise.all(chunks(uniq).map((c) => db.collection(path).where(field, "in", c).limit(max).get()));
}

function orderRaw(o: Record<string, unknown> & { id: string }): RawHistoryOrder {
  const reception = (o.reception ?? {}) as Record<string, unknown>;
  return {
    ...(o as unknown as RawHistoryOrder),
    receivedAt: (reception.receivedAt as number | undefined) ?? null,
    mileageIn: typeof reception.mileageIn === "number" ? reception.mileageIn : null,
  };
}

/** Lee todo lo necesario y arma la vista pública (sin escribir). null si el dueño no existe. */
export async function loadHistoryRaw(tid: string, owner: HistoryOwner, ownerData: FirebaseFirestore.DocumentData): Promise<HistoryRaw> {
  const isCompany = owner.kind === "company";
  const [vehiclesSnap, ordersSnap, settings, carwash] = await Promise.all([
    db.collection(col.vehicles(tid)).where(isCompany ? "companyId" : "customerId", "==", owner.id).limit(500).get(),
    db.collection(orderCol.workOrders(tid)).where(isCompany ? "companyId" : "customerId", "==", owner.id).limit(2000).get(),
    db.doc(`${col.settings(tid)}/general`).get(),
    loadCarwashConfig(tid),
  ]);
  const vehicles = docs<RawHistoryVehicle>([vehiclesSnap]);
  const vehicleIds = vehicles.map((v) => v.id);
  const plates = [...new Set(vehicles.map((v) => String(v.plate ?? "")).filter((p) => p && !isPlaceholderPlate(p)))];

  const [quoteSnaps, paymentsSnap, maintSnaps, washSnaps, memSnaps, loyaltySnaps] = await Promise.all([
    isCompany
      ? whereIn(quoteCol.quotes(tid), "vehicleId", vehicleIds)
      : db.collection(quoteCol.quotes(tid)).where("customerId", "==", owner.id).limit(2000).get().then((s) => [s]),
    db.collection(catalogCol.payments(tid)).where(isCompany ? "companyId" : "customerId", "==", owner.id).limit(4000).get(),
    whereIn(opsCol.maintenance(tid), "vehicleId", vehicleIds, 200),
    whereIn(carwashCol.washes(tid), "plate", plates, 1000),
    whereIn(carwashCol.memberships(tid), "plate", plates, 100),
    plates.length ? db.getAll(...plates.map((p) => db.doc(`${carwashCol.loyalty(tid)}/${p}`))) : Promise.resolve([]),
  ]);

  const loyalty: RawHistoryLoyalty[] = loyaltySnaps.map((s) => ({
    plate: s.id, exists: s.exists, count: Number(s.get("count") ?? 0), rewardsAvailable: Number(s.get("rewardsAvailable") ?? 0),
    welcomePending: s.get("welcomePending") === true,
  }));

  return {
    kind: owner.kind,
    ownerId: owner.id,
    name: String((isCompany ? ownerData.name : ownerData.fullName) ?? ""),
    now: Date.now(),
    workshop: workshopInfo(settings.data() ?? {}),
    terms: isCompany ? (ownerData as CompanyTerms) : null,
    vehicles,
    orders: docs<Record<string, unknown> & { id: string }>([ordersSnap]).map(orderRaw),
    quotes: docs<RawHistoryQuote>(quoteSnaps),
    payments: docs<RawHistoryPayment>([paymentsSnap]),
    maintenance: docs<RawHistoryMaintenance>(maintSnaps),
    washes: docs<RawHistoryWash>(washSnaps),
    loyalty,
    memberships: docs<RawHistoryMembership>(memSnaps),
    carwash: { loyaltyEvery: carwash.cw.loyaltyEvery, loyaltyStartStamps: carwash.cw.loyaltyStartStamps },
  };
}

/**
 * Construye (o rehace) publicHistory/{token} si el link está activo. Idempotente: si el contenido
 * no cambió, no escribe. Cada construcción lee todo de nuevo, así un evento atrasado se corrige
 * con el siguiente cambio. Devuelve el token o null si el link no está activo.
 */
export async function buildHistory(tid: string, owner: HistoryOwner): Promise<string | null> {
  const snap = await ownerRef(tid, owner).get();
  const link = snap.get("history") as HistoryLink | undefined;
  if (!snap.exists || !link?.enabled || !link.token) return null;
  const token = link.token;
  const view = buildHistoryView(await loadHistoryRaw(tid, owner, snap.data()!));
  const { generatedAt: _g, ...stable } = view;
  const hash = createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 32);
  const ref = db.doc(`${PUBLIC_HISTORY}/${token}`);
  const prev = await ref.get();
  if (prev.exists && prev.get("hash") === hash) return token;
  // El link pudo cambiar (regenerado o desactivado) mientras se armaba: no se escribe un doc huérfano
  const again = await ownerRef(tid, owner).get();
  const now = again.get("history") as HistoryLink | undefined;
  if (!now?.enabled || now.token !== token) return null;
  await ref.set({ ...view, hash, updatedAt: FieldValue.serverTimestamp() });
  return token;
}

/** Rehace los historiales de varios dueños (sin repetir). Los errores se registran y no detienen a los demás. */
export async function rebuildHistories(tid: string, owners: Array<HistoryOwner | null | undefined>) {
  const seen = new Set<string>();
  const list = owners.filter((o): o is HistoryOwner => !!o && !!o.id).filter((o) => {
    const k = `${o.kind}:${o.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await Promise.all(list.map((o) => buildHistory(tid, o).catch((err) => console.error("historial", tid, o, err))));
}

/** Dueños (cliente y empresa) de un vehículo. */
export function ownersOfVehicle(v: FirebaseFirestore.DocumentData | undefined | null): HistoryOwner[] {
  if (!v) return [];
  const out: HistoryOwner[] = [];
  if (v.customerId) out.push({ kind: "customer", id: String(v.customerId) });
  if (v.companyId) out.push({ kind: "company", id: String(v.companyId) });
  return out;
}

export async function ownersOfVehicleId(tid: string, vehicleId: string | null | undefined): Promise<HistoryOwner[]> {
  if (!vehicleId) return [];
  const v = await db.doc(`${col.vehicles(tid)}/${vehicleId}`).get();
  return ownersOfVehicle(v.data());
}

/** Dueños de los vehículos con esa placa (carwash: lavados, lealtad y membresías van por placa). */
export async function ownersOfPlate(tid: string, plate: string | null | undefined): Promise<HistoryOwner[]> {
  if (!plate || isPlaceholderPlate(plate)) return [];
  const snap = await db.collection(col.vehicles(tid)).where("plate", "==", plate).limit(5).get();
  return snap.docs.flatMap((d) => ownersOfVehicle(d.data()));
}
