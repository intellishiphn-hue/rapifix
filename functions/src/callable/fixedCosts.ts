import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  addMonths, adjustPendingExpenseSchema, financeCol, FINANCE_META_DOCS, generateFixedCostsSchema, orderCol,
  payPendingExpenseSchema, saveFinanceBudgetSchema, saveFixedCostSchema, type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { ensureFixedCostsForMonth, hnCurrentMonth, syncCurrentMonth } from "../lib/fixedCosts";

const FINANCE: Role[] = ["admin", "manager"];

/** Crea o edita una plantilla de gasto fijo y sincroniza los pendientes del mes actual. */
export const saveFixedCost = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const { fixedCostId, ...input } = parseInput(saveFixedCostSchema, request.data);
  const tid = caller.tid;

  const [supplier, staff] = await Promise.all([
    input.supplierId ? db.doc(`${financeCol.suppliers(tid)}/${input.supplierId}`).get() : null,
    input.employeeId ? db.doc(`${orderCol.staff(tid)}/${input.employeeId}`).get() : null,
  ]);
  if (supplier && !supplier.exists) throw new HttpsError("not-found", "El proveedor no existe.");
  if (staff && !staff.exists) throw new HttpsError("not-found", "El empleado no existe.");

  const data = {
    name: input.name, category: input.category, amount: input.amount, frequency: input.frequency,
    dayOfMonth: input.dayOfMonth, unit: input.unit,
    employeeId: input.employeeId ?? null,
    employeeName: staff?.exists ? String(staff.get("displayName") ?? input.employeeName) : input.employeeName,
    supplierId: input.supplierId ?? null,
    supplierName: supplier?.exists ? String(supplier.get("name") ?? "") : "",
    defaultMethod: input.defaultMethod, notes: input.notes, active: input.active,
    startMonth: input.startMonth, endMonth: input.endMonth ?? null,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };
  let id = fixedCostId ?? null;
  if (id) {
    const ref = db.doc(`${financeCol.fixedCosts(tid)}/${id}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "El gasto fijo no existe.");
    await ref.update(data);
  } else {
    const ref = db.collection(financeCol.fixedCosts(tid)).doc();
    await ref.set({ ...data, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
    id = ref.id;
  }
  await syncCurrentMonth(tid, id, caller.uid);
  return { fixedCostId: id };
});

/** Genera (idempotente) los gastos pendientes de un mes. Solo meses pasados, el actual o el siguiente. */
export const generateFixedCosts = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const { month } = parseInput(generateFixedCostsSchema, request.data);
  if (month > addMonths(hnCurrentMonth(), 1) || month < "2020-01") throw new HttpsError("invalid-argument", "Mes fuera de rango.");
  return ensureFixedCostsForMonth(caller.tid, month, { by: caller.uid });
});

/** Marca como pagado un gasto pendiente (con el monto real, fecha, método, banco y comprobante). */
export const payPendingExpense = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(payPendingExpenseSchema, request.data);
  const tid = caller.tid;
  if (input.receiptPath && !input.receiptPath.startsWith(`tenants/${tid}/expenses/`)) throw new HttpsError("invalid-argument", "Comprobante no válido.");
  if (input.date > Date.now() + 5 * 60_000) throw new HttpsError("invalid-argument", "La fecha de pago no puede ser futura.");
  const ref = db.doc(`${financeCol.expenses(tid)}/${input.expenseId}`);
  return db.runTransaction(async (tx) => {
    const e = await tx.get(ref);
    if (!e.exists) throw new HttpsError("not-found", "El gasto no existe.");
    if (e.get("status") !== "pending") throw new HttpsError("failed-precondition", "Este gasto ya no está pendiente.");
    const changed = input.amount !== Number(e.get("amount") ?? 0);
    tx.update(ref, {
      status: "valid", amount: input.amount, date: Timestamp.fromMillis(input.date), paidAt: FieldValue.serverTimestamp(),
      method: input.method, reference: input.reference, bank: input.bank?.trim() ?? "",
      receiptPath: input.receiptPath ?? null,
      receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "application/pdf" : "image") : null,
      ...(changed ? { adjusted: true } : {}),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    return { code: e.get("code") as string };
  });
});

/** Cambia el monto (y opcionalmente la fecha de vencimiento) de un gasto pendiente de este mes. */
export const adjustPendingExpense = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(adjustPendingExpenseSchema, request.data);
  const ref = db.doc(`${financeCol.expenses(caller.tid)}/${input.expenseId}`);
  return db.runTransaction(async (tx) => {
    const e = await tx.get(ref);
    if (!e.exists) throw new HttpsError("not-found", "El gasto no existe.");
    if (e.get("status") !== "pending") throw new HttpsError("failed-precondition", "Solo se pueden ajustar gastos pendientes.");
    const due = input.dueDate != null ? Timestamp.fromMillis(input.dueDate) : null;
    tx.update(ref, {
      amount: input.amount, adjusted: true,
      ...(due ? { dueDate: due, date: due } : {}),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    return { ok: true };
  });
});

/** Presupuesto mensual por categoría (gastos variables). Un monto 0 quita el presupuesto de esa categoría. */
export const saveFinanceBudget = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const { budgets } = parseInput(saveFinanceBudgetSchema, request.data);
  const clean = Object.fromEntries(Object.entries(budgets).filter(([, v]) => v > 0));
  await db.doc(`${financeCol.financeMeta(caller.tid)}/${FINANCE_META_DOCS.budget}`).set({
    budgets: clean, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  });
  return { ok: true };
});
