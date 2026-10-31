import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  buildHistoryView, buildVisitDetail, carwashCol, catalogCol, col, companyCol, HISTORY_TOKEN_LENGTH, HISTORY_VISITS, historyLinkState,
  isPlaceholderPlate, opsCol, orderCol, PUBLIC_HISTORY, quoteCol, VISIT_DETAILS_V,
  type CompanyTerms, type HistoryKind, type HistoryLink, type HistoryRaw, type PublicHistory, type RawHistoryLoyalty, type RawHistoryMaintenance,
  type RawHistoryMembership, type RawHistoryOrder, type RawHistoryPayment, type RawHistoryQuote, type RawHistoryVehicle, type RawHistoryWash,
  type RawVisitEvent, type RawVisitOrder, type RawVisitPhoto, type RawVisitProof, type RawVisitQuote,
} from "@rapifix/shared";
import { db } from "./admin";
import { loadCarwashConfig } from "./carwash";
import { workshopInfo } from "./publicWash";
import { secureToken } from "./token";

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

const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const visitsCol = (token: string) => db.collection(`${PUBLIC_HISTORY}/${token}/${HISTORY_VISITS}`);
const visitIdsOf = (vehicles: unknown): string[] =>
  (Array.isArray(vehicles) ? vehicles : []).flatMap((v: { visits?: Array<{ id?: unknown }> }) => (v?.visits ?? []).map((x) => x?.id)).filter((x): x is string => typeof x === "string" && !!x);

/** ¿El link sigue siendo este token y está activo? */
async function linkStill(tid: string, owner: HistoryOwner, token: string): Promise<boolean> {
  const link = (await ownerRef(tid, owner).get()).get("history") as HistoryLink | undefined;
  return !!link?.enabled && link.token === token;
}

/** Borra todos los detalles de visita de un token (al regenerar o desactivar el link). */
export async function deleteVisitDetails(token: string | null | undefined) {
  if (!token) return;
  await db.recursiveDelete(visitsCol(token));
}

/** Lee lo que falta para el detalle de una orden: actualizaciones y fotos visibles, comprobantes. */
async function visitExtras(tid: string, orderId: string) {
  const orderDoc = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
  const [events, photos, proofs] = await Promise.all([
    orderDoc.collection("events").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(60).get(),
    orderDoc.collection("photos").where("visibleToCustomer", "==", true).orderBy("at", "desc").limit(40).get(),
    db.collection(catalogCol.paymentProofs(tid)).where("orderId", "==", orderId).limit(30).get(),
  ]);
  return {
    events: docs<RawVisitEvent & { id: string }>([events]),
    photos: docs<RawVisitPhoto & { id: string }>([photos]),
    proofs: docs<RawVisitProof & { id: string }>([proofs]),
  };
}

/** Escribe el detalle si cambió (compara un hash). Devuelve true si escribió. */
async function writeVisitDetail(token: string, detail: ReturnType<typeof buildVisitDetail>, knownHash?: string | null): Promise<boolean> {
  const hash = hashOf(detail);
  const ref = visitsCol(token).doc(detail.id);
  const prevHash = knownHash !== undefined ? knownHash : ((await ref.get()).get("hash") as string | undefined) ?? null;
  if (prevHash === hash) return false;
  await ref.set({ ...detail, hash, updatedAt: FieldValue.serverTimestamp() });
  return true;
}

async function inPool<T>(items: T[], size: number, fn: (x: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/**
 * Arma los detalles de visita (publicHistory/{token}/visits/{orderId}) de las visitas que se muestran.
 * - all: todas (al activar, regenerar, o si el historial aún no tenía detalles) y borra las que sobran.
 * - si no: solo las visitas nuevas en la lista, y borra las que salieron. Los cambios de una orden
 *   ya listada los recoge refreshVisitDetail (se llama cada vez que se rehace su portal).
 */
async function syncVisitDetails(tid: string, owner: HistoryOwner, token: string, raw: HistoryRaw, view: PublicHistory, prevIds: string[], all: boolean) {
  const current = visitIdsOf(view.vehicles);
  const currentSet = new Set(current);
  let known = new Map<string, string | null>();
  let toBuild: string[];
  let toDelete: string[];
  if (all) {
    const existing = await visitsCol(token).select("hash").get();
    known = new Map(existing.docs.map((d) => [d.id, (d.get("hash") as string | undefined) ?? null]));
    toBuild = current;
    toDelete = [...known.keys()].filter((id) => !currentSet.has(id));
  } else {
    const prev = new Set(prevIds);
    toBuild = current.filter((id) => !prev.has(id));
    toDelete = prevIds.filter((id) => !currentSet.has(id));
  }
  const orders = new Map(raw.orders.map((o) => [o.id, o as RawVisitOrder]));
  await inPool(toBuild, 6, async (id) => {
    const order = orders.get(id);
    if (!order) return;
    const extras = await visitExtras(tid, id);
    const detail = buildVisitDetail({
      order, quotes: raw.quotes.filter((q) => q.orderId === id) as RawVisitQuote[], payments: raw.payments.filter((p) => p.orderId === id),
      ...extras, ownerName: raw.name,
    });
    await writeVisitDetail(token, detail, all ? known.get(id) ?? null : undefined);
  });
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = db.batch();
    for (const id of toDelete.slice(i, i + 400)) batch.delete(visitsCol(token).doc(id));
    await batch.commit();
  }
  // Si el link cambió mientras se escribía, no quedan detalles bajo el token viejo
  if (toBuild.length && !(await linkStill(tid, owner, token))) await deleteVisitDetails(token);
}

/**
 * Construye (o rehace) publicHistory/{token} si el link está activo. Idempotente: si el contenido
 * no cambió, no escribe. Cada construcción lee todo de nuevo, así un evento atrasado se corrige
 * con el siguiente cambio. También mantiene los detalles de visita (ver syncVisitDetails).
 * `full`: arma todos los detalles (al activar o regenerar). Devuelve el token o null si el link no está activo.
 */
export async function buildHistory(tid: string, owner: HistoryOwner, opts: { full?: boolean } = {}): Promise<string | null> {
  const snap = await ownerRef(tid, owner).get();
  const link = snap.get("history") as HistoryLink | undefined;
  if (!snap.exists || !link?.enabled || !link.token) return null;
  const token = link.token;
  const raw = await loadHistoryRaw(tid, owner, snap.data()!);
  const view = buildHistoryView(raw);
  const { generatedAt: _g, ...stable } = view;
  const hash = hashOf(stable);
  const ref = db.doc(`${PUBLIC_HISTORY}/${token}`);
  const prev = await ref.get();
  // Historiales armados antes de existir el detalle de visitas: se completan la primera vez que se rehacen
  const all = !!opts.full || !prev.exists || prev.get("detailsV") !== VISIT_DETAILS_V;
  if (prev.exists && prev.get("hash") === hash && !all) return token;
  // El link pudo cambiar (regenerado o desactivado) mientras se armaba: no se escribe un doc huérfano
  if (!(await linkStill(tid, owner, token))) return null;
  if (!prev.exists || prev.get("hash") !== hash || prev.get("detailsV") !== VISIT_DETAILS_V) {
    await ref.set({ ...view, hash, detailsV: VISIT_DETAILS_V, updatedAt: FieldValue.serverTimestamp() });
  }
  await syncVisitDetails(tid, owner, token, raw, view, prev.exists ? visitIdsOf(prev.get("vehicles")) : [], all);
  return token;
}

/** Dueño cuyo historial muestra la orden: la empresa si el vehículo es de flota; si no, el cliente. */
export function orderOwner(o: FirebaseFirestore.DocumentData | undefined | null): HistoryOwner | null {
  if (!o) return null;
  if (o.companyId) return { kind: "company", id: String(o.companyId) };
  return o.customerId ? { kind: "customer", id: String(o.customerId) } : null;
}

/**
 * Rehace el detalle de una sola visita (se llama cada vez que se rehace el portal de la orden:
 * cambios de la orden, cotización, pagos, comprobantes, fotos y actualizaciones visibles).
 * Si la orden ya no debe mostrarse (cancelada, el vehículo cambió de dueño o se archivó), borra el detalle.
 */
export async function refreshVisitDetail(tid: string, orderId: string): Promise<void> {
  const orderSnap = await db.doc(`${orderCol.workOrders(tid)}/${orderId}`).get();
  const o = orderSnap.data();
  const owner = orderOwner(o);
  if (!o || !owner) return;
  const ownerSnap = await ownerRef(tid, owner).get();
  const link = ownerSnap.get("history") as HistoryLink | undefined;
  if (!ownerSnap.exists || !link?.enabled || !link.token) return;
  const token = link.token;
  const ref = visitsCol(token).doc(orderId);

  const vehicle = o.vehicleId ? (await db.doc(`${col.vehicles(tid)}/${o.vehicleId}`).get()).data() : undefined;
  const ownsVehicle = !!vehicle && vehicle.archived !== true && (owner.kind === "company" ? vehicle.companyId === owner.id : vehicle.customerId === owner.id && !vehicle.companyId);
  if (o.status === "CANCELLED" || !ownsVehicle) {
    await ref.delete();
    return;
  }
  const [quotes, payments, extras] = await Promise.all([
    db.collection(quoteCol.quotes(tid)).where("orderId", "==", orderId).limit(50).get(),
    db.collection(catalogCol.payments(tid)).where("orderId", "==", orderId).limit(100).get(),
    visitExtras(tid, orderId),
  ]);
  const ownerData = ownerSnap.data()!;
  const detail = buildVisitDetail({
    order: orderRaw({ id: orderId, ...(plain(o) as Record<string, unknown>) }) as RawVisitOrder,
    quotes: docs<RawVisitQuote>([quotes]),
    payments: docs<RawHistoryPayment>([payments]),
    ...extras,
    ownerName: String((owner.kind === "company" ? ownerData.name : ownerData.fullName) ?? ""),
  });
  const wrote = await writeVisitDetail(token, detail);
  if (wrote && !(await linkStill(tid, owner, token))) await ref.delete();
}

// ---------------------------------------------------------------------------
// Activación del link (a mano, sola al crear una orden, o "Activar historial a todos")
// ---------------------------------------------------------------------------
export type EnableSource = "manual" | "order" | "bulk";
const ENABLE_NOTES: Record<EnableSource, string> = {
  manual: "Activó el link del historial para el cliente",
  order: "El historial se activó solo al crear una orden",
  bulk: "Activó el historial con \"Activar historial a todos\"",
};

/**
 * Activa el link en una transacción (sin carreras: si dos procesos lo intentan a la vez, solo uno crea el token).
 * - manual: si ya está activo devuelve el mismo; si estaba desactivado, lo activa con un token nuevo.
 * - order y bulk: solo si NUNCA se activó (historyLinkState "never"). Si el taller lo desactivó, no se toca.
 * Si lo activó, arma el historial completo de inmediato (con los detalles de visita).
 */
export async function enableHistoryFor(
  tid: string, owner: HistoryOwner, source: EnableSource, actorId: string, note?: string,
): Promise<{ token: string | null; changed: boolean }> {
  const ref = ownerRef(tid, owner);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { token: null, changed: false, missing: true };
    const prev = (snap.get("history") as HistoryLink | undefined) ?? null;
    const state = historyLinkState(prev);
    if (state === "active") return { token: prev!.token, changed: false };
    if (source !== "manual" && state !== "never") return { token: null, changed: false };
    const token = secureToken(HISTORY_TOKEN_LENGTH);
    tx.update(ref, {
      history: {
        token, enabled: true, source,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actorId,
        disabledAt: null, disabledBy: null,
      },
    });
    tx.set(db.collection(col.auditLogs(tid)).doc(), {
      action: "update", entity: owner.kind === "company" ? "companies" : "customers", entityId: owner.id, path: ref.path,
      actorId, actorType: source === "order" ? "system" : "user",
      // Sin el token: el registro solo dice si quedó activo
      before: { history: { enabled: false } }, after: { history: { enabled: true } },
      changedFields: ["history"], note: note ?? ENABLE_NOTES[source],
      at: FieldValue.serverTimestamp(),
    });
    return { token, changed: true };
  });
  if ("missing" in result) return { token: null, changed: false };
  if (result.changed && result.token) await buildHistory(tid, owner, { full: true });
  return { token: result.token, changed: result.changed };
}

/**
 * Al crear una orden: activa solo el historial del cliente y, si el vehículo es de flota, el de la empresa,
 * cuando nunca se activaron. Nunca falla la orden: los errores se registran.
 */
export async function autoEnableHistories(tid: string, order: FirebaseFirestore.DocumentData | undefined | null, actorId: string) {
  if (!order) return;
  const owners: HistoryOwner[] = [];
  if (order.customerId) owners.push({ kind: "customer", id: String(order.customerId) });
  if (order.companyId) owners.push({ kind: "company", id: String(order.companyId) });
  const note = order.code ? `El historial se activó solo al crear la orden ${order.code}` : undefined;
  await Promise.all(owners.map((o) => enableHistoryFor(tid, o, "order", actorId, note).catch((err) => console.error("historial automático", tid, o, err))));
}

/** ¿Tiene algo que ver en su historial? (al menos una orden o un lavado de sus vehículos) */
export async function hasHistoryActivity(tid: string, owner: HistoryOwner): Promise<boolean> {
  const field = owner.kind === "company" ? "companyId" : "customerId";
  const orders = await db.collection(orderCol.workOrders(tid)).where(field, "==", owner.id).limit(1).get();
  if (!orders.empty) return true;
  const vehicles = await db.collection(col.vehicles(tid)).where(field, "==", owner.id).limit(30).get();
  const plates = [...new Set(vehicles.docs.map((d) => String(d.get("plate") ?? "")).filter((p) => p && !isPlaceholderPlate(p)))];
  if (!plates.length) return false;
  const washes = await db.collection(carwashCol.washes(tid)).where("plate", "in", plates.slice(0, 30)).limit(1).get();
  return !washes.empty;
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
