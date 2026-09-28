import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  adjustLoyaltyStamps as adjustStamps, adjustLoyaltyStampsSchema, buildSearchKeywords, catalogCol, formatMoney, getWashPayLinkSchema, PUBLIC_WASHES, buildWashItems, cancelMembershipSchema, cancelWashSchema, carwashCol, carwashLookupSchema,
  chargeWashSchema, col, computeWashCharge, extendMembership, isValidPhone, membershipCanUse, membershipWindow, monthsLabel,
  normalizePhone, normalizeText, opsCol, orderCol, reorderCarwashServicesSchema, rewardCap, SAMPLE_CARWASH_MENU,
  saveCarwashPlanSchema, saveCarwashServiceSchema, saveWashSchema, sellMembershipSchema, setWashStatusSchema,
  type AdjustLoyaltyStampsResult, type LoyaltyAdjustment, type WashPayLinkResult,
  washCommissionTotal, assignWasherSchema, carwashVehicleData, hnDayKey, isPendingVehicle, isPlaceholderPlate, applyLoyaltyWash, loyaltyWelcomeFor, fixWashPlateSchema, VEHICLE_SIZE_SHORT, type FixWashPlateResult, linkWashCustomerSchema, pickVehicleForPlate, washPlate,
  type CarwashLookupResult, type LinkWashCustomerResult, type SaveWashResult, type CarwashMembership, type MembershipStatus, type VehicleSize, type WashItem, type WashStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";
import { secureToken } from "../lib/token";
import { buildPublicWash, rebuildPlatePublicWashes } from "../lib/publicWash";
import { CARWASH_MANAGERS, CARWASH_STAFF, CASHIERS, loadCarwashConfig, loadCarwashServices, readWashCharge, toMs, writeCarwashSale, writeWashCharge } from "../lib/carwash";

const bad = (msg: string) => new HttpsError("failed-precondition", msg);

// ============================================================================
// Menú de lavados y planes (admin y gerencia)
// ============================================================================

export const saveCarwashService = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const input = parseInput(saveCarwashServiceSchema, request.data);
  const colRef = db.collection(carwashCol.services(caller.tid));
  const { serviceId, ...data } = input;
  const now = FieldValue.serverTimestamp();
  if (serviceId) {
    const ref = colRef.doc(serviceId);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "El servicio no existe.");
    await ref.update({ ...data, updatedAt: now, updatedBy: caller.uid });
    return { serviceId };
  }
  const all = await colRef.get();
  const sort = all.docs.reduce((m, d) => Math.max(m, Number(d.get("sort") ?? 0)), 0) + 1;
  const ref = await colRef.add({ ...data, sort, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
  return { serviceId: ref.id };
});

export const reorderCarwashServices = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const input = parseInput(reorderCarwashServicesSchema, request.data);
  const colRef = db.collection(carwashCol.services(caller.tid));
  const snaps = await Promise.all(input.ids.map((id) => colRef.doc(id).get()));
  const batch = db.batch();
  snaps.forEach((s, i) => s.exists && batch.update(s.ref, { sort: i + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }));
  await batch.commit();
  return { ok: true };
});

/** Carga el menú de ejemplo (solo agrega los que no existan por nombre). */
export const seedCarwashMenu = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const colRef = db.collection(carwashCol.services(caller.tid));
  const existing = await colRef.get();
  const names = new Set(existing.docs.map((d) => normalizeText(String(d.get("name") ?? ""))));
  let sort = existing.docs.reduce((m, d) => Math.max(m, Number(d.get("sort") ?? 0)), 0);
  const batch = db.batch();
  let created = 0;
  const now = FieldValue.serverTimestamp();
  for (const s of SAMPLE_CARWASH_MENU) {
    if (names.has(normalizeText(s.name))) continue;
    batch.set(colRef.doc(), { ...s, active: true, sort: ++sort, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
    created++;
  }
  if (created) await batch.commit();
  return { created };
});

export const saveCarwashPlan = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const input = parseInput(saveCarwashPlanSchema, request.data);
  const services = await loadCarwashServices(caller.tid);
  const missing = input.includedServiceIds.filter((id) => !services.some((s) => s.id === id));
  if (missing.length) throw new HttpsError("not-found", "Uno de los servicios incluidos ya no existe.");
  const { planId, ...data } = input;
  const colRef = db.collection(carwashCol.plans(caller.tid));
  const now = FieldValue.serverTimestamp();
  if (planId) {
    const ref = colRef.doc(planId);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "El plan no existe.");
    await ref.update({ ...data, updatedAt: now, updatedBy: caller.uid });
    return { planId };
  }
  const ref = await colRef.add({ ...data, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
  return { planId: ref.id };
});

// ============================================================================
// Búsqueda por placa (para registrar rápido). La usan también los lavadores, que no leen
// membresías ni mantenimientos directamente.
// ============================================================================

function membershipView(d: DocumentSnapshot, now: number) {
  const w = membershipWindow(
    {
      status: d.get("status") as MembershipStatus,
      periodStart: toMs(d.get("periodStart")),
      periodEnd: toMs(d.get("periodEnd")),
      paidUntil: toMs(d.get("paidUntil")),
      usedInPeriod: Number(d.get("usedInPeriod") ?? 0),
    },
    now,
  );
  return { ...w, plan: d.get("plan") as CarwashMembership["plan"], paidUntil: toMs(d.get("paidUntil")) };
}

async function activeMembershipFor(tid: string, plate: string, now: number, tx?: FirebaseFirestore.Transaction) {
  if (isPlaceholderPlate(plate)) return null;
  const q = db.collection(carwashCol.memberships(tid)).where("plate", "==", plate);
  const snap = tx ? await tx.get(q) : await q.get();
  for (const d of snap.docs) {
    const v = membershipView(d, now);
    if (v.active) return { doc: d, view: v };
  }
  return null;
}

export const carwashLookup = onCall({ region: REGION }, async (request): Promise<CarwashLookupResult> => {
  const caller = requireRole(request, CARWASH_STAFF);
  const { plate } = parseInput(carwashLookupSchema, request.data);
  const tid = caller.tid;
  const now = Date.now();
  // Sin placa real: no hay tarjeta, vehículo, historial ni membresía que buscar, y varios carros
  // "PENDIENTE" pueden estar en la cola a la vez (no se avisa como placa repetida).
  if (isPlaceholderPlate(plate)) {
    const cfg = await loadCarwashConfig(tid);
    return {
      plate, placeholder: true, vehicle: null, customer: null, history: null,
      loyalty: { count: 0, rewardsAvailable: 0, every: cfg.cw.loyaltyEvery, isNew: false, startStamps: 0 },
      membership: null, maintenance: [], openWash: null,
    };
  }
  const [vehicles, loyalty, cfg, membership, washes] = await Promise.all([
    db.collection(col.vehicles(tid)).where("plate", "==", plate).limit(3).get(),
    db.doc(`${carwashCol.loyalty(tid)}/${plate}`).get(),
    loadCarwashConfig(tid),
    activeMembershipFor(tid, plate, now),
    db.collection(carwashCol.washes(tid)).where("plate", "==", plate).where("status", "in", ["waiting", "washing", "ready"]).limit(3).get(),
  ]);
  const v = vehicles.docs.find((d) => !d.get("archived")) ?? vehicles.docs[0];
  let customer: CarwashLookupResult["customer"] = null;
  let maintenance: CarwashLookupResult["maintenance"] = [];
  // Cliente: el dueño del vehículo o, si la placa no está en el taller, el vinculado a la tarjeta de lealtad
  const ownerId = (v?.get("customerId") as string | undefined) || (loyalty.get("customerId") as string | undefined) || null;
  if (ownerId) {
    const c = await db.doc(`${col.customers(tid)}/${ownerId}`).get();
    if (c.exists) customer = { id: c.id, name: String(c.get("fullName") ?? ""), phone: String(c.get("whatsapp") || c.get("phone") || "") };
  }
  if (v) {
    const m = await db.collection(opsCol.maintenance(tid)).where("vehicleId", "==", v.id).limit(30).get();
    maintenance = m.docs
      .filter((d) => d.get("status") === "due" || d.get("status") === "overdue")
      .map((d) => ({ serviceName: String(d.get("serviceName") ?? ""), status: String(d.get("status")) }));
  }
  const open = washes.docs[0];
  return {
    plate,
    vehicle: v
      ? {
          id: v.id,
          label: isPendingVehicle({ make: v.get("make"), model: v.get("model") }) ? "Vehículo (datos por completar)" : `${v.get("make") ?? ""} ${v.get("model") ?? ""} ${v.get("year") ?? ""}`.trim(),
          customerId: String(v.get("customerId") ?? ""),
        }
      : null,
    customer,
    history: loyalty.exists
      ? {
          customerName: String(loyalty.get("customerName") ?? ""),
          phone: String(loyalty.get("phone") ?? ""),
          size: (loyalty.get("size") as VehicleSize | null) ?? null,
          totalWashes: Number(loyalty.get("totalWashes") ?? 0),
          lastWashAt: toMs(loyalty.get("lastWashAt")) || null,
        }
      : null,
    loyalty: {
      count: Number(loyalty.get("count") ?? 0), rewardsAvailable: Number(loyalty.get("rewardsAvailable") ?? 0), every: cfg.cw.loyaltyEvery,
      isNew: !loyalty.exists || loyalty.get("welcomePending") === true,
      startStamps: cfg.cw.loyaltyStartStamps,
    },
    membership: membership
      ? {
          id: membership.doc.id,
          code: String(membership.doc.get("code")),
          planName: String(membership.doc.get("planName")),
          size: membership.view.plan.size,
          includedServiceIds: membership.view.plan.includedServiceIds,
          includedNames: membership.view.plan.includedNames ?? [],
          washesPerMonth: membership.view.plan.washesPerMonth,
          usedInPeriod: membership.view.usedInPeriod,
          periodEnd: membership.view.periodEnd,
          paidUntil: membership.view.paidUntil,
          canUse: membershipCanUse(membership.view.plan.washesPerMonth, membership.view.usedInPeriod),
        }
      : null,
    maintenance,
    openWash: open ? { id: open.id, code: String(open.get("code")), status: open.get("status") as WashStatus } : null,
  };
});

// ============================================================================
// Clientes y vehículos del taller en el carwash
// ============================================================================

const customerInfoOf = (c: DocumentSnapshot) => ({ fullName: String(c.get("fullName") ?? ""), phone: String(c.get("phone") ?? "") });

/** Año actual en Honduras (para el vehículo mínimo). */
const hnYear = (ms: number) => Number(hnDayKey(ms).slice(0, 4));

/** Vehículo del taller con esa placa (ver pickVehicleForPlate), o null. */
async function findVehicleByPlate(tid: string, plate: string, customerId: string | null) {
  const snap = await db.collection(col.vehicles(tid)).where("plate", "==", plate).limit(10).get();
  return pickVehicleForPlate(snap.docs.map((d) => ({ id: d.id, customerId: (d.get("customerId") as string | null) ?? null, archived: !!d.get("archived") })), customerId);
}

// ============================================================================
// Registrar / editar un lavado
// ============================================================================

export const saveWash = onCall({ region: REGION }, async (request): Promise<SaveWashResult> => {
  const caller = requireRole(request, CARWASH_STAFF);
  const input = parseInput(saveWashSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const [cfg, services] = await Promise.all([loadCarwashConfig(tid), loadCarwashServices(tid)]);
  const now = Date.now();
  // Sin placa real ("PENDIENTE"...): no hay tarjeta, premio, membresía ni vehículo por placa
  const placeholder = isPlaceholderPlate(input.plate);
  if (placeholder && input.useReward) throw bad("Sin placa real no se puede usar el lavado gratis. Escriba la placa del carro.");
  if (placeholder && input.useMembership) throw bad("Sin placa real no se puede usar la membresía. Escriba la placa del carro.");

  // Cliente y vehículo del taller (opcionales)
  let customerId = input.customerId ?? null;
  let customerInfo: { fullName: string; phone: string } | null = null;
  let customerName = input.customerName.trim();
  let phone = input.phone.trim() ? normalizePhone(input.phone) : "";
  if (phone && !isValidPhone(phone)) throw new HttpsError("invalid-argument", "El teléfono no es válido.");
  if (customerId) {
    const c = await db.doc(`${col.customers(tid)}/${customerId}`).get();
    if (!c.exists) throw new HttpsError("not-found", "El cliente no existe.");
    customerInfo = customerInfoOf(c);
    if (!customerName) customerName = customerInfo.fullName;
    if (!phone) phone = String(c.get("whatsapp") || c.get("phone") || "");
  }
  // Vehículo: el indicado (si es de esta placa) o el que ya existe con la placa. Nunca se reasigna de dueño.
  let vehicleId = placeholder ? null : (input.vehicleId ?? null);
  if (vehicleId) {
    const v = await db.doc(`${col.vehicles(tid)}/${vehicleId}`).get();
    if (!v.exists || washPlate(String(v.get("plate") ?? "")) !== input.plate) vehicleId = null;
    else if (!customerId) customerId = String(v.get("customerId") ?? "") || null;
  }
  if (!vehicleId && !placeholder) {
    const found = await findVehicleByPlate(tid, input.plate, customerId);
    if (found) {
      vehicleId = found.id;
      if (!customerId) customerId = found.customerId || null;
    }
  }
  if (customerName.length < 2) throw new HttpsError("invalid-argument", "Escriba el nombre del cliente.");

  // Crear cliente mínimo (solo caja/recepción), o reusar uno con el mismo teléfono
  let newCustomerRef: FirebaseFirestore.DocumentReference | null = null;
  if (input.createCustomer && !customerId && CASHIERS.includes(caller.role)) {
    if (!phone) throw new HttpsError("invalid-argument", "Para crear el cliente escriba su teléfono.");
    const same = await db.collection(col.customers(tid)).where("phone", "==", phone).limit(1).get();
    if (!same.empty) {
      customerId = same.docs[0]!.id;
      customerInfo = customerInfoOf(same.docs[0]!);
    } else {
      newCustomerRef = db.collection(col.customers(tid)).doc();
      customerId = newCustomerRef.id;
      customerInfo = { fullName: customerName.slice(0, 130), phone };
    }
  }
  // Placa nueva de un cliente del taller: se agrega a sus vehículos (también si registra el lavador,
  // porque el cliente ya existe; crear clientes sigue siendo solo de caja).
  const plannedVehicleRef = customerId && !vehicleId && !placeholder ? db.collection(col.vehicles(tid)).doc() : null;

  let washerId = input.washerId ?? null;
  let washerName = "";
  if (washerId) {
    const w = await db.doc(`${orderCol.staff(tid)}/${washerId}`).get();
    if (!w.exists || w.get("active") === false) throw new HttpsError("not-found", "El lavador no existe o está inactivo.");
    washerName = String(w.get("displayName") ?? "");
  }

  const washesCol = db.collection(carwashCol.washes(tid));
  const washRef = input.washId ? washesCol.doc(input.washId) : washesCol.doc();

  return db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const prev = input.washId ? await tx.get(washRef) : null;
    if (prev && !prev.exists) throw new HttpsError("not-found", "El lavado no existe.");
    if (prev) {
      if (!["waiting", "washing", "ready"].includes(prev.get("status"))) throw bad("Este lavado ya no se puede editar.");
      if (prev.get("saleId")) throw bad("Este lavado ya fue cobrado: no se puede editar.");
    }
    const prevPlate = prev ? String(prev.get("plate")) : null;
    const prevReward = prev ? !!prev.get("loyaltyRedeemed") : false;
    const prevMembershipId = prev ? ((prev.get("membershipId") as string | null) ?? null) : null;
    const samePlate = prevPlate === input.plate;

    // Tarjeta de la placa (ninguna si es un marcador). El premio de antes se devuelve a la tarjeta de donde salió.
    const loyaltyRef = placeholder ? null : db.doc(`${carwashCol.loyalty(tid)}/${input.plate}`);
    const prevLoyaltyRef = prevPlate && !samePlate ? db.doc(`${carwashCol.loyalty(tid)}/${prevPlate}`) : null;
    const loyaltySnap = loyaltyRef ? await tx.get(loyaltyRef) : null;

    const keepMembership = !!prevMembershipId && samePlate && input.useMembership;
    const prevMembershipSnap = prevMembershipId ? await tx.get(db.doc(`${carwashCol.memberships(tid)}/${prevMembershipId}`)) : null;
    const found = input.useMembership && !keepMembership ? await activeMembershipFor(tid, input.plate, now, tx) : null;
    const counter = prev ? null : await readCounter(tx, tid, "washes");

    // Vehículo del taller: se revisa otra vez la placa dentro de la transacción para no duplicarla
    let wCustomerId = customerId;
    let wVehicleId = vehicleId;
    let newVehicleRef = plannedVehicleRef;
    if (newVehicleRef) {
      const dup = await tx.get(db.collection(col.vehicles(tid)).where("plate", "==", input.plate).limit(10));
      const pick = pickVehicleForPlate(dup.docs.map((d) => ({ id: d.id, customerId: d.get("customerId") as string | null, archived: !!d.get("archived") })), wCustomerId);
      if (pick) {
        wVehicleId = pick.id;
        newVehicleRef = null;
      } else {
        wVehicleId = newVehicleRef.id;
      }
    }
    // La tarjeta de la placa ya estaba vinculada a un cliente
    if (!wCustomerId && loyaltySnap?.get("customerId")) wCustomerId = String(loyaltySnap.get("customerId"));
    if (!wVehicleId && loyaltySnap?.get("vehicleId")) wVehicleId = String(loyaltySnap.get("vehicleId"));

    // ---------- membresía ----------
    let membershipId: string | null = null;
    let membershipCode: string | null = null;
    let membershipServiceIds: string[] | null = null;
    if (keepMembership && prevMembershipSnap?.exists) {
      membershipId = prevMembershipSnap.id;
      membershipCode = String(prevMembershipSnap.get("code"));
      membershipServiceIds = (prevMembershipSnap.get("plan") as CarwashMembership["plan"]).includedServiceIds;
    } else if (input.useMembership) {
      if (!found) throw bad("Esta placa no tiene una membresía activa.");
      if (!membershipCanUse(found.view.plan.washesPerMonth, found.view.usedInPeriod)) {
        throw bad(`Ya usó los ${found.view.plan.washesPerMonth} lavados de su membresía este mes. Quite la membresía para cobrarlo normal.`);
      }
      membershipId = found.doc.id;
      membershipCode = String(found.doc.get("code"));
      membershipServiceIds = found.view.plan.includedServiceIds;
    }

    // ---------- premio de lealtad ----------
    const keepReward = prevReward && samePlate && input.useReward;
    if (input.useReward && !keepReward && Number(loyaltySnap?.get("rewardsAvailable") ?? 0) < 1) throw bad("Esta placa no tiene lavados gratis disponibles.");
    const cap = input.useReward ? rewardCap(cfg.cw, services, input.size) : null;
    if (input.useReward && cap === null) throw bad("No hay un lavado configurado para el premio en este tamaño.");

    let items: WashItem[];
    try {
      items = buildWashItems({
        size: input.size,
        selections: input.items,
        services: services.filter((s) => s.active || input.items.some((i) => i.serviceId === s.id)),
        membershipServiceIds,
        rewardCap: cap,
      });
    } catch (err) {
      throw new HttpsError("invalid-argument", (err as Error).message);
    }
    const charge = computeWashCharge(items.map((i) => i.price), cfg.taxRate, cfg.cw.taxMode, 0);
    const total = charge.totals.total;
    const commission = washCommissionTotal(items);

    // Si el cliente tiene abierto el link de pago con tarjeta, no se cambia el total (pagaría otro monto)
    if (prev && Number(prev.get("total") ?? 0) !== total) {
      const open = await tx.get(db.collection(catalogCol.onlinePayments(tid)).where("washId", "==", washRef.id).limit(20));
      const live = open.docs.find((d) => ["creating", "pending"].includes(String(d.get("status"))) && toMs(d.get("expiresAt")) > now);
      if (live) {
        const mins = Math.max(1, Math.ceil((toMs(live.get("expiresAt")) - now) / 60000));
        throw bad(`El cliente abrió el link para pagar ${formatMoney(Number(live.get("amount") ?? 0))} con tarjeta. Espere a que pague o a que el link venza (unos ${mins} min) para cambiar el total.`);
      }
    }

    // ---------- escrituras ----------
    if (newCustomerRef) {
      const [firstName, ...rest] = customerName.split(/\s+/);
      tx.set(newCustomerRef, {
        firstName: (firstName ?? customerName).slice(0, 60), lastName: (rest.join(" ") || "-").slice(0, 60), fullName: customerName.slice(0, 130),
        phone, whatsapp: phone, email: "", idNumber: "", rtn: "", address: "", city: "Tegucigalpa", notes: "Registrado desde el carwash",
        status: "active", vehicleCount: 0, openOrders: 0, balanceDue: 0,
        searchKeywords: buildSearchKeywords([customerName, phone.replace(/^\+504/, "")]),
        createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      });
    }
    if (newVehicleRef && wCustomerId) {
      tx.set(newVehicleRef, {
        ...carwashVehicleData({ plate: input.plate, customerId: wCustomerId, customer: customerInfo ?? { fullName: customerName, phone }, year: hnYear(now) }),
        createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      });
    }

    // Devolver premio / uso de membresía que ya no aplica (edición)
    if (prevReward && !keepReward) {
      const ref = prevLoyaltyRef ?? loyaltyRef ?? db.doc(`${carwashCol.loyalty(tid)}/${prevPlate}`);
      tx.set(ref, { rewardsAvailable: FieldValue.increment(1), rewardsUsed: FieldValue.increment(-1) }, { merge: true });
    }
    if (prevMembershipId && !keepMembership && prevMembershipSnap?.exists) {
      tx.update(prevMembershipSnap.ref, { usedInPeriod: Math.max(0, Number(prevMembershipSnap.get("usedInPeriod") ?? 0) - 1), updatedAt: FieldValue.serverTimestamp() });
    }
    if (found && membershipId === found.doc.id) {
      tx.update(found.doc.ref, {
        periodStart: Timestamp.fromMillis(found.view.periodStart),
        periodEnd: Timestamp.fromMillis(found.view.periodEnd),
        usedInPeriod: found.view.usedInPeriod + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Tarjeta de la placa: datos para la próxima visita y consumo del premio (no con placa marcador)
    if (loyaltyRef) {
      const loyaltyPatch: Record<string, unknown> = {
        customerName, phone, size: input.size, lastWashAt: FieldValue.serverTimestamp(),
      };
      // No se borra el vínculo con el cliente si este lavado llega sin cliente
      if (wCustomerId) loyaltyPatch.customerId = wCustomerId;
      if (wVehicleId) loyaltyPatch.vehicleId = wVehicleId;
      // Tarjeta nueva: los sellos de regalo se aplican con el primer lavado que cuente (al cobrarlo)
      if (!loyaltySnap?.exists) Object.assign(loyaltyPatch, { count: 0, rewardsAvailable: 0, rewardsUsed: 0, totalWashes: 0, customerId: wCustomerId, vehicleId: wVehicleId, welcomePending: true });
      if (!prev || !samePlate) loyaltyPatch.totalWashes = FieldValue.increment(1);
      if (input.useReward && !keepReward) {
        loyaltyPatch.rewardsAvailable = FieldValue.increment(-1);
        loyaltyPatch.rewardsUsed = FieldValue.increment(1);
      }
      tx.set(loyaltyRef, loyaltyPatch, { merge: true });
    }

    const common = {
      plate: input.plate, vehicleId: wVehicleId, customerId: wCustomerId, customerName, phone, size: input.size,
      items, total, totals: charge.totals, taxRate: cfg.taxRate, taxMode: cfg.cw.taxMode, discount: 0,
      washerId, washerName, commission,
      paid: total === 0, saleId: null, saleCode: null,
      membershipId, membershipCode, loyaltyRedeemed: !!input.useReward,
      notes: input.notes, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    };
    const linkResult = { customerId: wCustomerId, vehicleId: wVehicleId, vehicleCreated: !!newVehicleRef };
    if (prev) {
      tx.update(washRef, common);
      return { washId: washRef.id, code: String(prev.get("code")), total, paid: total === 0, ...linkResult };
    }
    const code = `LAV-${pad(counter!.next)}`;
    tx.set(counter!.ref, { next: counter!.next + 1 }, { merge: true });
    tx.set(washRef, {
      ...common, number: counter!.next, code, status: "waiting", cancelReason: "", payToken: secureToken(),
      createdAt: FieldValue.serverTimestamp(), startedAt: null, readyAt: null, deliveredAt: null,
      createdBy: caller.uid, createdByName: name,
    });
    return { washId: washRef.id, code, total, paid: total === 0, ...linkResult };
  });
});

// ============================================================================
// Vincular un lavado (de antes, sin cliente) a un cliente del taller. Solo caja/recepción.
// Vincula también los demás lavados y membresías de esa placa que no tenían cliente,
// la tarjeta de lealtad, y agrega la placa a los vehículos del cliente si no existe.
// ============================================================================

export const linkWashCustomer = onCall({ region: REGION }, async (request): Promise<LinkWashCustomerResult> => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(linkWashCustomerSchema, request.data);
  const tid = caller.tid;
  const now = Date.now();
  const washRef = db.doc(`${carwashCol.washes(tid)}/${input.washId}`);
  const customerSnap = await db.doc(`${col.customers(tid)}/${input.customerId}`).get();
  if (!customerSnap.exists) throw new HttpsError("not-found", "El cliente no existe.");
  const customer = customerInfoOf(customerSnap);
  const customerPhone = String(customerSnap.get("whatsapp") || customerSnap.get("phone") || "");

  return db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const w = await tx.get(washRef);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    const current = (w.get("customerId") as string | null) ?? null;
    if (current && current !== input.customerId) throw bad("Este lavado ya está vinculado a otro cliente.");
    const plate = String(w.get("plate"));
    // Sin placa real: solo se vincula el cliente a este lavado (sin vehículo, tarjeta ni otros lavados "PENDIENTE")
    if (isPlaceholderPlate(plate)) {
      if (input.vehicleId) throw bad("Este lavado no tiene placa real: corrija la placa antes de elegir un vehículo.");
      tx.update(washRef, {
        customerId: input.customerId, vehicleId: null,
        customerName: customer.fullName || String(w.get("customerName") ?? ""),
        phone: String(w.get("phone") || customerPhone),
        updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      });
      return { customerId: input.customerId, vehicleId: null, vehicleCreated: false, linkedWashes: 1 };
    }
    const loyaltyRef = db.doc(`${carwashCol.loyalty(tid)}/${plate}`);
    const loyalty = await tx.get(loyaltyRef);

    let vehicleId: string | null = null;
    let newVehicleRef: FirebaseFirestore.DocumentReference | null = null;
    if (input.vehicleId) {
      const v = await tx.get(db.doc(`${col.vehicles(tid)}/${input.vehicleId}`));
      if (!v.exists) throw new HttpsError("not-found", "El vehículo no existe.");
      if (washPlate(String(v.get("plate") ?? "")) !== plate) throw bad("El vehículo elegido no tiene la placa de este lavado.");
      vehicleId = v.id;
    } else {
      const same = await tx.get(db.collection(col.vehicles(tid)).where("plate", "==", plate).limit(10));
      const pick = pickVehicleForPlate(same.docs.map((d) => ({ id: d.id, customerId: (d.get("customerId") as string | null) ?? null, archived: !!d.get("archived") })), input.customerId);
      if (pick) vehicleId = pick.id;
      else {
        newVehicleRef = db.collection(col.vehicles(tid)).doc();
        vehicleId = newVehicleRef.id;
      }
    }
    const others = await tx.get(db.collection(carwashCol.washes(tid)).where("plate", "==", plate).limit(300));
    const memberships = await tx.get(db.collection(carwashCol.memberships(tid)).where("plate", "==", plate).limit(50));

    // ---------- escrituras ----------
    if (newVehicleRef) {
      tx.set(newVehicleRef, {
        ...carwashVehicleData({ plate, customerId: input.customerId, customer, year: hnYear(now) }),
        createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
      });
    }
    const meta = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
    tx.update(washRef, {
      customerId: input.customerId, vehicleId,
      customerName: customer.fullName || String(w.get("customerName") ?? ""),
      phone: String(w.get("phone") || customerPhone),
      ...meta,
    });
    let linked = 1;
    for (const d of others.docs) {
      if (d.id === washRef.id || d.get("customerId")) continue;
      tx.update(d.ref, { customerId: input.customerId, vehicleId, ...meta });
      linked++;
    }
    for (const m of memberships.docs) {
      if (m.get("customerId")) continue;
      tx.update(m.ref, { customerId: input.customerId, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(loyaltyRef, {
      customerId: input.customerId, vehicleId,
      customerName: customer.fullName || String(loyalty.get("customerName") ?? ""),
      phone: String(loyalty.get("phone") || customerPhone),
      ...(loyalty.exists ? {} : { count: 0, rewardsAvailable: 0, rewardsUsed: 0, totalWashes: 1, size: w.get("size") ?? null, lastWashAt: w.get("createdAt") ?? null, welcomePending: true }),
    }, { merge: true });
    return { customerId: input.customerId, vehicleId: vehicleId!, vehicleCreated: !!newVehicleRef, linkedWashes: linked };
  });
});

// ============================================================================
// Corregir la placa de un lavado registrado sin placa real ("PENDIENTE"...) que ya no se puede
// editar (cobrado o entregado). Solo caja/recepción. Si el lavado ya se cobró y no sumó sello
// (sin membresía ni premio), el sello se suma ahora a la tarjeta de la placa real, con los
// sellos de regalo si la tarjeta es nueva, en la misma transacción.
// ============================================================================

export const fixWashPlate = onCall({ region: REGION }, async (request): Promise<FixWashPlateResult> => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(fixWashPlateSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const cfg = await loadCarwashConfig(tid);
  const washRef = db.doc(`${carwashCol.washes(tid)}/${input.washId}`);
  const loyaltyRef = db.doc(`${carwashCol.loyalty(tid)}/${input.plate}`);

  const result = await db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const w = await tx.get(washRef);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    const status = w.get("status") as WashStatus;
    if (status === "cancelled") throw bad("El lavado está cancelado.");
    const oldPlate = String(w.get("plate") ?? "");
    if (!isPlaceholderPlate(oldPlate)) throw bad("Este lavado ya tiene placa real.");
    const editable = ["waiting", "washing", "ready"].includes(status) && !w.get("saleId") && !w.get("paid");
    if (editable) throw bad("Este lavado aún se puede editar: corrija la placa con Editar.");
    const loyalty = await tx.get(loyaltyRef);
    const saleId = (w.get("saleId") as string | null) ?? null;
    const sale = saleId ? await tx.get(db.doc(`${catalogCol.sales(tid)}/${saleId}`)) : null;
    let customerId = (w.get("customerId") as string | null) ?? null;
    const vehicles = await tx.get(db.collection(col.vehicles(tid)).where("plate", "==", input.plate).limit(10));
    const pick = pickVehicleForPlate(vehicles.docs.map((d) => ({ id: d.id, customerId: (d.get("customerId") as string | null) ?? null, archived: !!d.get("archived") })), customerId);
    // El vehículo del taller se enlaza solo si es del mismo cliente (o el lavado no tenía cliente)
    let vehicleId: string | null = pick && (!customerId || pick.customerId === customerId) ? pick.id : null;
    if (!customerId && pick) customerId = pick.customerId || null;
    if (!customerId && loyalty.get("customerId")) customerId = String(loyalty.get("customerId"));
    if (!vehicleId && !w.get("customerId") && loyalty.get("vehicleId")) vehicleId = String(loyalty.get("vehicleId"));

    // ---------- sello retroactivo ----------
    const items = (w.get("items") as WashItem[]) ?? [];
    const main = items.find((i) => i.kind === "wash");
    const every = cfg.cw.loyaltyEvery;
    const counts =
      !!saleId && !!w.get("paid") && sale?.exists === true && sale.get("status") !== "voided" &&
      !w.get("loyaltyCounted") && !w.get("membershipId") && !w.get("loyaltyRedeemed") &&
      !!main && !main.covered && every > 0;
    const welcome = counts ? loyaltyWelcomeFor({ exists: loyalty.exists, welcomePending: loyalty.get("welcomePending") }, cfg.cw) : 0;
    const after = counts
      ? applyLoyaltyWash({ count: Number(loyalty.get("count") ?? 0), rewardsAvailable: Number(loyalty.get("rewardsAvailable") ?? 0) }, every, welcome)
      : null;

    // ---------- escrituras ----------
    const customerName = String(w.get("customerName") ?? "");
    const phone = String(w.get("phone") ?? "");
    const size = (w.get("size") as VehicleSize | null) ?? null;
    const patch: Record<string, unknown> = { customerName, phone, size, lastWashAt: FieldValue.serverTimestamp(), totalWashes: FieldValue.increment(1) };
    if (customerId) patch.customerId = customerId;
    if (vehicleId) patch.vehicleId = vehicleId;
    if (!loyalty.exists) Object.assign(patch, { count: 0, rewardsAvailable: 0, rewardsUsed: 0, totalWashes: 1, customerId, vehicleId, welcomePending: true });
    if (after) {
      Object.assign(patch, { count: after.count, rewardsAvailable: after.rewardsAvailable });
      if (!loyalty.exists || loyalty.get("welcomePending") === true) Object.assign(patch, { welcomePending: false, welcomeStamps: welcome });
    }
    tx.set(loyaltyRef, patch, { merge: true });

    tx.update(washRef, {
      plate: input.plate, customerId, vehicleId,
      ...(after ? { loyaltyCounted: true, loyaltyStamps: after.count, loyaltyEvery: every, ...(welcome > 0 ? { loyaltyWelcome: welcome } : {}) } : {}),
      plateFixedFrom: oldPlate,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    if (sale?.exists && sale.get("status") !== "voided") {
      const label = String(sale.get("vehicleLabel") ?? "");
      const fixed = label.includes(`placa ${oldPlate}`) ? label.replace(`placa ${oldPlate}`, `placa ${input.plate}`) : `${VEHICLE_SIZE_SHORT[size as VehicleSize] ?? ""} · placa ${input.plate}`;
      tx.update(sale.ref, { vehicleLabel: fixed });
    }
    tx.set(db.collection(col.auditLogs(tid)).doc(), {
      action: "update", entity: "carwashWash", entityId: washRef.id, path: washRef.path,
      actorId: caller.uid, actorType: "user",
      before: { plate: oldPlate }, after: { plate: input.plate },
      changedFields: ["plate"],
      note: `Placa corregida ${oldPlate} -> ${input.plate} (${name})${after ? ": se sumó el sello del lavado cobrado" : ""}`,
      at: FieldValue.serverTimestamp(),
    });
    return { plate: input.plate, stampAdded: !!after, earnedReward: !!after?.earned, stamps: after?.count ?? null };
  });
  return result;
});

// ============================================================================
// Estado, lavador y cancelación
// ============================================================================

const STAGE = { waiting: 0, washing: 1, ready: 2, delivered: 3 } as const;

export const setWashStatus = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_STAFF);
  const input = parseInput(setWashStatusSchema, request.data);
  const name = await actorName(caller.uid, caller.email);
  const ref = db.doc(`${carwashCol.washes(caller.tid)}/${input.washId}`);
  return db.runTransaction(async (tx) => {
    const w = await tx.get(ref);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    const from = w.get("status") as WashStatus;
    if (from === "delivered" || from === "cancelled") throw bad(`El lavado ya está ${from === "delivered" ? "entregado" : "cancelado"}.`);
    if (from === input.status) return { ok: true };
    const to = input.status;
    const patch: Record<string, unknown> = { status: to, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
    const idx = STAGE[to];
    const now = FieldValue.serverTimestamp();
    if (idx >= 1 && !w.get("startedAt")) patch.startedAt = now;
    if (idx >= 2 && !w.get("readyAt")) patch.readyAt = now;
    if (idx < 1) patch.startedAt = null;
    if (idx < 2) patch.readyAt = null;
    if (to === "delivered") {
      const paid = !!w.get("paid") || Number(w.get("total") ?? 0) === 0;
      if (!paid) {
        if (!CARWASH_MANAGERS.includes(caller.role)) throw bad("Cobre el lavado antes de entregarlo. Solo gerencia puede entregar sin cobrar.");
        patch.deliveredUnpaid = true;
      }
      patch.deliveredAt = now;
    }
    // El lavador que empieza un carro sin asignar queda asignado
    if (to === "washing" && !w.get("washerId") && caller.role === "washer") {
      patch.washerId = caller.uid;
      patch.washerName = name;
    }
    tx.update(ref, patch);
    return { ok: true };
  });
});

export const assignWasher = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_STAFF);
  const input = parseInput(assignWasherSchema, request.data);
  const tid = caller.tid;
  let washerName = "";
  if (input.washerId) {
    const s = await db.doc(`${orderCol.staff(tid)}/${input.washerId}`).get();
    if (!s.exists || s.get("active") === false) throw new HttpsError("not-found", "El lavador no existe o está inactivo.");
    washerName = String(s.get("displayName") ?? "");
  }
  const ref = db.doc(`${carwashCol.washes(tid)}/${input.washId}`);
  const w = await ref.get();
  if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
  if (w.get("status") === "cancelled") throw bad("El lavado está cancelado.");
  if (w.get("status") === "delivered" && !CARWASH_MANAGERS.includes(caller.role)) throw bad("Solo gerencia cambia el lavador de un carro entregado.");
  await ref.update({ washerId: input.washerId, washerName, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  return { ok: true };
});

export const cancelWash = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_STAFF);
  const input = parseInput(cancelWashSchema, request.data);
  const tid = caller.tid;
  const ref = db.doc(`${carwashCol.washes(tid)}/${input.washId}`);
  return db.runTransaction(async (tx) => {
    const w = await tx.get(ref);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    if (w.get("status") === "cancelled") throw bad("El lavado ya está cancelado.");
    if (w.get("status") === "delivered") throw bad("El lavado ya fue entregado.");
    if (w.get("saleId")) throw bad("El lavado ya fue cobrado. Anule primero la venta en Pagos.");
    const mid = w.get("membershipId") as string | null;
    const m = mid ? await tx.get(db.doc(`${carwashCol.memberships(tid)}/${mid}`)) : null;
    if (w.get("loyaltyRedeemed")) {
      tx.set(db.doc(`${carwashCol.loyalty(tid)}/${w.get("plate")}`), { rewardsAvailable: FieldValue.increment(1), rewardsUsed: FieldValue.increment(-1) }, { merge: true });
    }
    if (m?.exists) tx.update(m.ref, { usedInPeriod: Math.max(0, Number(m.get("usedInPeriod") ?? 0) - 1), updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, {
      status: "cancelled", cancelReason: input.reason, cancelledAt: FieldValue.serverTimestamp(),
      paid: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    return { ok: true };
  });
});

// ============================================================================
// Cobro del lavado: venta del carwash + pagos + sello de lealtad
// ============================================================================

export const chargeWash = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(chargeWashSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const cfg = await loadCarwashConfig(tid);

  return db.runTransaction(async (tx) => {
    const r = await readWashCharge(tx, tid, input.washId);
    if (r.wash.exists && r.wash.get("saleId") && !r.wash.get("paid")) {
      throw bad(`Este lavado tiene un pago en línea incompleto (venta ${r.wash.get("saleCode")}). Revíselo en Pagos.`);
    }
    const res = writeWashCharge(tx, r, { cfg, uid: caller.uid, byName: name, discount: input.discount, payments: input.payments, mode: "exact" });
    return { saleId: res.saleId, code: res.code, paymentIds: res.paymentIds, earnedReward: res.earnedReward, stamps: res.stamps };
  });
});

// ============================================================================
// Membresías: vender / renovar (cobro) y cancelar
// ============================================================================

export const sellMembership = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(sellMembershipSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const [cfg, services, planSnap] = await Promise.all([
    loadCarwashConfig(tid),
    loadCarwashServices(tid),
    db.doc(`${carwashCol.plans(tid)}/${input.planId}`).get(),
  ]);
  if (!planSnap.exists) throw new HttpsError("not-found", "El plan no existe.");
  if (!input.membershipId && planSnap.get("active") === false) throw bad("El plan está desactivado.");
  let customerId = input.customerId ?? null;
  let customerName = input.customerName.trim();
  let phone = input.phone.trim() ? normalizePhone(input.phone) : "";
  if (customerId) {
    const c = await db.doc(`${col.customers(tid)}/${customerId}`).get();
    if (!c.exists) throw new HttpsError("not-found", "El cliente no existe.");
    if (!customerName) customerName = String(c.get("fullName") ?? "");
    if (!phone) phone = String(c.get("whatsapp") || c.get("phone") || "");
  }
  const includedServiceIds = (planSnap.get("includedServiceIds") as string[]) ?? [];
  const plan = {
    size: planSnap.get("size") as VehicleSize,
    price: Number(planSnap.get("price") ?? 0),
    includedServiceIds,
    includedNames: includedServiceIds.map((id) => services.find((s) => s.id === id)?.name ?? "").filter(Boolean),
    washesPerMonth: (planSnap.get("washesPerMonth") as number | null) ?? null,
  };
  const planName = String(planSnap.get("name"));
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const colRef = db.collection(carwashCol.memberships(tid));
    const existing = input.membershipId ? await tx.get(colRef.doc(input.membershipId)) : null;
    if (existing && !existing.exists) throw new HttpsError("not-found", "La membresía no existe.");
    if (existing?.get("status") === "cancelled") throw bad("La membresía está cancelada. Venda una nueva.");
    const plate = existing ? String(existing.get("plate")) : input.plate;
    if (!existing && isPlaceholderPlate(plate)) throw bad("Sin placa real no se puede vender una membresía. Escriba la placa del carro.");
    if (!existing) {
      const dup = await activeMembershipFor(tid, plate, now, tx);
      if (dup) throw bad(`La placa ya tiene la membresía activa ${dup.doc.get("code")}. Renuévela en lugar de crear otra.`);
    }
    const memCounter = existing ? null : await readCounter(tx, tid, "memberships");
    const saleCounter = await readCounter(tx, tid, "sales");
    const payCounter = await readCounter(tx, tid, "payments");

    if (existing) {
      if (!customerName) customerName = String(existing.get("customerName") ?? "");
      if (!phone) phone = String(existing.get("phone") ?? "");
      if (!customerId) customerId = (existing.get("customerId") as string | null) ?? null;
    }
    if (customerName.length < 2) throw new HttpsError("invalid-argument", "Escriba el nombre del cliente.");

    // ---------- cálculo ----------
    const current = existing ? membershipView(existing, now) : null;
    const ext = extendMembership(current ? { ...current } : null, input.months, now);
    const charge = computeWashCharge([plan.price * input.months], cfg.taxRate, cfg.cw.taxMode, 0);
    const total = charge.totals.total;
    const paidTotal = input.payments.reduce((a, p) => a + p.amount, 0);
    if (paidTotal !== total) throw new HttpsError("invalid-argument", "Los pagos deben sumar exactamente el total a cobrar.");

    const memRef = existing ? existing.ref : colRef.doc();
    const code = existing ? String(existing.get("code")) : `MEM-${pad(memCounter!.next)}`;
    const label = monthsLabel(ext.from, ext.paidUntil);

    // ---------- escrituras ----------
    const sale = writeCarwashSale(tx, {
      tid, uid: caller.uid, byName: name, saleCounter, payCounter,
      customerId, customerName, vehicleId: null, vehicleLabel: `Placa ${plate}`,
      items: [{
        refId: input.planId,
        description: `Membresía ${planName} (${label})${input.months > 1 ? ` · ${input.months} meses` : ""}`,
        unitPrice: charge.lines[0]!.unitPrice, discount: charge.lines[0]!.discount, taxable: charge.lines[0]!.taxable, lineTotal: charge.lines[0]!.lineTotal,
      }],
      taxRate: cfg.taxRate, totals: charge.totals, payments: input.payments, washId: null,
      extra: { membershipId: memRef.id, membershipCode: code },
    });
    const entry = { kind: existing ? "renewal" : "new", saleId: sale.saleId, saleCode: sale.code, months: input.months, amount: total, at: now };
    const base = {
      customerId, customerName, phone, plate, planId: input.planId, planName, plan,
      status: "active",
      periodStart: Timestamp.fromMillis(ext.periodStart),
      periodEnd: Timestamp.fromMillis(ext.periodEnd),
      paidUntil: Timestamp.fromMillis(ext.paidUntil),
      usedInPeriod: ext.usedInPeriod,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (existing) {
      tx.update(memRef, {
        ...base,
        totalPaid: FieldValue.increment(total),
        renewals: FieldValue.increment(1),
        history: FieldValue.arrayUnion(entry),
      });
    } else {
      tx.set(memCounter!.ref, { next: memCounter!.next + 1 }, { merge: true });
      tx.set(memRef, {
        ...base, number: memCounter!.next, code, totalPaid: total, renewals: 0, history: [entry], cancelReason: "",
        createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, createdByName: name,
      });
    }
    return { membershipId: memRef.id, code, saleId: sale.saleId, saleCode: sale.code, paidUntil: ext.paidUntil };
  });
});

export const cancelMembership = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const input = parseInput(cancelMembershipSchema, request.data);
  const ref = db.doc(`${carwashCol.memberships(caller.tid)}/${input.membershipId}`);
  const m = await ref.get();
  if (!m.exists) throw new HttpsError("not-found", "La membresía no existe.");
  if (m.get("status") === "cancelled") throw bad("La membresía ya está cancelada.");
  await ref.update({ status: "cancelled", cancelReason: input.reason, cancelledAt: FieldValue.serverTimestamp(), cancelledBy: caller.uid, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ============================================================================
// Link público del lavado (/lavado/:token): ver, pagar con tarjeta o subir comprobante
// ============================================================================

/** Devuelve el token del link del lavado; si el lavado es de antes y no tiene, lo crea. Caja y lavadores. */
export const getWashPayLink = onCall({ region: REGION }, async (request): Promise<WashPayLinkResult> => {
  const caller = requireRole(request, CARWASH_STAFF);
  const { washId } = parseInput(getWashPayLinkSchema, request.data);
  const tid = caller.tid;
  const ref = db.doc(`${carwashCol.washes(tid)}/${washId}`);
  const token = await db.runTransaction(async (tx) => {
    const w = await tx.get(ref);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    if (w.get("status") === "cancelled") throw bad("El lavado está cancelado.");
    const current = w.get("payToken") as string | undefined;
    if (current) return current;
    let t = secureToken();
    // Muy improbable, pero se revisa que el token no esté usado
    for (let i = 0; i < 3 && (await tx.get(db.doc(`${PUBLIC_WASHES}/${t}`))).exists; i++) t = secureToken();
    tx.update(ref, { payToken: t });
    return t;
  });
  // Se arma la página pública ya, para que el link funcione al instante
  await buildPublicWash(tid, washId);
  return { token };
});

// ============================================================================
// Ajuste manual de sellos de lealtad (promociones o correcciones). Solo admin y gerencia.
// ============================================================================

export const adjustLoyaltyStamps = onCall({ region: REGION }, async (request): Promise<AdjustLoyaltyStampsResult> => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  const input = parseInput(adjustLoyaltyStampsSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const cfg = await loadCarwashConfig(tid);
  const every = cfg.cw.loyaltyEvery;
  if (!(every > 0)) throw bad("La tarjeta de lealtad está desactivada en la configuración del carwash.");
  if (isPlaceholderPlate(input.plate)) throw bad("Esa no es una placa real: las placas \"PENDIENTE\" y similares no tienen tarjeta de lealtad.");
  const ref = db.doc(`${carwashCol.loyalty(tid)}/${input.plate}`);

  const result = await db.runTransaction(async (tx) => {
    const l = await tx.get(ref);
    if (!l.exists) throw new HttpsError("not-found", "Esta placa aún no tiene tarjeta de lealtad.");
    const before = { count: Number(l.get("count") ?? 0), rewardsAvailable: Number(l.get("rewardsAvailable") ?? 0) };
    if (input.delta < 0 && before.count <= 0) throw bad("La tarjeta ya está en 0 sellos.");
    const after = adjustStamps(before, input.delta, every);
    const entry: LoyaltyAdjustment = {
      delta: input.delta, reason: input.reason, countBefore: before.count, countAfter: after.count, rewardsEarned: after.rewardsEarned,
      by: caller.uid, byName: name, at: Date.now(),
    };
    tx.update(ref, { count: after.count, rewardsAvailable: after.rewardsAvailable, adjustments: FieldValue.arrayUnion(entry) });
    tx.set(db.collection(col.auditLogs(tid)).doc(), {
      action: "update", entity: "carwashLoyalty", entityId: input.plate, path: ref.path,
      actorId: caller.uid, actorType: "user",
      before, after: { count: after.count, rewardsAvailable: after.rewardsAvailable },
      changedFields: ["count", "rewardsAvailable"],
      note: `Ajuste de sellos ${input.delta > 0 ? "+" : ""}${input.delta} (${name}): ${input.reason}`,
      at: FieldValue.serverTimestamp(),
    });
    return after;
  });
  await rebuildPlatePublicWashes(tid, input.plate);
  return result;
});
