import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import {
  carwashCol, catalogCol, computeWashCharge, couponAmount, formatMoney,
  type AppliedCoupon, type ApplyCouponResult, type CarwashTaxMode, type CouponLine, type WashItem,
} from "@rapifix/shared";
import { db } from "./admin";
import { toMs } from "./carwash";
import {
  assertCoupon, couponDoc, identityKeys, isFirstVisit, readCouponForUse, readRedemption, releaseRedemption,
  vehicleCompany, writeReservation, type CouponIdentity,
} from "./coupons";
import type { CouponActor } from "./quoteCoupons";

/**
 * Cupón en un lavado del carwash: se aplica antes de cobrar (panel o link del cliente) y queda "reservado";
 * al cobrar (caja, pago en línea o comprobante aprobado) pasa a "usado"; al cancelar el lavado, quitarlo
 * o anular su venta, se libera. Aplica solo a lo que se cobra (no a lo cubierto por membresía o premio).
 * En carwash el descuento es sobre el precio que ve el cliente (con ISV si los precios lo incluyen).
 */

const bad = (msg: string) => new HttpsError("failed-precondition", msg);

/** Líneas del lavado para el cupón: solo lo que se cobra. */
export const washCouponLines = (items: WashItem[]): CouponLine[] => items.filter((i) => i.price > 0).map((i) => ({ kind: "services", amount: i.price }));

export function washChargeWith(w: DocumentSnapshot, couponDiscount: number) {
  const items = (w.get("items") as WashItem[]) ?? [];
  return computeWashCharge(items.map((i) => i.price), Number(w.get("taxRate") ?? 15), (w.get("taxMode") as CarwashTaxMode) ?? "included", 0, couponDiscount);
}

/** Si el cliente tiene abierto el link de pago con tarjeta, el total no se cambia (pagaría otro monto). */
async function assertNoLivePayLink(tx: Transaction, tid: string, washId: string) {
  const open = await tx.get(db.collection(catalogCol.onlinePayments(tid)).where("washId", "==", washId).limit(20));
  const now = Date.now();
  const live = open.docs.find((d) => ["creating", "pending"].includes(String(d.get("status"))) && toMs(d.get("expiresAt")) > now);
  if (live) {
    const mins = Math.max(1, Math.ceil((toMs(live.get("expiresAt")) - now) / 60000));
    throw bad(`Ya se abrió el link para pagar ${formatMoney(Number(live.get("amount") ?? 0))} con tarjeta. Espere a que se pague o a que venza (unos ${mins} min) para cambiar el total.`);
  }
}

function assertChargeable(w: DocumentSnapshot) {
  if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
  if (w.get("status") === "cancelled") throw bad("El lavado está cancelado.");
  // Pagado sin venta y en 0 = lavado gratis (membresía, premio o cupón del 100%): todavía se puede cambiar
  if (w.get("saleId") || (w.get("paid") && Number(w.get("total") ?? 0) > 0)) throw bad("Este lavado ya fue cobrado: el cupón ya no se puede cambiar.");
}

export async function applyWashCoupon(tid: string, washId: string, rawCode: string, actor: CouponActor): Promise<ApplyCouponResult> {
  const ref = db.doc(`${carwashCol.washes(tid)}/${washId}`);
  const pre = await ref.get();
  if (!pre.exists) throw new HttpsError("not-found", "El lavado no existe.");
  const identity: CouponIdentity = {
    customerId: (pre.get("customerId") as string | null) ?? null, customerName: String(pre.get("customerName") ?? ""),
    phone: (pre.get("phone") as string | undefined) || null, plate: (pre.get("plate") as string | undefined) || null,
  };
  const keys = identityKeys(identity);
  const [companyId, couponPre] = await Promise.all([vehicleCompany(tid, pre.get("vehicleId") as string | null), couponDoc(tid, rawCode.toUpperCase().replace(/\s+/g, "") || "_").get()]);
  const firstVisit = couponPre.get("firstVisitOnly") === true ? await isFirstVisit(tid, identity, { washId }) : null;

  return db.runTransaction(async (tx) => {
    // ---------- lecturas ----------
    const w = await tx.get(ref);
    assertChargeable(w);
    const current = w.get("coupon") as AppliedCoupon | null | undefined;
    if (current) throw bad(`Este lavado ya tiene el cupón ${current.code}. Quítelo para usar otro (no se acumulan).`);
    await assertNoLivePayLink(tx, tid, washId);
    const c = await readCouponForUse(tx, tid, rawCode, keys);

    // ---------- reglas ----------
    const items = (w.get("items") as WashItem[]) ?? [];
    const ev = assertCoupon(c, { unit: "carwash", lines: washCouponLines(items), byCustomer: actor.byCustomer, isFirstVisit: firstVisit, companyId });
    const charge = washChargeWith(w, ev.discount);
    const total = charge.totals.total;
    const free = total <= 0;

    // ---------- escrituras ----------
    const applied = writeReservation(tx, tid, c, {
      // Si el cupón deja el lavado en 0 no hay cobro: el uso cuenta de una vez
      status: free ? "used" : "reserved", unit: "carwash", target: { kind: "wash", id: washId, code: String(w.get("code") ?? "") },
      identity, discount: ev.discount, total, firstVisit: firstVisit === true,
      appliedBy: actor.byCustomer ? "customer" : actor.name, appliedByUid: actor.uid, channel: actor.channel,
    });
    tx.update(ref, {
      coupon: applied, couponNotice: null, total, totals: charge.totals,
      paid: free, paidAt: free ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid ?? "customer",
    });
    return { code: c.code, discount: ev.discount, total };
  });
}

export async function removeWashCoupon(tid: string, washId: string, actor: CouponActor): Promise<{ total: number }> {
  const ref = db.doc(`${carwashCol.washes(tid)}/${washId}`);
  return db.runTransaction(async (tx) => {
    const w = await tx.get(ref);
    assertChargeable(w);
    const coupon = w.get("coupon") as AppliedCoupon | null | undefined;
    if (!coupon) throw bad("Este lavado no tiene cupón.");
    await assertNoLivePayLink(tx, tid, washId);
    const r = await readRedemption(tx, tid, coupon.redemptionId);
    releaseRedemption(tx, tid, r, actor.byCustomer ? "El cliente lo quitó desde su link" : `Lo quitó ${actor.name}`);
    const charge = washChargeWith(w, 0);
    tx.update(ref, { coupon: null, couponNotice: null, total: charge.totals.total, totals: charge.totals, paid: charge.totals.total === 0, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid ?? "customer" });
    return { total: charge.totals.total };
  });
}

/**
 * Al editar el lavado (saveWash): recalcula el cupón con las líneas nuevas.
 * Si ya no cumple (compra mínima, nada que cobrar), se quita, se libera y se avisa.
 */
export function recomputeWashCoupon(
  tx: Transaction,
  tid: string,
  coupon: AppliedCoupon | null | undefined,
  r: DocumentSnapshot | null,
  items: WashItem[],
): { coupon: AppliedCoupon | null; discount: number; notice: string | null } {
  if (!coupon) return { coupon: null, discount: 0, notice: null };
  if (!r || r.get("status") === "released") return { coupon: null, discount: 0, notice: `El cupón ${coupon.code} ya no está vigente.` };
  const amount = couponAmount(coupon, washCouponLines(items));
  if (!amount.ok) {
    releaseRedemption(tx, tid, r, `El lavado ya no cumple las condiciones: ${amount.reason ?? ""}`);
    return { coupon: null, discount: 0, notice: `Se quitó el cupón ${coupon.code}: ${amount.reason ?? "ya no aplica."}` };
  }
  return { coupon: { ...coupon, discount: amount.discount }, discount: amount.discount, notice: null };
}
