import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  applyCouponSchema, checkSaleCouponSchema, companyCol, couponCol, couponRuleOf, couponUsageId, evaluateCoupon, removeCouponSchema, saleKindToCouponKind,
  saveCouponSchema, type ApplyCouponResult, type CheckSaleCouponResult, type Coupon, type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { couponDoc, identityKeys, isFirstVisit } from "../lib/coupons";
import { applyQuoteCoupon, removeQuoteCoupon } from "../lib/quoteCoupons";
import { applyWashCoupon, removeWashCoupon } from "../lib/washCoupons";
import { saleCouponContext } from "./sales";

const MANAGERS: Role[] = ["admin", "manager"];
/** Cotizaciones: recepción y gerencia. Lavados y punto de venta: caja. */
const QUOTE_DESK: Role[] = ["admin", "manager", "reception"];
const CASHIERS: Role[] = ["admin", "manager", "reception", "seller"];

/**
 * Crear o editar un cupón (admin y gerencia). El id del documento es el código: así es único.
 * Un cupón ya usado no se borra: se desactiva (active: false).
 */
export const saveCoupon = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, MANAGERS);
  const input = parseInput(saveCouponSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  let companyName = "";
  if (input.companyId) {
    const c = await db.doc(`${companyCol.companies(tid)}/${input.companyId}`).get();
    if (!c.exists) throw new HttpsError("not-found", "La empresa no existe.");
    companyName = String(c.get("name") ?? "");
  }
  const { editing, ...data } = input;
  const ref = couponDoc(tid, data.code);
  const now = FieldValue.serverTimestamp();
  const doc = {
    ...data,
    // El tope solo aplica a porcentaje
    maxDiscount: data.type === "percent" && data.maxDiscount ? data.maxDiscount : null,
    companyName,
    updatedAt: now, updatedBy: caller.uid, updatedByName: name,
  };
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (editing) {
      if (!cur.exists) throw new HttpsError("not-found", "El cupón no existe.");
      tx.update(ref, doc);
      return;
    }
    if (cur.exists) throw new HttpsError("already-exists", `Ya existe un cupón con el código ${data.code}. Use otro código.`);
    tx.set(ref, { ...doc, usesCount: 0, usesReserved: 0, discountGiven: 0, createdAt: now, createdBy: caller.uid, createdByName: name });
  });
  return { code: data.code };
});

/** Aplicar un cupón desde el panel a una cotización o a un lavado (antes de cobrar). */
export const applyCoupon = onCall({ region: REGION }, async (request): Promise<ApplyCouponResult> => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(applyCouponSchema, request.data);
  if (input.kind === "quote" && !QUOTE_DESK.includes(caller.role)) throw new HttpsError("permission-denied", "No tiene permiso para cambiar cotizaciones.");
  const name = await actorName(caller.uid, caller.email);
  const actor = { uid: caller.uid, name, byCustomer: false, channel: "panel" as const };
  return input.kind === "quote" ? applyQuoteCoupon(caller.tid, input.id, input.code, actor) : applyWashCoupon(caller.tid, input.id, input.code, actor);
});

/** Quitar el cupón de una cotización (no aprobada) o de un lavado (no cobrado). */
export const removeCoupon = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(removeCouponSchema, request.data);
  if (input.kind === "quote" && !QUOTE_DESK.includes(caller.role)) throw new HttpsError("permission-denied", "No tiene permiso para cambiar cotizaciones.");
  const name = await actorName(caller.uid, caller.email);
  const actor = { uid: caller.uid, name, byCustomer: false, channel: "panel" as const };
  return input.kind === "quote" ? removeQuoteCoupon(caller.tid, input.id, actor) : removeWashCoupon(caller.tid, input.id, actor);
});

/**
 * Vista previa del cupón en el punto de venta: dice si aplica y cuánto descuenta, sin reservar nada.
 * El uso real (y la validación final, en transacción) ocurre en createSale.
 */
export const checkSaleCoupon = onCall({ region: REGION }, async (request): Promise<CheckSaleCouponResult> => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(checkSaleCouponSchema, request.data);
  const tid = caller.tid;
  const snap = await couponDoc(tid, input.code).get();
  if (!snap.exists) return { ok: false, reason: "Este cupón no existe. Revise el código.", discount: 0, rule: null };
  const coupon = { id: snap.id, ...snap.data() } as Coupon;
  const ctx = await saleCouponContext(tid, input.customerId ?? null, input.vehicleId ?? null);
  const keys = identityKeys(ctx.identity);
  const usage = await Promise.all(keys.map((k) => db.doc(`${couponCol.usage(tid)}/${couponUsageId(coupon.code, k)}`).get()));
  const firstVisit = coupon.firstVisitOnly ? await isFirstVisit(tid, ctx.identity, {}) : null;
  const ev = evaluateCoupon(coupon, {
    unit: "pos", nowMs: Date.now(), lines: input.lines.map((l) => ({ kind: saleKindToCouponKind(l.kind), amount: l.amount })),
    hasIdentity: keys.length > 0, customerUses: usage.reduce((m, u) => Math.max(m, Number(u.get("count") ?? 0)), 0),
    isFirstVisit: firstVisit, companyId: ctx.companyId,
  });
  return { ok: ev.ok, reason: ev.reason, discount: ev.discount, rule: ev.ok ? couponRuleOf(coupon) : null };
});
