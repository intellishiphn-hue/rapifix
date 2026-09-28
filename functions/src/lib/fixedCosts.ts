import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  financeCol, FINANCE_META_DOCS, fixedCostAppliesTo, fixedCostInstallments, fixedExpenseId, hnDayKey, hnNoonMs,
  type FixedCost, type Installment,
} from "@rapifix/shared";
import { db } from "./admin";
import { pad, readCounter } from "./counters";

type FixedCostData = Omit<FixedCost, "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">;

export const hnCurrentMonth = () => hnDayKey(Date.now()).slice(0, 7);

function installmentLabel(fc: Pick<FixedCostData, "name" | "frequency">, inst: Installment) {
  if (fc.frequency !== "biweekly") return fc.name;
  return `${fc.name} (${inst.part === 1 ? "1.ª" : "2.ª"} quincena)`;
}

/** Campos del gasto que salen de la plantilla (se usan al crear y al sincronizar pendientes sin ajustar). */
function templateFields(fc: FixedCostData, inst: Installment) {
  const due = Timestamp.fromMillis(hnNoonMs(inst.dayKey));
  return {
    category: fc.category,
    description: installmentLabel(fc, inst),
    amount: inst.amount,
    date: due,
    dueDate: due,
    method: fc.defaultMethod,
    supplierId: fc.supplierId ?? null,
    supplierName: fc.supplierName ?? "",
    unit: fc.unit,
    employeeId: fc.employeeId ?? null,
    employeeName: fc.employeeName ?? "",
  };
}

/**
 * Crea (si no existen) los gastos pendientes del mes para los gastos fijos activos.
 * Idempotente: el id del gasto es fc_{fixedCostId}_{YYYY-MM}_{1|2}; si ya existe (pendiente, pagado,
 * editado o anulado) no se toca.
 */
export async function ensureFixedCostsForMonth(tid: string, month: string, opts: { onlyId?: string; by?: string } = {}) {
  const by = opts.by ?? "system";
  const docs = opts.onlyId
    ? [await db.doc(`${financeCol.fixedCosts(tid)}/${opts.onlyId}`).get()].filter((d) => d.exists)
    : (await db.collection(financeCol.fixedCosts(tid)).get()).docs;
  let created = 0;
  let skipped = 0;
  for (const d of docs) {
    const fc = d.data() as FixedCostData;
    if (!fixedCostAppliesTo(fc, month)) continue;
    for (const inst of fixedCostInstallments(fc, month)) {
      const ref = db.doc(`${financeCol.expenses(tid)}/${fixedExpenseId(d.id, month, inst.part)}`);
      const made = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (cur.exists) return false;
        const counter = await readCounter(tx, tid, "expenses");
        tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });
        tx.set(ref, {
          ...templateFields(fc, inst),
          number: counter.next, code: `GAS-${pad(counter.next)}`, reference: "",
          receiptPath: null, receiptType: null, status: "pending", voidReason: "",
          fixedCostId: d.id, period: month, part: inst.part, adjusted: false, paidAt: null,
          createdAt: FieldValue.serverTimestamp(), createdBy: by, updatedAt: FieldValue.serverTimestamp(), updatedBy: by,
        });
        return true;
      });
      if (made) created++;
      else skipped++;
    }
  }
  if (!opts.onlyId) {
    await db.doc(`${financeCol.financeMeta(tid)}/${FINANCE_META_DOCS.fixedCosts}`).set(
      { generated: { [month]: true }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  return { created, skipped };
}

/**
 * Después de editar una plantilla: los pendientes del mes actual que nadie ha ajustado a mano
 * se actualizan con los nuevos datos; si la plantilla ya no aplica (desactivada, cambió de quincenal a
 * mensual...) se anulan. Los pagados, ajustados o anulados no se tocan.
 */
export async function syncCurrentMonth(tid: string, fixedCostId: string, by: string) {
  const month = hnCurrentMonth();
  const snap = await db.doc(`${financeCol.fixedCosts(tid)}/${fixedCostId}`).get();
  if (!snap.exists) return;
  const fc = snap.data() as FixedCostData;
  const applies = fixedCostAppliesTo(fc, month);
  const wanted = applies ? fixedCostInstallments(fc, month) : [];

  for (const part of [1, 2] as const) {
    const ref = db.doc(`${financeCol.expenses(tid)}/${fixedExpenseId(fixedCostId, month, part)}`);
    const inst = wanted.find((w) => w.part === part);
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists || cur.get("status") !== "pending" || cur.get("adjusted") === true) return;
      if (!inst) {
        tx.update(ref, { status: "voided", voidReason: "El gasto fijo ya no aplica este mes", updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
        return;
      }
      tx.update(ref, { ...templateFields(fc, inst), updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
    });
  }
  // Crea lo que falte de esta plantilla en el mes actual (idempotente).
  if (applies) await ensureFixedCostsForMonth(tid, month, { onlyId: fixedCostId, by });
}
