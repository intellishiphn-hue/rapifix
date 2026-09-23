import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { buildSearchKeywords, catalogCol } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";

const L = (n: number) => Math.round(n * 100);
const PRODUCTS = [
  { sku: "FA-90915", name: "Filtro de aceite Toyota 90915-YZZD2", category: "Filtros", brand: "Toyota", price: L(220), cost: L(130), stock: 12, min: 4 },
  { sku: "AC-5W30-G", name: "Aceite sintético 5W-30 (galón)", category: "Aceites", brand: "Mobil", price: L(1150), cost: L(780), stock: 10, min: 3 },
  { sku: "PF-DEL-COR", name: "Pastillas de freno delanteras Corolla (juego)", category: "Frenos", brand: "Brembo", price: L(1800), cost: L(1100), stock: 4, min: 2 },
  { sku: "FAIRE-TUC", name: "Filtro de aire Hyundai Tucson", category: "Filtros", brand: "Mann", price: L(480), cost: L(260), stock: 6, min: 2 },
  { sku: "BUJ-IRID", name: "Bujía de iridio NGK", category: "Encendido", brand: "NGK", price: L(390), cost: L(210), stock: 16, min: 8 },
  { sku: "LIQ-FRENO", name: "Líquido de frenos DOT 4 (500 ml)", category: "Fluidos", brand: "Bosch", price: L(260), cost: L(140), stock: 8, min: 3 },
  { sku: "REF-VERDE", name: "Refrigerante verde (galón)", category: "Fluidos", brand: "Prestone", price: L(520), cost: L(310), stock: 1, min: 3 },
  { sku: "BAT-12V60", name: "Batería 12V 60Ah", category: "Eléctrico", brand: "LTH", price: L(3600), cost: L(2600), stock: 3, min: 2 },
];
const SERVICES = [
  { code: "MO-ACEITE", name: "Cambio de aceite y filtro (mano de obra)", category: "Mantenimiento", price: L(350), hours: 0.5, days: 90, km: 5000 },
  { code: "ALIN-BAL", name: "Alineado y balanceo", category: "Suspensión", price: L(900), hours: 1, days: 180, km: 10000 },
  { code: "DIAG-COMP", name: "Diagnóstico computarizado (escáner)", category: "Diagnóstico", price: L(600), hours: 1 },
  { code: "MO-FRENOS", name: "Cambio de pastillas de freno (mano de obra)", category: "Frenos", price: L(700), hours: 1.5 },
  { code: "RECT-DISC", name: "Rectificado de discos (par)", category: "Frenos", price: L(1200), hours: 1 },
  { code: "LAV-MOTOR", name: "Lavado de motor", category: "Estética", price: L(400), hours: 0.5 },
];

/** Catálogo de demostración con existencias iniciales. Solo una vez. */
export const seedDemoCatalog = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const tid = caller.tid;
  const flag = db.doc(`tenants/${tid}/meta/demoCatalog`);
  if ((await flag.get()).exists) throw new HttpsError("already-exists", "El catálogo demo ya fue cargado.");
  const name = await actorName(caller.uid, caller.email);
  const now = FieldValue.serverTimestamp();
  const meta = { createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid };
  const batch = db.batch();
  for (const p of PRODUCTS) {
    const ref = db.collection(catalogCol.products(tid)).doc();
    batch.set(ref, {
      sku: p.sku, name: p.name, category: p.category, brand: p.brand, supplier: "", unit: "unidad", price: p.price, stock: p.stock, minStock: p.min,
      location: "", taxable: true, active: true, searchKeywords: buildSearchKeywords([p.name, p.sku, p.brand, p.category]), ...meta,
    });
    batch.set(db.doc(`${catalogCol.productCosts(tid)}/${ref.id}`), { cost: p.cost, avgCost: p.cost, lastPurchaseCost: p.cost, updatedAt: now });
    batch.set(db.collection(catalogCol.movements(tid)).doc(), {
      productId: ref.id, productName: p.name, sku: p.sku, type: "in", qty: p.stock, unitCost: p.cost, stockBefore: 0, stockAfter: p.stock,
      reason: "Existencia inicial (demo)", orderId: null, orderCode: null, saleId: null, saleCode: null, by: caller.uid, byName: name, at: now,
    });
  }
  for (const s of SERVICES) {
    batch.set(db.collection(catalogCol.services(tid)).doc(), {
      code: s.code, name: s.name, category: s.category, price: s.price, estimatedHours: s.hours, intervalDays: (s as { days?: number }).days ?? 0, intervalKm: (s as { km?: number }).km ?? 0, taxable: true, active: true,
      searchKeywords: buildSearchKeywords([s.name, s.code, s.category]), ...meta,
    });
  }
  batch.set(flag, { at: now, by: caller.uid });
  await batch.commit();
  return { products: PRODUCTS.length, services: SERVICES.length };
});
