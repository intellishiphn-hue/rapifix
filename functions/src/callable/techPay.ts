import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  financeCol, opsCol, orderCol, payTechEarningsSchema, reviewTechEarningSchema, saveStaffMemberSchema, TECH_PAY_EXPENSE_CATEGORY, techPayCol,
  EMPLOYEE_COLORS,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";
import { paymentExtras } from "../lib/paymentExtras";
import { TECHPAY_ROLES } from "../lib/techPay";

/**
 * Empleado SIN acceso al panel (ej. un técnico que no usa el sistema): se registra con un id generado, sin
 * usuario de Auth ni claims. Queda en el directorio del personal (staffDirectory, con `noAccess: true`) y en
 * los perfiles (employees), así aparece en la lista de empleados, en el selector de técnicos de la orden, en
 * la agenda y en el pago a técnicos. Los usuarios del panel se siguen creando en Usuarios y permisos; esta
 * callable no toca sus documentos.
 */
export const saveStaffMember = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager"]);
  const input = parseInput(saveStaffMemberSchema, request.data);
  const tid = caller.tid;
  const staffCol = db.collection(orderCol.staff(tid));
  const ts = FieldValue.serverTimestamp();
  if (input.employeeId) {
    const ref = staffCol.doc(input.employeeId);
    const s = await ref.get();
    if (!s.exists) throw new HttpsError("not-found", "El empleado no existe.");
    if (!s.get("noAccess")) throw new HttpsError("failed-precondition", "Este empleado tiene usuario del panel: su nombre, rol y acceso se cambian en Usuarios y permisos.");
    await ref.update({ displayName: input.displayName, role: input.role, active: input.active, updatedAt: ts, updatedBy: caller.uid });
    return { employeeId: ref.id };
  }
  const ref = staffCol.doc();
  const batch = db.batch();
  batch.set(ref, { displayName: input.displayName, role: input.role, active: input.active, noAccess: true, createdAt: ts, createdBy: caller.uid, updatedAt: ts, updatedBy: caller.uid });
  batch.set(db.doc(`${opsCol.employees(tid)}/${ref.id}`), {
    phone: "", specialty: "", color: EMPLOYEE_COLORS[Math.floor(Math.random() * EMPLOYEE_COLORS.length)], updatedAt: ts, updatedBy: caller.uid,
  }, { merge: true });
  await batch.commit();
  return { employeeId: ref.id };
});

/**
 * Paga trabajos pendientes de un empleado: los marca pagados, crea el comprobante (PT-0001) y registra un
 * gasto "Pago a técnicos" con employeeId y techPayoutId. Ese gasto es salida de caja, pero Finanzas NO lo
 * vuelve a restar de la utilidad: el pago ya está en el costo de cada orden (ver isOperatingExpense).
 */
export const payTechEarnings = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, TECHPAY_ROLES);
  const input = parseInput(payTechEarningsSchema, request.data);
  const tid = caller.tid;
  if (input.receiptPath && !input.receiptPath.startsWith(`tenants/${tid}/expenses/`)) throw new HttpsError("invalid-argument", "Comprobante no válido.");
  const name = await actorName(caller.uid, caller.email);
  const payoutRef = db.collection(techPayCol.payouts(tid)).doc();
  const expenseRef = db.collection(financeCol.expenses(tid)).doc();
  const extras = paymentExtras(tid, { method: input.method, bank: input.bank, receiptPath: null });

  return db.runTransaction(async (tx) => {
    const staff = await tx.get(db.doc(`${orderCol.staff(tid)}/${input.employeeId}`));
    const refs = input.earningIds.map((id) => db.doc(`${techPayCol.earnings(tid)}/${id}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const payoutCounter = await readCounter(tx, tid, "techPayouts");
    const expenseCounter = await readCounter(tx, tid, "expenses");
    let amount = 0;
    const orderCodes: string[] = [];
    for (const s of snaps) {
      if (!s.exists) throw new HttpsError("not-found", "Uno de los trabajos ya no existe (la orden cambió). Recargue la página.");
      if (s.get("employeeId") !== input.employeeId) throw new HttpsError("failed-precondition", `El trabajo de ${s.get("orderCode")} es de otra persona.`);
      if (s.get("status") !== "pending") throw new HttpsError("failed-precondition", `El trabajo de ${s.get("orderCode")} ya no está pendiente.`);
      amount += Number(s.get("total") ?? 0);
      orderCodes.push((s.get("orderCode") as string) ?? "");
    }
    const employeeName = (staff.get("displayName") as string | undefined) || (snaps[0]?.get("employeeName") as string) || "Empleado";
    const code = `PT-${pad(payoutCounter.next)}`;
    const ts = FieldValue.serverTimestamp();
    let expenseCode = "";
    if (amount > 0) {
      expenseCode = `GAS-${pad(expenseCounter.next)}`;
      tx.set(expenseCounter.ref, { next: expenseCounter.next + 1 }, { merge: true });
      const desc = `Pago a técnico ${code} a ${employeeName}: ${orderCodes.join(", ")}`;
      tx.set(expenseRef, {
        number: expenseCounter.next, code: expenseCode, category: TECH_PAY_EXPENSE_CATEGORY,
        description: desc.length > 300 ? `${desc.slice(0, 296)}...` : desc,
        amount, date: Timestamp.now(), method: input.method, reference: input.reference,
        supplierId: null, supplierName: employeeName, employeeId: input.employeeId, employeeName,
        receiptPath: input.receiptPath ?? null,
        receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "application/pdf" : "image") : null,
        unit: "shop", bank: extras.bank, status: "valid", voidReason: "", techPayoutId: payoutRef.id,
        createdAt: ts, createdBy: caller.uid, updatedAt: ts, updatedBy: caller.uid,
      });
    }
    tx.set(payoutCounter.ref, { next: payoutCounter.next + 1 }, { merge: true });
    tx.set(payoutRef, {
      number: payoutCounter.next, code, employeeId: input.employeeId, employeeName,
      earningIds: input.earningIds, orderCodes, count: snaps.length, amount,
      method: input.method, bank: extras.bank, reference: input.reference,
      receiptPath: input.receiptPath ?? null, receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "pdf" : "image") : null,
      notes: input.notes ?? "", expenseId: amount > 0 ? expenseRef.id : "", expenseCode,
      by: caller.uid, byName: name, at: ts,
    });
    for (const r of refs) tx.update(r, { status: "paid", paidAt: ts, payoutId: payoutRef.id, updatedAt: ts });
    return { payoutId: payoutRef.id, code, amount, expenseCode };
  });
});

/** Marca como revisado el aviso de un trabajo ya pagado cuya orden cambió después. */
export const reviewTechEarning = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, TECHPAY_ROLES);
  const input = parseInput(reviewTechEarningSchema, request.data);
  const ref = db.doc(`${techPayCol.earnings(caller.tid)}/${input.earningId}`);
  const name = await actorName(caller.uid, caller.email);
  return db.runTransaction(async (tx) => {
    const e = await tx.get(ref);
    if (!e.exists) throw new HttpsError("not-found", "El trabajo no existe.");
    if (!e.get("needsReview")) throw new HttpsError("failed-precondition", "Este trabajo no tiene avisos por revisar.");
    tx.update(ref, { needsReview: false, reviewNote: `${e.get("reviewNote") ?? ""} Revisado por ${name}: ${input.note}`.trim(), updatedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  });
});
