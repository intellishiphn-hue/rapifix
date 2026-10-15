import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import {
  computeQuote, couponRuleOf, formatMoney, OPEN_QUOTE_STATUSES, orderCol, quoteCol, quoteTypeToCouponKind,
  type AppliedCoupon, type ApplyCouponResult, type QuoteItem, type QuoteStatus, type RedemptionChannel,
} from "@rapifix/shared";
import { db } from "./admin";
import { buildPortal, buildQuotePortal } from "./portal";
import {
  assertCoupon, couponData, couponDoc, identityKeys, isFirstVisit, readCouponForUse, readRedemption, releaseRedemption, touchReservation,
  vehicleCompany, writeReservation, type CouponIdentity,
} from "./coupons";

/**
 * Cupón en una cotización del taller.
 * - Se aplica a una cotización en borrador, enviada o vista (no aprobada): el canje queda "reservado".
 * - Al aprobarse la cotización: "usado". Si se rechaza, vence, se descarta o se quita: "liberado".
 * - Las modificaciones de una cotización aprobada heredan su cupón ya usado (no cuenta un uso nuevo);
 *   el descuento se recalcula con las líneas nuevas respetando el tope. Si la modificación ya no cumple
 *   la compra mínima, pierde el descuento (se avisa) y, si el cliente la aprueba así, el uso se libera.
 */

export interface CouponActor {
  uid: string | null;
  name: string;
  byCustomer: boolean;
  channel: RedemptionChannel;
}

const bad = (msg: string) => new HttpsError("failed-precondition", msg);
const versionLabel = (q: DocumentSnapshot) => `${q.get("code")}${Number(q.get("version") ?? 1) > 1 ? ` v${q.get("version")}` : ""}`;
const isOpen = (s: unknown) => OPEN_QUOTE_STATUSES.includes(s as QuoteStatus);
export const quoteCouponLines = (items: QuoteItem[]) => items.map((it) => ({ kind: quoteTypeToCouponKind(it.type), amount: it.lineTotal + (it.couponDiscount ?? 0) }));

/**
 * En una cotización abierta, un canje "usado" es el de la cotización aprobada que esta modifica (heredado):
 * no se libera al quitarlo, rechazarla o descartarla; solo cuando el cliente aprueba una versión sin él.
 */
export const isInherited = (r: DocumentSnapshot | null) => r?.get("status") === "used";

/** ¿La orden usa los totales de esta cotización ahora mismo? (enviada, no es modificación de una aprobada) */
const isLiveOnOrder = (q: DocumentSnapshot, order: DocumentSnapshot | null) =>
  !!order?.exists && order.get("activeQuoteId") === q.id && !q.get("revisionOf") && q.get("status") !== "draft";

async function rebuild(tid: string, orderId: string | null, quoteId: string) {
  if (orderId) await buildPortal(tid, orderId).catch(() => null);
  else await buildQuotePortal(tid, quoteId).catch(() => null);
}

function orderEvent(tx: Transaction, orderRef: FirebaseFirestore.DocumentReference, text: string, actor: CouponActor) {
  tx.set(orderRef.collection("events").doc(), {
    type: "note", text, visibleToCustomer: false, channels: [], fromStatus: null, toStatus: null,
    actorId: actor.uid ?? "customer", actorName: actor.byCustomer ? "Cliente (link)" : actor.name, at: FieldValue.serverTimestamp(),
  });
}

export async function applyQuoteCoupon(tid: string, quoteId: string, rawCode: string, actor: CouponActor): Promise<ApplyCouponResult> {
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const pre = await quoteRef.get();
  if (!pre.exists) throw new HttpsError("not-found", "La cotización no existe.");
  const identity: CouponIdentity = {
    customerId: (pre.get("customerId") as string | null) ?? null, customerName: String(pre.get("customerName") ?? ""),
    phone: (pre.get("customerPhone") as string | undefined) || null, plate: (pre.get("plate") as string | undefined) || null,
  };
  const keys = identityKeys(identity);
  const orderId = (pre.get("orderId") as string | null) ?? null;
  const [companyId, couponPre] = await Promise.all([vehicleCompany(tid, pre.get("vehicleId") as string | undefined), couponDoc(tid, rawCode.toUpperCase().replace(/\s+/g, "") || "_").get()]);
  const firstVisit = couponPre.get("firstVisitOnly") === true ? await isFirstVisit(tid, identity, { orderId }) : null;

  const res = await db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const q = await tx.get(quoteRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    if (!isOpen(q.get("status"))) throw bad("Esta cotización ya no se puede cambiar (está aprobada, rechazada o vencida).");
    if (actor.byCustomer && q.get("status") === "draft") throw bad("La cotización aún no está lista.");
    const current = q.get("coupon") as AppliedCoupon | null | undefined;
    if (current) throw bad(`Esta cotización ya tiene el cupón ${current.code}. Quítelo para usar otro (no se acumulan).`);
    const orderRef = q.get("orderId") ? db.doc(`${orderCol.workOrders(tid)}/${q.get("orderId")}`) : null;
    const order = orderRef ? await tx.get(orderRef) : null;
    const c = await readCouponForUse(tx, tid, rawCode, keys);

    // ---------- reglas ----------
    const items = (q.get("items") as QuoteItem[]) ?? [];
    const ev = assertCoupon(c, { unit: "shop", lines: quoteCouponLines(items), byCustomer: actor.byCustomer, isFirstVisit: firstVisit, companyId: companyId ?? ((order?.get("companyId") as string | null) || null) });
    const rule = couponRuleOf(couponData(c));
    const computed = computeQuote(items, Number(q.get("taxRate") ?? 15), rule);
    const discount = computed.totals.couponDiscount ?? ev.discount;
    const paid = Number(order?.get("paid") ?? 0);
    if (order?.exists && paid > computed.totals.total) {
      throw bad(`Ya se pagó ${formatMoney(paid)}: con el cupón el total (${formatMoney(computed.totals.total)}) quedaría por debajo de lo pagado.`);
    }

    // ---------- escrituras ----------
    const applied = writeReservation(tx, tid, c, {
      status: "reserved", unit: "shop", target: { kind: "quote", id: q.id, code: versionLabel(q) },
      orderId: (q.get("orderId") as string | null) ?? null, orderCode: (q.get("orderCode") as string | null) ?? null,
      identity, discount, total: computed.totals.total, firstVisit: firstVisit === true,
      appliedBy: actor.byCustomer ? "customer" : actor.name, appliedByUid: actor.uid, channel: actor.channel,
    });
    tx.update(quoteRef, { coupon: applied, couponNotice: null, items: computed.items, totals: computed.totals, updatedAt: FieldValue.serverTimestamp() });
    if (orderRef && order?.exists) {
      if (isLiveOnOrder(q, order)) tx.update(orderRef, { totals: computed.totals, balance: computed.totals.total - paid, updatedAt: FieldValue.serverTimestamp() });
      orderEvent(tx, orderRef, `Cupón ${c.code} aplicado a la cotización ${versionLabel(q)}: − ${formatMoney(discount)}${actor.byCustomer ? " (lo aplicó el cliente desde su link)" : ""}`, actor);
    }
    return { orderId: (q.get("orderId") as string | null) ?? null, out: { code: c.code, discount, total: computed.totals.total } };
  });
  await rebuild(tid, res.orderId, quoteId);
  return res.out;
}

export async function removeQuoteCoupon(tid: string, quoteId: string, actor: CouponActor): Promise<{ total: number }> {
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  const res = await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    if (!q.exists) throw new HttpsError("not-found", "La cotización no existe.");
    if (!isOpen(q.get("status"))) throw bad("Esta cotización ya no se puede cambiar (está aprobada, rechazada o vencida).");
    const coupon = q.get("coupon") as AppliedCoupon | null | undefined;
    if (!coupon) throw bad("Esta cotización no tiene cupón.");
    const orderRef = q.get("orderId") ? db.doc(`${orderCol.workOrders(tid)}/${q.get("orderId")}`) : null;
    const order = orderRef ? await tx.get(orderRef) : null;
    const r = await readRedemption(tx, tid, coupon.redemptionId);

    const computed = computeQuote((q.get("items") as QuoteItem[]) ?? [], Number(q.get("taxRate") ?? 15));
    // El cupón heredado de la aprobada sigue usado por ella mientras esté vigente
    if (!isInherited(r)) releaseRedemption(tx, tid, r, actor.byCustomer ? "El cliente lo quitó desde su link" : `Lo quitó ${actor.name}`);
    tx.update(quoteRef, { coupon: null, couponNotice: null, items: computed.items, totals: computed.totals, updatedAt: FieldValue.serverTimestamp() });
    if (orderRef && order?.exists) {
      if (isLiveOnOrder(q, order)) tx.update(orderRef, { totals: computed.totals, balance: computed.totals.total - Number(order.get("paid") ?? 0), updatedAt: FieldValue.serverTimestamp() });
      orderEvent(tx, orderRef, `Se quitó el cupón ${coupon.code} de la cotización ${versionLabel(q)}`, actor);
    }
    return { orderId: (q.get("orderId") as string | null) ?? null, total: computed.totals.total };
  });
  await rebuild(tid, res.orderId, quoteId);
  return { total: res.total };
}

/**
 * Recalcula el cupón de un borrador con sus líneas nuevas (saveQuote, newQuoteVersion). Devuelve los items/totales
 * a guardar, el cupón actualizado (o null si ya no cumple) y el aviso. Lectura: el canje.
 */
export async function readDraftCoupon(tx: Transaction, tid: string, coupon: AppliedCoupon | null | undefined) {
  if (!coupon) return null;
  const r = await readRedemption(tx, tid, coupon.redemptionId);
  return { coupon, r, inherited: isInherited(r) };
}

export function writeDraftCoupon(
  tx: Transaction,
  tid: string,
  read: NonNullable<Awaited<ReturnType<typeof readDraftCoupon>>>,
  items: Parameters<typeof computeQuote>[0],
  taxRate: number,
  target: { id: string; code: string },
) {
  const { coupon, r, inherited } = read;
  // El canje se liberó (la cotización anterior se rechazó o venció): el cupón no pasa a esta versión
  if (!r || r.get("status") === "released") {
    return { computed: computeQuote(items, taxRate), coupon: null, notice: `El cupón ${coupon.code} ya no está vigente para esta cotización. Aplíquelo de nuevo si corresponde.` };
  }
  const computed = computeQuote(items, taxRate, coupon);
  if (computed.couponIssue) {
    if (!inherited) releaseRedemption(tx, tid, r, `La cotización ya no cumple las condiciones: ${computed.couponIssue}`);
    const plain = computeQuote(items, taxRate);
    return { computed: plain, coupon: null, notice: `Se quitó el cupón ${coupon.code}: ${computed.couponIssue}` };
  }
  const discount = computed.totals.couponDiscount ?? 0;
  if (!inherited) touchReservation(tx, r, { discount, total: computed.totals.total, target: { kind: "quote", ...target } });
  return { computed, coupon: { ...coupon, discount } as AppliedCoupon, notice: null as string | null };
}

/** Libera el cupón propio (no heredado) de una cotización: rechazo, vencimiento o descarte. Transacción propia. */
export async function releaseQuoteCoupon(tid: string, quoteId: string, reason: string) {
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${quoteId}`);
  await db.runTransaction(async (tx) => {
    const q = await tx.get(quoteRef);
    const coupon = q.get("coupon") as AppliedCoupon | null | undefined;
    if (!q.exists || !coupon) return;
    const r = await readRedemption(tx, tid, coupon.redemptionId);
    if (!isInherited(r)) releaseRedemption(tx, tid, r, reason);
  });
}
