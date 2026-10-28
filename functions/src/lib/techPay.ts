import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  computeTechPay, decideTechEarning, orderCol, pickApprovedQuote, quoteCol, sanitizeTechPay, techEarningId, techPayCol, techPayEligible,
  type Quote, type QuoteItem, type QuoteItemType, type Role, type TechPayShare,
} from "@rapifix/shared";
import { db } from "./admin";

/** Quienes ven y editan el pago a técnicos (permiso "techpay.manage"). */
export const TECHPAY_ROLES: Role[] = ["admin", "manager"];

type WithTechPay = { id: string; type: QuoteItemType; techPay?: TechPayShare[] | null };

/**
 * Prepara el pago a técnicos de las líneas que llegan del navegador:
 * - Quien no tiene permiso NO lo puede cambiar: se conserva el que ya tenía cada línea (por id) en `previous`.
 * - Con permiso: cada empleado debe existir en el directorio del personal; el nombre se toma de ahí.
 * - Se quita de repuestos y "otro cargo" (ver sanitizeTechPay).
 */
export async function resolveTechPayItems<T extends WithTechPay>(tid: string, items: T[], opts: { canEdit: boolean; previous?: WithTechPay[] | null }): Promise<T[]> {
  if (!opts.canEdit) {
    const prev = new Map((opts.previous ?? []).map((it) => [it.id, it.techPay ?? null]));
    return sanitizeTechPay(items.map((it) => {
      const { techPay: _ignored, ...rest } = it;
      const keep = prev.get(it.id);
      return (keep?.length ? { ...rest, techPay: keep } : rest) as T;
    }));
  }
  return sanitizeTechPay(await fillTechPayNames(tid, items));
}

/** Valida los empleados de los repartos y les pone el nombre del directorio. */
export async function fillTechPayNames<T extends { type: QuoteItemType; techPay?: TechPayShare[] | null }>(tid: string, items: T[]): Promise<T[]> {
  const ids = [...new Set(items.filter((it) => techPayEligible(it.type)).flatMap((it) => it.techPay ?? []).map((s) => s.employeeId))];
  if (!ids.length) return items;
  const snaps = await db.getAll(...ids.map((id) => db.doc(`${orderCol.staff(tid)}/${id}`)));
  const names = new Map<string, string>();
  for (const s of snaps) {
    if (!s.exists) throw new HttpsError("invalid-argument", "Uno de los técnicos del pago por trabajo no existe. Recargue la página.");
    names.set(s.id, (s.get("displayName") as string) || "Técnico");
  }
  return items.map((it) => (it.techPay?.length ? { ...it, techPay: it.techPay.map((s) => ({ ...s, employeeName: names.get(s.employeeId) ?? s.employeeName })) } : it));
}

const fingerprint = (o: FirebaseFirestore.DocumentData | undefined) =>
  o ? JSON.stringify([o.paid ?? 0, o.balance ?? null, o.totals?.total ?? 0, o.activeQuoteId ?? null, o.status ?? ""]) : "-";

/**
 * Crea, recalcula, elimina o marca para revisión lo que gana cada técnico en una orden
 * (techEarnings/{orderId}__{employeeId}). Mismo disparador que la comisión por referido: la orden
 * pagada completa (total > 0, saldo <= 0, no cancelada). Idempotente: decide por el estado actual.
 * - Pendiente: se recalcula si cambió la cotización aprobada; se elimina si la orden vuelve a tener saldo
 *   o si ya no tiene pago para ese técnico.
 * - Pagado: no se toca; queda `needsReview` con una nota.
 * La escritura va en una transacción que confirma que la orden no cambió mientras se calculaba.
 */
export async function syncOrderTechPay(tid: string, orderId: string, opts: { flagNote?: string } = {}) {
  const orderRef = db.doc(`${orderCol.workOrders(tid)}/${orderId}`);
  const earningsQ = db.collection(techPayCol.earnings(tid)).where("orderId", "==", orderId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [orderSnap, pre] = await Promise.all([orderRef.get(), earningsQ.get()]);
    const order = orderSnap.data();
    const total = Number(order?.totals?.total ?? 0);
    const balance = order ? (typeof order.balance === "number" ? order.balance : total - Number(order.paid ?? 0)) : 0;
    const paidFull = !!order && total > 0 && balance <= 0 && order.status !== "CANCELLED";
    if (!paidFull && pre.empty) return; // lo más común: orden con saldo y sin pagos a técnicos

    let quote: Quote | null = null;
    if (paidFull) {
      const qs = await db.collection(quoteCol.quotes(tid)).where("orderId", "==", orderId).get();
      quote = pickApprovedQuote(qs.docs.map((d) => ({ id: d.id, ...d.data() }) as Quote), (order!.activeQuoteId as string | null | undefined) ?? null);
    }
    const tp = computeTechPay((quote?.items as QuoteItem[] | undefined) ?? []);
    const seen = fingerprint(order);

    const done = await db.runTransaction(async (tx) => {
      const [o, existing] = await Promise.all([tx.get(orderRef), tx.get(earningsQ)]);
      if (fingerprint(o.data()) !== seen) return false; // cambió mientras se calculaba: otra vuelta
      const ts = FieldValue.serverTimestamp();
      const byEmployee = new Map(existing.docs.map((d) => [d.get("employeeId") as string, d]));
      const employees = new Set([...byEmployee.keys(), ...tp.byEmployee.map((e) => e.employeeId)]);
      const v = order?.vehicle ?? {};
      for (const employeeId of employees) {
        const cur = byEmployee.get(employeeId);
        const e = cur?.data();
        const comp = tp.byEmployee.find((x) => x.employeeId === employeeId) ?? null;
        const computed = comp && comp.total > 0 ? { lines: comp.lines, total: comp.total } : null;
        const action = decideTechEarning({
          paidFull: paidFull && o.exists,
          existing: e ? { status: e.status, lines: e.lines ?? [], total: Number(e.total ?? 0), needsReview: !!e.needsReview } : null,
          computed,
        });
        const ref = cur?.ref ?? db.doc(`${techPayCol.earnings(tid)}/${techEarningId(orderId, employeeId)}`);
        if (action.kind === "create" && comp && quote) {
          tx.set(ref, {
            orderId, orderCode: order!.code ?? "", quoteId: quote.id,
            employeeId, employeeName: comp.employeeName,
            customerName: order!.customer?.fullName ?? "",
            vehicleLabel: [v.make, v.model, v.year].filter(Boolean).join(" "), plate: v.plate ?? "",
            lines: comp.lines, total: comp.total,
            status: "pending", earnedAt: ts, paidAt: null, payoutId: null, needsReview: false, reviewNote: "",
            updatedAt: ts,
          });
        } else if (action.kind === "recalc" && comp && quote) {
          tx.update(ref, { lines: comp.lines, total: comp.total, quoteId: quote.id, employeeName: comp.employeeName, updatedAt: ts });
        } else if (action.kind === "delete") {
          tx.delete(ref);
        } else if (action.kind === "flag") {
          tx.update(ref, { needsReview: true, reviewNote: (paidFull && opts.flagNote) || action.note, updatedAt: ts });
        }
      }
      return true;
    });
    if (done) return;
  }
  console.warn("[pago a técnicos] la orden cambió varias veces seguidas; se resolverá con el siguiente cambio", tid, orderId);
}
