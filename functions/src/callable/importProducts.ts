import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { buildSearchKeywords, catalogCol, importProductsSchema, normalizeText } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";

/**
 * Carga masiva de productos desde Excel (hasta 200 filas por llamada; el panel manda por partes).
 * Busca cada producto por código y, si no tiene código, por nombre. Crea los nuevos con su existencia
 * inicial (movimiento de entrada) y actualiza los que ya existen. La existencia de los existentes solo
 * cambia si se pide, y siempre con un movimiento de "ajuste por conteo".
 */
export const importProducts = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "warehouse"]);
  const input = parseInput(importProductsSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);

  const all = await db.collection(catalogCol.products(tid)).select("sku", "name", "stock").get();
  const bySku = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const byName = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  all.docs.forEach((d) => {
    const sku = String(d.get("sku") ?? "").trim().toUpperCase();
    if (sku) bySku.set(sku, d);
    byName.set(normalizeText(String(d.get("name") ?? "")), d);
  });

  let created = 0;
  let updated = 0;
  let adjusted = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();

  let batch = db.batch();
  let ops = 0;
  const flush = async () => {
    if (ops) await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const r of input.rows) {
    const sku = r.sku.trim().toUpperCase();
    const key = sku || `name:${normalizeText(r.name)}`;
    if (seen.has(key)) {
      errors.push({ row: r.row, message: sku ? `Código ${sku} repetido en el archivo` : `"${r.name}" repetido en el archivo` });
      continue;
    }
    seen.add(key);
    const existing = (sku && bySku.get(sku)) || byName.get(normalizeText(r.name));
    const data = {
      sku, name: r.name, category: r.category, brand: r.brand, supplier: r.supplier, unit: r.unit || "unidad",
      price: r.price, minStock: r.minStock, location: r.location, taxable: r.taxable, active: r.active,
      searchKeywords: buildSearchKeywords([r.name, sku, r.brand, r.category, r.supplier]),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    };

    if (!existing) {
      const ref = db.collection(catalogCol.products(tid)).doc();
      const stock = r.stock ?? 0;
      batch.set(ref, { ...data, stock, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
      ops++;
      if (r.cost != null) {
        batch.set(db.doc(`${catalogCol.productCosts(tid)}/${ref.id}`), { cost: r.cost, avgCost: r.cost, lastPurchaseCost: r.cost, updatedAt: FieldValue.serverTimestamp() });
        ops++;
      }
      if (stock > 0) {
        batch.set(db.collection(catalogCol.movements(tid)).doc(), {
          productId: ref.id, productName: r.name, sku, type: "in", qty: stock, unitCost: r.cost ?? 0,
          stockBefore: 0, stockAfter: stock, reason: "Carga inicial desde Excel",
          orderId: null, orderCode: null, saleId: null, saleCode: null, by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
        });
        ops++;
      }
      created++;
    } else {
      batch.update(existing.ref, data);
      ops++;
      if (r.cost != null) {
        batch.set(db.doc(`${catalogCol.productCosts(tid)}/${existing.id}`), { cost: r.cost, lastPurchaseCost: r.cost, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        ops++;
      }
      const before = Number(existing.get("stock") ?? 0);
      if (input.updateStock && r.stock != null && r.stock !== before) {
        batch.update(existing.ref, { stock: r.stock });
        batch.set(db.collection(catalogCol.movements(tid)).doc(), {
          productId: existing.id, productName: r.name, sku, type: "adjust", qty: r.stock - before, unitCost: r.cost ?? 0,
          stockBefore: before, stockAfter: r.stock, reason: "Ajuste por conteo (Excel)",
          orderId: null, orderCode: null, saleId: null, saleCode: null, by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
        });
        ops += 2;
        adjusted++;
      }
      updated++;
    }
    if (ops >= 400) await flush();
  }
  await flush();
  if (!created && !updated && errors.length) throw new HttpsError("invalid-argument", errors.map((e) => `Fila ${e.row}: ${e.message}`).slice(0, 5).join(". "));
  return { created, updated, adjusted, errors };
});
