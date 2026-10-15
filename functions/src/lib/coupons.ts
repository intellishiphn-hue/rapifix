import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import {
  carwashCol, catalogCol, col, couponCol, couponRuleOf, couponUsageId, customerKeysFor, evaluateCoupon, isPlaceholderPlate, normalizeCouponCode, orderCol,
  type AppliedCoupon, type Coupon, type CouponLine, type CouponUnit, type RedemptionChannel, type RedemptionKind,
} from "@rapifix/shared";
import { db } from "./admin";

/**
 * Cupones en el servidor. En una transacción las lecturas van primero:
 * readCouponForUse()/readRedemption() y después writeReservation()/releaseRedemption()/markRedemptionUsed().
 *
 * Contadores en el cupón: usesReserved = canjes vigentes (reservados + usados), usesCount = usados,
 * discountGiven = descuento de los usados. Índice por cliente: couponUsage/{code}__{clave} con `count`
 * de canjes vigentes, para validar el límite por cliente dentro de la transacción (sin consultas).
 */

export const couponDoc = (tid: string, code: string) => db.doc(`${couponCol.coupons(tid)}/${code}`);
export const redemptionDoc = (tid: string, id: string) => db.doc(`${couponCol.redemptions(tid)}/${id}`);
const usageDoc = (tid: string, code: string, key: string) => db.doc(`${couponCol.usage(tid)}/${couponUsageId(code, key)}`);

const bad = (msg: string) => new HttpsError("failed-precondition", msg);

/** Identidad del cliente de la cuenta (para el límite por cliente). La placa marcador ("PENDIENTE") no cuenta. */
export interface CouponIdentity {
  customerId: string | null;
  customerName: string;
  phone: string | null;
  plate: string | null;
}
export function identityKeys(i: CouponIdentity): string[] {
  return customerKeysFor({ customerId: i.customerId, phone: i.phone, plate: i.plate && !isPlaceholderPlate(i.plate) ? i.plate : null });
}

/**
 * ¿Es la primera visita del cliente? Busca órdenes entregadas o con pagos, ventas pagadas y lavados cobrados
 * del cliente, de su teléfono y de su placa (sin contar la cuenta actual). Se hace fuera de la transacción.
 */
export async function isFirstVisit(tid: string, i: CouponIdentity, exclude: { orderId?: string | null; saleId?: string | null; washId?: string | null }): Promise<boolean> {
  const plate = i.plate && !isPlaceholderPlate(i.plate) ? i.plate : null;
  const customerIds = new Set<string>(i.customerId ? [i.customerId] : []);
  if (i.phone) {
    const byPhone = await db.collection(col.customers(tid)).where("phone", "==", i.phone).limit(5).get();
    byPhone.docs.forEach((d) => customerIds.add(d.id));
  }
  const paidOrder = (d: DocumentSnapshot) => d.id !== exclude.orderId && (Number(d.get("paid") ?? 0) > 0 || d.get("status") === "DELIVERED");
  const paidSale = (d: DocumentSnapshot) => d.id !== exclude.saleId && d.get("status") !== "voided" && Number(d.get("paid") ?? 0) > 0;
  const paidWash = (d: DocumentSnapshot) => d.id !== exclude.washId && !!d.get("paid") && d.get("status") !== "cancelled" && !!d.get("saleId");
  for (const cid of customerIds) {
    const [orders, sales, washes] = await Promise.all([
      db.collection(orderCol.workOrders(tid)).where("customerId", "==", cid).limit(50).get(),
      db.collection(catalogCol.sales(tid)).where("customerId", "==", cid).limit(50).get(),
      db.collection(carwashCol.washes(tid)).where("customerId", "==", cid).limit(50).get(),
    ]);
    if (orders.docs.some(paidOrder) || sales.docs.some(paidSale) || washes.docs.some(paidWash)) return false;
  }
  if (plate) {
    const [washes, vehicles] = await Promise.all([
      db.collection(carwashCol.washes(tid)).where("plate", "==", plate).limit(50).get(),
      db.collection(col.vehicles(tid)).where("plate", "==", plate).limit(5).get(),
    ]);
    if (washes.docs.some(paidWash)) return false;
    for (const v of vehicles.docs) {
      const orders = await db.collection(orderCol.workOrders(tid)).where("vehicleId", "==", v.id).limit(50).get();
      if (orders.docs.some(paidOrder)) return false;
    }
  }
  if (i.phone) {
    const washes = await db.collection(carwashCol.washes(tid)).where("phone", "==", i.phone).limit(50).get();
    if (washes.docs.some(paidWash)) return false;
  }
  return true;
}

/** Empresa del vehículo (para cupones de empresa o que excluyen empresas). */
export async function vehicleCompany(tid: string, vehicleId: string | null | undefined): Promise<string | null> {
  if (!vehicleId) return null;
  const v = await db.doc(`${col.vehicles(tid)}/${vehicleId}`).get();
  return (v.get("companyId") as string | undefined) || null;
}

export interface CouponForUse {
  code: string;
  ref: DocumentReference;
  snap: DocumentSnapshot;
  keys: string[];
  /** mayor cantidad de canjes vigentes entre las claves del cliente */
  customerUses: number;
}

/** Lecturas para usar un cupón (dentro de la transacción). Lanza error si el código no existe. */
export async function readCouponForUse(tx: Transaction, tid: string, rawCode: string, keys: string[]): Promise<CouponForUse> {
  const code = normalizeCouponCode(rawCode);
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw new HttpsError("not-found", "Este cupón no existe. Revise el código.");
  const ref = couponDoc(tid, code);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new HttpsError("not-found", "Este cupón no existe. Revise el código.");
  const usage = await Promise.all(keys.map((k) => tx.get(usageDoc(tid, code, k))));
  const customerUses = usage.reduce((m, u) => Math.max(m, Number(u.get("count") ?? 0)), 0);
  return { code, ref, snap, keys, customerUses };
}

export const couponData = (c: CouponForUse) => ({ id: c.snap.id, ...c.snap.data() }) as Coupon;

/** Valida el cupón con las reglas puras. Lanza el motivo si no aplica. */
export function assertCoupon(
  c: CouponForUse,
  ctx: { unit: CouponUnit; lines: CouponLine[]; byCustomer: boolean; isFirstVisit: boolean | null; companyId: string | null },
): { discount: number } {
  const ev = evaluateCoupon(couponData(c), {
    unit: ctx.unit, nowMs: Date.now(), lines: ctx.lines, byCustomer: ctx.byCustomer, hasIdentity: c.keys.length > 0,
    customerUses: c.customerUses, isFirstVisit: ctx.isFirstVisit, companyId: ctx.companyId,
  });
  if (!ev.ok) throw bad(ev.reason);
  return { discount: ev.discount };
}

/** Escribe el canje (reservado o usado) y sube los contadores del cupón y del cliente. */
export function writeReservation(
  tx: Transaction,
  tid: string,
  c: CouponForUse,
  args: {
    status: "reserved" | "used";
    unit: CouponUnit;
    target: { kind: RedemptionKind; id: string; code: string };
    orderId?: string | null;
    orderCode?: string | null;
    saleId?: string | null;
    saleCode?: string | null;
    identity: CouponIdentity;
    discount: number;
    total: number;
    firstVisit: boolean;
    appliedBy: string;
    appliedByUid: string | null;
    channel: RedemptionChannel;
  },
): AppliedCoupon {
  const coupon = couponData(c);
  const ref = db.collection(couponCol.redemptions(tid)).doc();
  const now = FieldValue.serverTimestamp();
  tx.set(ref, {
    couponCode: c.code, couponName: coupon.name, unit: args.unit, target: args.target,
    orderId: args.orderId ?? null, orderCode: args.orderCode ?? null, saleId: args.saleId ?? null, saleCode: args.saleCode ?? null,
    customerId: args.identity.customerId, customerName: args.identity.customerName || "Consumidor final",
    customerKey: c.keys[0] ?? "", customerKeys: c.keys,
    discount: args.discount, total: args.total, firstVisit: args.firstVisit, status: args.status,
    appliedBy: args.appliedBy, appliedByUid: args.appliedByUid, channel: args.channel,
    createdAt: now, usedAt: args.status === "used" ? now : null, releasedAt: null,
  });
  const used = args.status === "used";
  tx.update(c.ref, {
    usesReserved: FieldValue.increment(1),
    ...(used ? { usesCount: FieldValue.increment(1), discountGiven: FieldValue.increment(args.discount) } : {}),
    lastUsedAt: now,
  });
  for (const k of c.keys) tx.set(usageDoc(tid, c.code, k), { code: c.code, key: k, count: FieldValue.increment(1), updatedAt: now }, { merge: true });
  return { ...couponRuleOf(coupon), discount: args.discount, redemptionId: ref.id };
}

/** Lee un canje (dentro de la transacción). */
export async function readRedemption(tx: Transaction, tid: string, id: string | null | undefined): Promise<DocumentSnapshot | null> {
  if (!id) return null;
  const snap = await tx.get(redemptionDoc(tid, id));
  return snap.exists ? snap : null;
}

/** Libera un canje reservado o usado: baja los contadores. No hace nada si ya estaba liberado. */
export function releaseRedemption(tx: Transaction, tid: string, r: DocumentSnapshot | null, reason: string) {
  if (!r?.exists) return;
  const status = r.get("status");
  if (status === "released") return;
  const code = String(r.get("couponCode"));
  tx.update(r.ref, { status: "released", releasedAt: FieldValue.serverTimestamp(), releaseReason: reason.slice(0, 200) });
  tx.update(couponDoc(tid, code), {
    usesReserved: FieldValue.increment(-1),
    ...(status === "used" ? { usesCount: FieldValue.increment(-1), discountGiven: FieldValue.increment(-Number(r.get("discount") ?? 0)) } : {}),
  });
  for (const k of (r.get("customerKeys") as string[] | undefined) ?? []) {
    tx.set(usageDoc(tid, code, k), { count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

/** Pasa el canje a "usado" (o, si ya lo estaba, actualiza su descuento). */
export function markRedemptionUsed(
  tx: Transaction,
  tid: string,
  r: DocumentSnapshot | null,
  args: { discount: number; total: number; target?: { kind: RedemptionKind; id: string; code: string }; extra?: Record<string, unknown> },
) {
  if (!r?.exists) return;
  const status = r.get("status");
  if (status === "released") return;
  const code = String(r.get("couponCode"));
  const before = Number(r.get("discount") ?? 0);
  const patch: Record<string, unknown> = { discount: args.discount, total: args.total, ...(args.target ? { target: args.target } : {}), ...(args.extra ?? {}) };
  if (status === "reserved") {
    tx.update(r.ref, { ...patch, status: "used", usedAt: FieldValue.serverTimestamp() });
    tx.update(couponDoc(tid, code), { usesCount: FieldValue.increment(1), discountGiven: FieldValue.increment(args.discount) });
  } else {
    tx.update(r.ref, patch);
    if (args.discount !== before) tx.update(couponDoc(tid, code), { discountGiven: FieldValue.increment(args.discount - before) });
  }
}

/** Actualiza el descuento (y la cuenta) de un canje todavía reservado, p. ej. al editar la cotización. */
export function touchReservation(tx: Transaction, r: DocumentSnapshot | null, args: { discount: number; total: number; target?: { kind: RedemptionKind; id: string; code: string } }) {
  if (!r?.exists || r.get("status") !== "reserved") return;
  tx.update(r.ref, { discount: args.discount, total: args.total, ...(args.target ? { target: args.target } : {}) });
}

/** ¿Hay cupones que el cliente puede escribir en su link para esta unidad? (para mostrar "¿Tiene un cupón?") */
export async function customerCouponsAvailable(tid: string, unit: CouponUnit, tx?: Transaction): Promise<boolean> {
  const q = db.collection(couponCol.coupons(tid)).where("active", "==", true).limit(50);
  const snap = tx ? await tx.get(q) : await q.get();
  const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  return snap.docs.some((d) => {
    const c = d.data() as Coupon;
    return c.customerApplicable && (c.units ?? []).includes(unit) && (!c.validUntil || c.validUntil >= today) && (!c.validFrom || c.validFrom <= today)
      && !(c.maxUses && (c.usesReserved ?? 0) >= c.maxUses);
  });
}
