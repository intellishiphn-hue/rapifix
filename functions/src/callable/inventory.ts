import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { catalogCol, consumePartSchema, movementSchema, orderCol, quoteCol, type Role } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";

const STOCK_ROLES: Role[] = ["admin", "manager", "warehouse"];

/** Entradas, salidas, ajustes y devoluciones. La existencia solo cambia por aquí. */
export const registerInventoryMovement = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, STOCK_ROLES);
  const input = parseInput(movementSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const productRef = db.doc(`${catalogCol.products(tid)}/${input.productId}`);
  const costRef = db.doc(`${catalogCol.productCosts(tid)}/${input.productId}`);
  const movRef = db.collection(catalogCol.movements(tid)).doc();

  return db.runTransaction(async (tx) => {
    const [p, c] = await Promise.all([tx.get(productRef), tx.get(costRef)]);
    if (!p.exists) throw new HttpsError("not-found", "El producto no existe.");
    const before = Number(p.get("stock") ?? 0);
    let after = before;
    if (input.type === "in" || input.type === "return") after = before + input.qty;
    if (input.type === "out") after = before - input.qty;
    if (input.type === "adjust") after = input.qty;
    if (input.type !== "adjust" && input.qty <= 0) throw new HttpsError("invalid-argument", "La cantidad debe ser mayor a 0.");
    if (after < 0) throw new HttpsError("failed-precondition", `No hay suficiente existencia (hay ${before}).`);

    const prevAvg = Number(c.get("avgCost") ?? c.get("cost") ?? 0);
    const unitCost = input.unitCost ?? prevAvg;
    tx.update(productRef, { stock: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    if (input.type === "in" && input.unitCost != null) {
      // Costo promedio ponderado
      const avg = after > 0 ? Math.round((Math.max(before, 0) * prevAvg + input.qty * input.unitCost) / after) : input.unitCost;
      tx.set(costRef, { cost: input.unitCost, lastPurchaseCost: input.unitCost, avgCost: avg, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.set(movRef, {
      productId: p.id, productName: p.get("name"), sku: p.get("sku") ?? "",
      type: input.type, qty: input.type === "adjust" ? after - before : input.qty, unitCost,
      stockBefore: before, stockAfter: after, reason: input.reason,
      orderId: null, orderCode: null, saleId: null, saleCode: null,
      by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
    });
    return { stock: after };
  });
});

/** Descuenta del inventario un repuesto aprobado en una orden (una sola vez por línea). */
export const consumeOrderPart = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "reception", "warehouse", "technician"]);
  const input = parseInput(consumePartSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const orderRef = db.doc(`${orderCol.workOrders(tid)}/${input.orderId}`);
  const quoteRef = db.doc(`${quoteCol.quotes(tid)}/${input.quoteId}`);
  const key = `${input.quoteId}_${input.itemId}`;

  return db.runTransaction(async (tx) => {
    const [o, q] = await Promise.all([tx.get(orderRef), tx.get(quoteRef)]);
    if (!o.exists || !q.exists) throw new HttpsError("not-found", "La orden o la cotización no existe.");
    if (caller.role === "technician" && !((o.get("technicianIds") as string[]) ?? []).includes(caller.uid)) {
      throw new HttpsError("permission-denied", "No está asignado a esta orden.");
    }
    if (q.get("orderId") !== input.orderId || q.get("status") !== "approved") throw new HttpsError("failed-precondition", "La cotización no está aprobada para esta orden.");
    if ((o.get("consumed") ?? {})[key]) throw new HttpsError("already-exists", "Este repuesto ya se descontó del inventario.");
    const item = ((q.get("items") as Array<Record<string, unknown>>) ?? []).find((i) => i.id === input.itemId);
    if (!item || item.type !== "part" || !item.productId) throw new HttpsError("failed-precondition", "La línea no está enlazada a un producto del inventario.");

    const productRef = db.doc(`${catalogCol.products(tid)}/${item.productId}`);
    const costRef = db.doc(`${catalogCol.productCosts(tid)}/${item.productId}`);
    const [p, c] = await Promise.all([tx.get(productRef), tx.get(costRef)]);
    if (!p.exists) throw new HttpsError("not-found", "El producto ya no existe.");
    const qty = Number(item.qty);
    const before = Number(p.get("stock") ?? 0);
    const after = before - qty;
    if (after < 0) throw new HttpsError("failed-precondition", `No hay suficiente existencia de ${p.get("name")} (hay ${before}).`);

    const movRef = db.collection(catalogCol.movements(tid)).doc();
    tx.update(productRef, { stock: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    tx.set(movRef, {
      productId: p.id, productName: p.get("name"), sku: p.get("sku") ?? "", type: "out", qty,
      unitCost: Number(c.get("avgCost") ?? c.get("cost") ?? 0), stockBefore: before, stockAfter: after,
      reason: `Usado en orden ${o.get("code")}`, orderId: o.id, orderCode: o.get("code"), saleId: null, saleCode: null,
      by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
    });
    tx.update(orderRef, { [`consumed.${key}`]: { movementId: movRef.id, qty, at: FieldValue.serverTimestamp(), by: caller.uid } });
    return { stock: after };
  });
});
