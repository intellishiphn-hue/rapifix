import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import {
  couponCol,
  type ApplyCouponInput, type ApplyCouponResult, type CheckSaleCouponInput, type CheckSaleCouponResult, type Coupon, type CouponRedemption,
  type RemoveCouponInput, type SaveCouponInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

export const saveCoupon = callable<SaveCouponInput, { code: string }>("saveCoupon");
export const applyCoupon = callable<ApplyCouponInput, ApplyCouponResult>("applyCoupon");
export const removeCoupon = callable<RemoveCouponInput, { total: number }>("removeCoupon");
export const checkSaleCoupon = callable<CheckSaleCouponInput, CheckSaleCouponResult>("checkSaleCoupon");
/** Desde el link del cliente (sin sesión) */
export const applyCouponPublic = callable<{ token: string; kind: "quote" | "wash"; code: string }, ApplyCouponResult>("applyCouponPublic");
export const removeCouponPublic = callable<{ token: string; kind: "quote" | "wash" }, { total: number }>("removeCouponPublic");

const couponsCol = () => collection(db, couponCol.coupons(TENANT_ID));
const redemptionsCol = () => collection(db, couponCol.redemptions(TENANT_ID));

export function useCoupons(enabled = true) {
  return useQueryData<Coupon>(enabled ? query(couponsCol(), orderBy("code"), limit(500)) : null, `coupons|${enabled}`);
}

export function useCoupon(code: string | undefined) {
  return useDocData<Coupon>(code ? doc(db, couponCol.coupons(TENANT_ID), code) : null, `coupon-${code}`);
}

/** Canjes de un cupón (todos los estados), del más reciente al más antiguo (orden en memoria). */
export function useCouponRedemptions(code: string | undefined) {
  const s = useQueryData<CouponRedemption>(code ? query(redemptionsCol(), where("couponCode", "==", code), limit(2000)) : null, `coupon-redemptions-${code}`);
  const ms = (t: { toMillis?: () => number } | null | undefined) => t?.toMillis?.() ?? 0;
  return { ...s, data: [...s.data].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)) };
}
