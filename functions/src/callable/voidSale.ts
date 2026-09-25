import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, voidSaleSchema } from "@rapifix/shared";
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
    tx.update(saleRef, {
      status: "voided", voidReason: input.reason, paid: 0, balance: 0,
      voidedAt: FieldValue.serverTimestamp(), voidedBy: caller.uid, voidedByName: name,
    });
    return { ok: true, code: sale.get("code") as string };
  });
});
