import { onCall, HttpsError } from "firebase-functions/v2/https";
import { applyCouponPublicSchema, quoteCol, removeCouponPublicSchema, type ApplyCouponResult } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { rateLimit, requestIp, requireAppCheck } from "../lib/rateLimit";
import { applyQuoteCoupon, removeQuoteCoupon, type CouponActor } from "../lib/quoteCoupons";
import { applyWashCoupon, removeWashCoupon } from "../lib/washCoupons";
import { loadWashByToken } from "../lib/publicWash";

/**
 * Cupón que escribe el cliente en su link (sin cuenta): en la cotización pendiente de aprobar
 * o en el lavado antes de pagar. Solo cupones marcados "el cliente lo puede aplicar".
 * Límite fuerte de intentos (por link y por IP) para que no se puedan adivinar códigos.
 */

async function quoteFromToken(token: string): Promise<{ tid: string; quoteId: string }> {
  const portal = await db.doc(`${quoteCol.portal}/${token}`).get();
  if (!portal.exists || portal.get("active") === false) throw new HttpsError("not-found", "Este link no es válido o ya expiró.");
  // Si hay una actualización pendiente de la cotización aprobada, el cupón va en ella
  const quoteId = (portal.get("quoteUpdate.id") as string | undefined) ?? (portal.get("quote.id") as string | undefined) ?? null;
  const status = (portal.get("quoteUpdate.status") as string | undefined) ?? (portal.get("quote.status") as string | undefined);
  if (!quoteId || !["sent", "viewed"].includes(String(status))) throw new HttpsError("failed-precondition", "No hay una cotización pendiente de aprobar.");
  return { tid: portal.get("tid") as string, quoteId };
}

const CUSTOMER = (kind: "quote" | "wash"): CouponActor => ({ uid: null, name: "Cliente", byCustomer: true, channel: kind === "quote" ? "portal" : "wash_link" });

export const applyCouponPublic = onCall({ region: REGION }, async (request): Promise<ApplyCouponResult> => {
  requireAppCheck(request);
  const input = parseInput(applyCouponPublicSchema, request.data);
  await rateLimit("coupon", [input.token], 5, 600);
  await rateLimit("coupon-ip", [requestIp(request)], 10, 600);
  if (!/^[A-Z0-9-]{3,20}$/.test(input.code)) throw new HttpsError("not-found", "Este cupón no existe. Revise el código.");
  if (input.kind === "quote") {
    const { tid, quoteId } = await quoteFromToken(input.token);
    return applyQuoteCoupon(tid, quoteId, input.code, CUSTOMER("quote"));
  }
  const { tid, washId } = await loadWashByToken(input.token);
  return applyWashCoupon(tid, washId, input.code, CUSTOMER("wash"));
});

export const removeCouponPublic = onCall({ region: REGION }, async (request) => {
  requireAppCheck(request);
  const input = parseInput(removeCouponPublicSchema, request.data);
  await rateLimit("coupon-remove", [input.token], 10, 600);
  await rateLimit("coupon-remove-ip", [requestIp(request)], 30, 600);
  if (input.kind === "quote") {
    const { tid, quoteId } = await quoteFromToken(input.token);
    return removeQuoteCoupon(tid, quoteId, CUSTOMER("quote"));
  }
  const { tid, washId } = await loadWashByToken(input.token);
  return removeWashCoupon(tid, washId, CUSTOMER("wash"));
});
