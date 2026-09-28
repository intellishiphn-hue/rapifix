import { FieldValue, Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import {
  carwashCol, carwashSettingsFrom, catalogCol, col,
  type CarwashService, type CarwashSettings, type CreateSaleInput, type Role, type Totals,
} from "@rapifix/shared";
import { db } from "./admin";
import { pad } from "./counters";
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

type PaymentLine = CreateSaleInput["payments"][number];

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
    payments: PaymentLine[];
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
      status: "valid", voidReason: "", customerId: args.customerId, customerName: args.customerName,
      orderId: null, orderCode: null, saleId: saleRef.id, saleCode: code,
      receivedBy: args.uid, receivedByName: args.byName, at: FieldValue.serverTimestamp(),
    });
  });
  tx.set(args.payCounter.ref, { next: args.payCounter.next + args.payments.length }, { merge: true });
  return { saleId: saleRef.id, code, paymentIds };
}
