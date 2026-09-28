import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import {
  applyLoyaltyWash, buildSearchKeywords, buildWashItems, cancelMembershipSchema, cancelWashSchema, carwashCol, carwashLookupSchema,
  chargeWashSchema, col, computeWashCharge, extendMembership, isValidPhone, membershipCanUse, membershipWindow, monthsLabel,
  normalizePhone, normalizeText, opsCol, orderCol, reorderCarwashServicesSchema, rewardCap, SAMPLE_CARWASH_MENU,
  saveCarwashPlanSchema, saveCarwashServiceSchema, saveWashSchema, sellMembershipSchema, setWashStatusSchema, VEHICLE_SIZE_SHORT,
  washCommissionTotal, assignWasherSchema,
  type CarwashLookupResult, type CarwashMembership, type MembershipStatus, type VehicleSize, type WashItem, type WashStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";
import { CARWASH_MANAGERS, CARWASH_STAFF, CASHIERS, loadCarwashConfig, loadCarwashServices, toMs, writeCarwashSale } from "../lib/carwash";

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
  if (v) {
    const c = await db.doc(`${col.customers(tid)}/${v.get("customerId")}`).get();
    if (c.exists) customer = { id: c.id, name: String(c.get("fullName") ?? ""), phone: String(c.get("whatsapp") || c.get("phone") || "") };
    const m = await db.collection(opsCol.maintenance(tid)).where("vehicleId", "==", v.id).limit(30).get();
    maintenance = m.docs
      .filter((d) => d.get("status") === "due" || d.get("status") === "overdue")
      .map((d) => ({ serviceName: String(d.get("serviceName") ?? ""), status: String(d.get("status")) }));
  }
  const open = washes.docs[0];
  return {
    plate,
    vehicle: v ? { id: v.id, label: `${v.get("make") ?? ""} ${v.get("model") ?? ""} ${v.get("year") ?? ""}`.trim(), customerId: String(v.get("customerId") ?? "") } : null,
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
    loyalty: { count: Number(loyalty.get("count") ?? 0), rewardsAvailable: Number(loyalty.get("rewardsAvailable") ?? 0), every: cfg.cw.loyaltyEvery },
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
// Registrar / editar un lavado
// ============================================================================

export const saveWash = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_STAFF);
  const input = parseInput(saveWashSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const [cfg, services] = await Promise.all([loadCarwashConfig(tid), loadCarwashServices(tid)]);
  const now = Date.now();

  // Cliente y vehículo del taller (opcionales)
  let customerId = input.customerId ?? null;
  let customerName = input.customerName.trim();
  let phone = input.phone.trim() ? normalizePhone(input.phone) : "";
  if (phone && !isValidPhone(phone)) throw new HttpsError("invalid-argument", "El teléfono no es válido.");
  if (customerId) {
    const c = await db.doc(`${col.customers(tid)}/${customerId}`).get();
    if (!c.exists) throw new HttpsError("not-found", "El cliente no existe.");
    if (!customerName) customerName = String(c.get("fullName") ?? "");
    if (!phone) phone = String(c.get("whatsapp") || c.get("phone") || "");
  }
  let vehicleId = input.vehicleId ?? null;
  if (vehicleId) {
    const v = await db.doc(`${col.vehicles(tid)}/${vehicleId}`).get();
    if (!v.exists) vehicleId = null;
    else if (!customerId) customerId = String(v.get("customerId") ?? "") || null;
  }
  if (customerName.length < 2) throw new HttpsError("invalid-argument", "Escriba el nombre del cliente.");

  // Crear cliente mínimo (solo caja/recepción), o reusar uno con el mismo teléfono
  let newCustomerRef: FirebaseFirestore.DocumentReference | null = null;
  if (input.createCustomer && !customerId && CASHIERS.includes(caller.role)) {
    if (!phone) throw new HttpsError("invalid-argument", "Para crear el cliente escriba su teléfono.");
    const same = await db.collection(col.customers(tid)).where("phone", "==", phone).limit(1).get();
    if (!same.empty) customerId = same.docs[0]!.id;
    else {
      newCustomerRef = db.collection(col.customers(tid)).doc();
      customerId = newCustomerRef.id;
    }
  }

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

    const loyaltyRef = db.doc(`${carwashCol.loyalty(tid)}/${input.plate}`);
    const prevLoyaltyRef = prevPlate && !samePlate ? db.doc(`${carwashCol.loyalty(tid)}/${prevPlate}`) : null;
    const loyaltySnap = await tx.get(loyaltyRef);

    const keepMembership = !!prevMembershipId && samePlate && input.useMembership;
    const prevMembershipSnap = prevMembershipId ? await tx.get(db.doc(`${carwashCol.memberships(tid)}/${prevMembershipId}`)) : null;
    const found = input.useMembership && !keepMembership ? await activeMembershipFor(tid, input.plate, now, tx) : null;
    const counter = prev ? null : await readCounter(tx, tid, "washes");

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
    if (input.useReward && !keepReward && Number(loyaltySnap.get("rewardsAvailable") ?? 0) < 1) throw bad("Esta placa no tiene lavados gratis disponibles.");
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

    // Devolver premio / uso de membresía que ya no aplica (edición)
    if (prevReward && !keepReward) {
      const ref = prevLoyaltyRef ?? loyaltyRef;
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

    // Tarjeta de la placa: datos para la próxima visita y consumo del premio
    const loyaltyPatch: Record<string, unknown> = {
      customerName, phone, size: input.size, customerId, vehicleId, lastWashAt: FieldValue.serverTimestamp(),
    };
    if (!loyaltySnap.exists) Object.assign(loyaltyPatch, { count: 0, rewardsAvailable: 0, rewardsUsed: 0, totalWashes: 0 });
    if (!prev || !samePlate) loyaltyPatch.totalWashes = FieldValue.increment(1);
    if (input.useReward && !keepReward) {
      loyaltyPatch.rewardsAvailable = FieldValue.increment(-1);
      loyaltyPatch.rewardsUsed = FieldValue.increment(1);
    }
    tx.set(loyaltyRef, loyaltyPatch, { merge: true });

    const common = {
      plate: input.plate, vehicleId, customerId, customerName, phone, size: input.size,
      items, total, totals: charge.totals, taxRate: cfg.taxRate, taxMode: cfg.cw.taxMode, discount: 0,
      washerId, washerName, commission,
      paid: total === 0, saleId: null, saleCode: null,
      membershipId, membershipCode, loyaltyRedeemed: !!input.useReward,
      notes: input.notes, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    };
    if (prev) {
      tx.update(washRef, common);
      return { washId: washRef.id, code: String(prev.get("code")), total, paid: total === 0 };
    }
    const code = `LAV-${pad(counter!.next)}`;
    tx.set(counter!.ref, { next: counter!.next + 1 }, { merge: true });
    tx.set(washRef, {
      ...common, number: counter!.next, code, status: "waiting", cancelReason: "",
      createdAt: FieldValue.serverTimestamp(), startedAt: null, readyAt: null, deliveredAt: null,
      createdBy: caller.uid, createdByName: name,
    });
    return { washId: washRef.id, code, total, paid: total === 0 };
  });
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
  const ref = db.doc(`${carwashCol.washes(tid)}/${input.washId}`);

  return db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const w = await tx.get(ref);
    if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
    if (w.get("status") === "cancelled") throw bad("El lavado está cancelado.");
    if (w.get("saleId")) throw bad(`Este lavado ya fue cobrado (${w.get("saleCode")}).`);
    const plate = String(w.get("plate"));
    const loyaltyRef = db.doc(`${carwashCol.loyalty(tid)}/${plate}`);
    const loyalty = await tx.get(loyaltyRef);
    const saleCounter = await readCounter(tx, tid, "sales");
    const payCounter = await readCounter(tx, tid, "payments");

    // ---------- cálculo ----------
    const items = (w.get("items") as WashItem[]) ?? [];
    const gross = items.reduce((a, i) => a + i.price, 0);
    if (input.discount > gross) throw new HttpsError("invalid-argument", "El descuento es mayor que el total.");
    // Se respeta el modo de ISV con que se registró el lavado
    const taxMode = (w.get("taxMode") as typeof cfg.cw.taxMode) ?? cfg.cw.taxMode;
    const taxRate = Number(w.get("taxRate") ?? cfg.taxRate);
    const charge = computeWashCharge(items.map((i) => i.price), taxRate, taxMode, input.discount);
    const total = charge.totals.total;
    if (total <= 0) throw bad("El total es 0: no hay nada que cobrar.");
    const paidTotal = input.payments.reduce((a, p) => a + p.amount, 0);
    if (paidTotal !== total) throw new HttpsError("invalid-argument", "Los pagos deben sumar exactamente el total a cobrar.");

    const size = w.get("size") as VehicleSize;
    const main = items.find((i) => i.kind === "wash");
    const counts = !!main && !main.covered && cfg.cw.loyaltyEvery > 0;
    const loyaltyAfter = counts
      ? applyLoyaltyWash({ count: Number(loyalty.get("count") ?? 0), rewardsAvailable: Number(loyalty.get("rewardsAvailable") ?? 0) }, cfg.cw.loyaltyEvery)
      : null;

    // ---------- escrituras ----------
    const customerName = String(w.get("customerName") || "Consumidor final");
    const sale = writeCarwashSale(tx, {
      tid, uid: caller.uid, byName: name, saleCounter, payCounter,
      customerId: (w.get("customerId") as string | null) ?? null, customerName,
      vehicleId: (w.get("vehicleId") as string | null) ?? null,
      vehicleLabel: `${VEHICLE_SIZE_SHORT[size] ?? ""} · placa ${plate}`,
      items: items.map((it, i) => ({
        refId: it.serviceId,
        description: `${it.name} (${VEHICLE_SIZE_SHORT[size] ?? size})${it.covered === "membership" ? " · membresía" : it.covered === "reward" ? " · premio de lealtad" : ""}`,
        unitPrice: charge.lines[i]!.unitPrice, discount: charge.lines[i]!.discount, taxable: charge.lines[i]!.taxable, lineTotal: charge.lines[i]!.lineTotal,
      })),
      taxRate, totals: charge.totals, payments: input.payments, washId: ref.id,
      extra: { washCode: w.get("code") },
    });
    if (loyaltyAfter) {
      tx.set(loyaltyRef, { count: loyaltyAfter.count, rewardsAvailable: loyaltyAfter.rewardsAvailable, lastWashAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.update(ref, {
      paid: true, paidAt: FieldValue.serverTimestamp(), saleId: sale.saleId, saleCode: sale.code,
      discount: input.discount, totals: charge.totals, total,
      loyaltyCounted: !!loyaltyAfter,
      loyaltyStamps: loyaltyAfter ? loyaltyAfter.count : Number(loyalty.get("count") ?? 0),
      loyaltyEvery: cfg.cw.loyaltyEvery,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    return { saleId: sale.saleId, code: sale.code, paymentIds: sale.paymentIds, earnedReward: !!loyaltyAfter?.earned, stamps: loyaltyAfter?.count ?? null };
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
