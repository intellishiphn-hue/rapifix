import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import {
  applyLoyaltyWash, carwashCol, carwashSettingsFrom, catalogCol, col, computeWashCharge, loyaltyWelcomeFor, VEHICLE_SIZE_SHORT,
  type CarwashService, type CarwashSettings, type PaymentMethod, type Role, type Totals, type VehicleSize, type WashItem,
} from "@rapifix/shared";
import { db } from "./admin";
import { pad, readCounter } from "./counters";
import { paymentExtras } from "./paymentExtras";

export const CASHIERS: Role[] = ["admin", "manager", "reception", "seller"];
export const CARWASH_STAFF: Role[] = ["admin", "manager", "reception", "seller", "washer"];
export const CARWASH_MANAGERS: Role[] = ["admin", "manager"];

export const toMs = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === "number" ? v : 0);

/** Tasa de ISV (settings/general) y configuración del carwash (settings/carwash). */
export async function loadCarwashConfig(tid: string): Promise<{ taxRate: number; cw: CarwashSettings }> {
  const [general, carwash] = await Promise.all([db.doc(`${col.settings(tid)}/general`).get(), db.doc(`${col.settings(tid)}/carwash`).get()]);
  return { taxRate: Number(general.get("taxRate") ?? 15), cw: carwashSettingsFrom(carwash.data() as Partial<CarwashSettings> | undefined) };
}

export async function loadCarwashServices(tid: string): Promise<CarwashService[]> {
  const snap = await db.collection(carwashCol.services(tid)).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CarwashService);
}

/** Pago de una venta: los manuales de caja o "online" (ROKI), con campos extra opcionales (ids de ROKI). */
export interface SalePaymentLine {
  amount: number;
  method: PaymentMethod;
  reference: string;
  bank?: string | null;
  receiptPath?: string | null;
  extra?: Record<string, unknown>;
}

/**
 * Escribe una venta del carwash (unit "carwash") y sus pagos dentro de una transacción,
 * con el mismo formato que createSale (contadores V-0001 / REC-0001, banco y comprobante).
 * Los contadores deben haberse leído antes (readCounter) porque en una transacción las lecturas van primero.
 */
export function writeCarwashSale(
  tx: Transaction,
  args: {
    tid: string;
    uid: string;
    byName: string;
    saleCounter: { ref: DocumentReference; next: number };
    payCounter: { ref: DocumentReference; next: number };
    customerId: string | null;
    customerName: string;
    vehicleId: string | null;
    vehicleLabel: string;
    items: Array<{ refId: string | null; description: string; unitPrice: number; discount: number; taxable: boolean; lineTotal: number }>;
    taxRate: number;
    totals: Totals;
    payments: SalePaymentLine[];
    washId: string | null;
    extra?: Record<string, unknown>;
  },
): { saleId: string; code: string; paymentIds: string[] } {
  const { tid } = args;
  const saleRef = db.collection(catalogCol.sales(tid)).doc();
  const code = `V-${pad(args.saleCounter.next)}`;
  const paid = args.payments.reduce((a, p) => a + p.amount, 0);
  tx.set(args.saleCounter.ref, { next: args.saleCounter.next + 1 }, { merge: true });
  tx.set(saleRef, {
    number: args.saleCounter.next, code,
    customerId: args.customerId, customerName: args.customerName, vehicleId: args.vehicleId, vehicleLabel: args.vehicleLabel,
    items: args.items.map((it, i) => ({
      id: `cw${i + 1}`, kind: "service", refId: it.refId, description: it.description, qty: 1,
      unitPrice: it.unitPrice, discount: it.discount, taxable: it.taxable, lineTotal: it.lineTotal,
    })),
    taxRate: args.taxRate, totals: args.totals, paid, balance: args.totals.total - paid,
    status: args.totals.total - paid <= 0 ? "paid" : "partial",
    unit: "carwash", washId: args.washId,
    ...(args.extra ?? {}),
    by: args.uid, byName: args.byName, at: FieldValue.serverTimestamp(),
  });
  const paymentIds: string[] = [];
  args.payments.forEach((p, i) => {
    const ref = db.collection(catalogCol.payments(tid)).doc();
    paymentIds.push(ref.id);
    tx.set(ref, {
      number: args.payCounter.next + i, code: `REC-${pad(args.payCounter.next + i)}`, amount: p.amount, method: p.method, reference: p.reference, ...paymentExtras(tid, p),
      ...(p.extra ?? {}),
      status: "valid", voidReason: "", customerId: args.customerId, customerName: args.customerName,
      orderId: null, orderCode: null, saleId: saleRef.id, saleCode: code,
      receivedBy: args.uid, receivedByName: args.byName, at: FieldValue.serverTimestamp(),
    });
  });
  tx.set(args.payCounter.ref, { next: args.payCounter.next + args.payments.length }, { merge: true });
  return { saleId: saleRef.id, code, paymentIds };
}

// ============================================================================
// Cobro de un lavado (venta del carwash + pagos + sello de lealtad).
// Lo usan chargeWash (caja), el pago en línea con ROKI y la aprobación de comprobantes.
// En una transacción las lecturas van primero: readWashCharge() y después writeWashCharge().
// ============================================================================

export interface WashChargeRead {
  tid: string;
  ref: DocumentReference;
  wash: DocumentSnapshot;
  loyaltyRef: DocumentReference | null;
  loyalty: DocumentSnapshot | null;
  saleCounter: { ref: DocumentReference; next: number };
  payCounter: { ref: DocumentReference; next: number };
}

/** Lecturas del cobro (el lavado puede no existir: el que llama decide qué hacer). */
export async function readWashCharge(tx: Transaction, tid: string, washId: string): Promise<WashChargeRead> {
  const ref = db.doc(`${carwashCol.washes(tid)}/${washId}`);
  const wash = await tx.get(ref);
  const plate = wash.exists ? String(wash.get("plate") ?? "") : "";
  const loyaltyRef = plate ? db.doc(`${carwashCol.loyalty(tid)}/${plate}`) : null;
  const loyalty = loyaltyRef ? await tx.get(loyaltyRef) : null;
  const saleCounter = await readCounter(tx, tid, "sales");
  const payCounter = await readCounter(tx, tid, "payments");
  return { tid, ref, wash, loyaltyRef, loyalty, saleCounter, payCounter };
}

export interface WashChargeResult {
  saleId: string;
  code: string;
  paymentIds: string[];
  earnedReward: boolean;
  stamps: number | null;
  /** los pagos cubren el total */
  fullyPaid: boolean;
  total: number;
  paidTotal: number;
}

/**
 * Registra el cobro del lavado. mode "exact" (caja y comprobantes): los pagos deben sumar el total.
 * mode "online" (ROKI, el dinero ya entró): se registra lo pagado aunque no cuadre con el total.
 */
export function writeWashCharge(
  tx: Transaction,
  r: WashChargeRead,
  args: { cfg: { taxRate: number; cw: CarwashSettings }; uid: string; byName: string; discount: number; payments: SalePaymentLine[]; mode: "exact" | "online" },
): WashChargeResult {
  const w = r.wash;
  if (!w.exists) throw new HttpsError("not-found", "El lavado no existe.");
  const cancelled = w.get("status") === "cancelled";
  if (cancelled && args.mode === "exact") throw new HttpsError("failed-precondition", "El lavado está cancelado.");
  if (w.get("saleId")) throw new HttpsError("failed-precondition", `Este lavado ya fue cobrado (${w.get("saleCode")}).`);
  const { cfg } = args;
  const plate = String(w.get("plate"));
  const items = (w.get("items") as WashItem[]) ?? [];
  const gross = items.reduce((a, i) => a + i.price, 0);
  if (args.discount > gross) throw new HttpsError("invalid-argument", "El descuento es mayor que el total.");
  // Se respeta el modo de ISV con que se registró el lavado
  const taxMode = (w.get("taxMode") as CarwashSettings["taxMode"]) ?? cfg.cw.taxMode;
  const taxRate = Number(w.get("taxRate") ?? cfg.taxRate);
  const charge = computeWashCharge(items.map((i) => i.price), taxRate, taxMode, args.discount);
  const total = charge.totals.total;
  if (total <= 0) throw new HttpsError("failed-precondition", "El total es 0: no hay nada que cobrar.");
  const paidTotal = args.payments.reduce((a, p) => a + p.amount, 0);
  if (args.mode === "exact" && paidTotal !== total) throw new HttpsError("invalid-argument", "Los pagos deben sumar exactamente el total a cobrar.");
  const fullyPaid = paidTotal >= total;

  const size = w.get("size") as VehicleSize;
  const main = items.find((i) => i.kind === "wash");
  const every = cfg.cw.loyaltyEvery;
  const counts = !!main && !main.covered && every > 0 && fullyPaid && !cancelled;
  const loyalty = r.loyalty;
  const welcome = counts ? loyaltyWelcomeFor({ exists: !!loyalty?.exists, welcomePending: loyalty?.get("welcomePending") }, cfg.cw) : 0;
  const loyaltyAfter = counts
    ? applyLoyaltyWash({ count: Number(loyalty?.get("count") ?? 0), rewardsAvailable: Number(loyalty?.get("rewardsAvailable") ?? 0) }, every, welcome)
    : null;

  const customerName = String(w.get("customerName") || "Consumidor final");
  const sale = writeCarwashSale(tx, {
    tid: r.tid, uid: args.uid, byName: args.byName, saleCounter: r.saleCounter, payCounter: r.payCounter,
    customerId: (w.get("customerId") as string | null) ?? null, customerName,
    vehicleId: (w.get("vehicleId") as string | null) ?? null,
    vehicleLabel: `${VEHICLE_SIZE_SHORT[size] ?? ""} · placa ${plate}`,
    items: items.map((it, i) => ({
      refId: it.serviceId,
      description: `${it.name} (${VEHICLE_SIZE_SHORT[size] ?? size})${it.covered === "membership" ? " · membresía" : it.covered === "reward" ? " · premio de lealtad" : ""}`,
      unitPrice: charge.lines[i]!.unitPrice, discount: charge.lines[i]!.discount, taxable: charge.lines[i]!.taxable, lineTotal: charge.lines[i]!.lineTotal,
    })),
    taxRate, totals: charge.totals, payments: args.payments, washId: r.ref.id,
    extra: { washCode: w.get("code") },
  });
  if (loyaltyAfter && r.loyaltyRef) {
    const patch: Record<string, unknown> = { count: loyaltyAfter.count, rewardsAvailable: loyaltyAfter.rewardsAvailable, lastWashAt: FieldValue.serverTimestamp() };
    // Tarjeta nueva: sus sellos de regalo quedan aplicados (una sola vez)
    if (!loyalty?.exists || loyalty.get("welcomePending") === true) Object.assign(patch, { welcomePending: false, welcomeStamps: welcome });
    if (!loyalty?.exists) {
      Object.assign(patch, {
        rewardsUsed: 0, totalWashes: 1, customerName: String(w.get("customerName") ?? ""), phone: String(w.get("phone") ?? ""),
        size: size ?? null, customerId: (w.get("customerId") as string | null) ?? null, vehicleId: (w.get("vehicleId") as string | null) ?? null,
      });
    }
    tx.set(r.loyaltyRef, patch, { merge: true });
  }
  tx.update(r.ref, {
    paid: fullyPaid, paidAt: fullyPaid ? FieldValue.serverTimestamp() : null, saleId: sale.saleId, saleCode: sale.code,
    discount: args.discount, totals: charge.totals, total,
    loyaltyCounted: !!loyaltyAfter,
    loyaltyStamps: loyaltyAfter ? loyaltyAfter.count : Number(loyalty?.get("count") ?? 0),
    loyaltyEvery: every,
    ...(welcome > 0 && loyaltyAfter ? { loyaltyWelcome: welcome } : {}),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: args.uid,
  });
  return { saleId: sale.saleId, code: sale.code, paymentIds: sale.paymentIds, earnedReward: !!loyaltyAfter?.earned, stamps: loyaltyAfter?.count ?? null, fullyPaid, total, paidTotal };
}
