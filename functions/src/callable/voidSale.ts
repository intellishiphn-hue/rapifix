import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { addMonthsHN, carwashCol, catalogCol, voidSaleSchema, type MembershipHistoryEntry } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";

/**
 * Anula una venta del punto de venta (admin y gerencia): anula sus pagos, devuelve al inventario
 * los productos vendidos y deja el saldo en cero. La venta no se borra; queda marcada como anulada.
 */
export const voidSale = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(voidSaleSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const saleRef = db.doc(`${catalogCol.sales(tid)}/${input.saleId}`);
  const paysQuery = db.collection(catalogCol.payments(tid)).where("saleId", "==", input.saleId);

  return db.runTransaction(async (tx) => {
    const sale = await tx.get(saleRef);
    if (!sale.exists) throw new HttpsError("not-found", "La venta no existe.");
    if (sale.get("status") === "voided") throw new HttpsError("failed-precondition", "La venta ya está anulada.");
    const pays = await tx.get(paysQuery);
    const items = (sale.get("items") as Array<{ kind: string; refId: string | null; qty: number; description: string }>) ?? [];
    const byProduct = new Map<string, number>();
    items.forEach((i) => i.kind === "product" && i.refId && byProduct.set(i.refId, (byProduct.get(i.refId) ?? 0) + Number(i.qty)));
    const prods = await Promise.all([...byProduct.keys()].map((id) => tx.get(db.doc(`${catalogCol.products(tid)}/${id}`))));
    // Carwash: el lavado cobrado con esta venta vuelve a quedar pendiente de cobro
    const washId = sale.get("washId") as string | null | undefined;
    const wash = washId ? await tx.get(db.doc(`${carwashCol.washes(tid)}/${washId}`)) : null;
    const washOk = !!wash?.exists && wash.get("saleId") === sale.id;
    const loyalty = washOk && wash!.get("loyaltyCounted") ? await tx.get(db.doc(`${carwashCol.loyalty(tid)}/${wash!.get("plate")}`)) : null;
    // Carwash: venta o renovación de membresía -> se quitan los meses pagados con esta venta
    const membershipId = sale.get("membershipId") as string | null | undefined;
    const membership = membershipId ? await tx.get(db.doc(`${carwashCol.memberships(tid)}/${membershipId}`)) : null;

    for (const pay of pays.docs) {
      if (pay.get("status") !== "valid") continue;
      tx.update(pay.ref, { status: "voided", voidReason: `Venta ${sale.get("code")} anulada: ${input.reason}`, voidedAt: FieldValue.serverTimestamp(), voidedBy: caller.uid });
    }
    for (const prod of prods) {
      if (!prod.exists) continue;
      const qty = byProduct.get(prod.id)!;
      const before = Number(prod.get("stock") ?? 0);
      tx.update(prod.ref, { stock: before + qty, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      tx.set(db.collection(catalogCol.movements(tid)).doc(), {
        productId: prod.id, productName: prod.get("name"), sku: prod.get("sku") ?? "", type: "return", qty, unitCost: 0,
        stockBefore: before, stockAfter: before + qty, reason: `Venta ${sale.get("code")} anulada: ${input.reason}`,
        orderId: null, orderCode: null, saleId: sale.id, saleCode: sale.get("code"), by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
      });
    }
    if (washOk) {
      tx.update(wash!.ref, { paid: false, saleId: null, saleCode: null, loyaltyCounted: false, voidedSaleCode: sale.get("code"), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      if (loyalty?.exists) {
        const count = Number(loyalty.get("count") ?? 0);
        const rewards = Number(loyalty.get("rewardsAvailable") ?? 0);
        const every = Number(wash!.get("loyaltyEvery") ?? 0);
        if (count > 0) tx.update(loyalty.ref, { count: count - 1 });
        else if (rewards > 0 && every > 0) tx.update(loyalty.ref, { count: every - 1, rewardsAvailable: rewards - 1 });
      }
    }
    if (membership?.exists) {
      const history = (membership.get("history") as MembershipHistoryEntry[] | undefined) ?? [];
      const entry = history.find((h) => h.saleId === sale.id);
      if (entry) {
        const rest = history.filter((h) => h.saleId !== sale.id);
        const paidUntilTs = membership.get("paidUntil") as Timestamp | undefined;
        const paidUntil = addMonthsHN(paidUntilTs?.toMillis?.() ?? Date.now(), -entry.months);
        const patch: Record<string, unknown> = {
          history: rest,
          totalPaid: Math.max(0, Number(membership.get("totalPaid") ?? 0) - entry.amount),
          paidUntil: Timestamp.fromMillis(paidUntil),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (entry.kind === "renewal") patch.renewals = Math.max(0, Number(membership.get("renewals") ?? 0) - 1);
        if (!rest.length) Object.assign(patch, { status: "cancelled", cancelReason: `Venta ${sale.get("code")} anulada: ${input.reason}`, cancelledAt: FieldValue.serverTimestamp() });
        else if (paidUntil <= Date.now() && membership.get("status") === "active") patch.status = "expired";
        tx.update(membership.ref, patch);
      }
    }
    tx.update(saleRef, {
      status: "voided", voidReason: input.reason, paid: 0, balance: 0,
      voidedAt: FieldValue.serverTimestamp(), voidedBy: caller.uid, voidedByName: name,
    });
    return { ok: true, code: sale.get("code") as string };
  });
});
