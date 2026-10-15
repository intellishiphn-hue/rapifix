import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import {
  assignVehicleSchema, buildSearchKeywords, col, companyCol, DEFAULT_COMMISSION_PCT, financeCol, formatMoney, normalizePhone, orderCol,
  payCommissionsSchema, phoneSearchTerms, registerCompanyPaymentSchema, saveCompanySchema, saveReferrerSchema, setReferralSchema, voidCommissionSchema,
  type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";
import { paymentExtras } from "../lib/paymentExtras";
import { writePaymentToTarget, type PaymentTargetRead } from "../lib/payments";
import { recountCompanyVehicles } from "../lib/companies";

const MANAGERS: Role[] = ["admin", "manager"];
const COMPANY_WRITERS: Role[] = ["admin", "manager", "reception"];
const VEHICLE_WRITERS: Role[] = ["admin", "manager", "reception", "seller"];
const CASHIERS: Role[] = ["admin", "manager", "reception", "seller"];

/** Actualiza en lotes (máximo 450 escrituras por lote). */
async function batchUpdate(refs: DocumentReference[], data: Record<string, unknown>) {
  for (let i = 0; i < refs.length; i += 450) {
    const b = db.batch();
    for (const r of refs.slice(i, i + 450)) b.update(r, data);
    await b.commit();
  }
}

/**
 * Crea o edita una empresa (flota). La forma de pago, el límite de crédito y el descuento
 * solo los cambia administración o gerencia; recepción crea empresas de contado.
 */
export const saveCompany = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, COMPANY_WRITERS);
  const { companyId, ...input } = parseInput(saveCompanySchema, request.data);
  const tid = caller.tid;
  const isManager = MANAGERS.includes(caller.role);
  const contactPhone = input.contactPhone ? normalizePhone(input.contactPhone) : "";
  const approverPhone = input.approverPhone ? normalizePhone(input.approverPhone) : "";
  const money = {
    paymentTerms: input.paymentTerms, creditDays: input.creditDays, cutoffDay: input.cutoffDay, monthlyDueDays: input.monthlyDueDays,
    creditLimit: input.creditLimit, discountPct: input.discountPct,
  };
  const data = {
    name: input.name, legalName: input.legalName, rtn: input.rtn, contactName: input.contactName, contactPhone,
    contactEmail: input.contactEmail.toLowerCase(), address: input.address, notes: input.notes, active: input.active,
    approverName: input.approverName, approverPhone,
    searchKeywords: buildSearchKeywords([input.name, input.legalName, input.rtn, input.contactName, ...phoneSearchTerms(contactPhone), input.approverName]),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };

  if (companyId) {
    const ref = db.doc(`${companyCol.companies(tid)}/${companyId}`);
    const prev = await ref.get();
    if (!prev.exists) throw new HttpsError("not-found", "La empresa no existe.");
    await ref.update({ ...data, ...(isManager ? money : {}) });
    // Nombre nuevo: se actualiza en sus vehículos y órdenes abiertas (las cerradas conservan el de entonces)
    if (prev.get("name") !== input.name) {
      const [vehicles, open] = await Promise.all([
        db.collection(col.vehicles(tid)).where("companyId", "==", companyId).get(),
        db.collection(orderCol.workOrders(tid)).where("companyId", "==", companyId).where("isOpen", "==", true).get(),
      ]);
      await batchUpdate([...vehicles.docs, ...open.docs].map((d) => d.ref), { companyName: input.name });
    }
    return { companyId };
  }
  const ref = db.collection(companyCol.companies(tid)).doc();
  await ref.set({
    ...data,
    ...(isManager ? money : { paymentTerms: "cash", creditDays: 30, cutoffDay: null, monthlyDueDays: 15, creditLimit: null, discountPct: null }),
    referral: null, vehicleCount: 0, balanceDue: 0, openOrders: 0,
    createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid,
  });
  return { companyId: ref.id };
});

/**
 * Asigna un vehículo a una empresa (o lo quita con companyId null). El dueño del vehículo no cambia.
 * La orden abierta del vehículo también pasa a la empresa; las cerradas se quedan como estaban.
 */
export const assignVehicleToCompany = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, VEHICLE_WRITERS);
  const input = parseInput(assignVehicleSchema, request.data);
  const tid = caller.tid;
  const vehicleRef = db.doc(`${col.vehicles(tid)}/${input.vehicleId}`);

  const result = await db.runTransaction(async (tx) => {
    const v = await tx.get(vehicleRef);
    if (!v.exists) throw new HttpsError("not-found", "El vehículo no existe.");
    const prevId = (v.get("companyId") as string | undefined) || null;
    let name = "";
    if (input.companyId) {
      const c = await tx.get(db.doc(`${companyCol.companies(tid)}/${input.companyId}`));
      if (!c.exists) throw new HttpsError("not-found", "La empresa no existe.");
      if (c.get("active") === false) throw new HttpsError("failed-precondition", "La empresa está desactivada.");
      name = c.get("name") as string;
    }
    if (prevId === input.companyId) return { prevId, name, changed: false };
    tx.update(vehicleRef, input.companyId
      ? { companyId: input.companyId, companyName: name, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }
      : { companyId: FieldValue.delete(), companyName: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    return { prevId, name, changed: true };
  });
  if (!result.changed) return { ok: true, openOrdersUpdated: 0 };

  const open = await db.collection(orderCol.workOrders(tid)).where("vehicleId", "==", input.vehicleId).where("isOpen", "==", true).get();
  await batchUpdate(open.docs.map((d) => d.ref), { companyId: input.companyId, companyName: result.name });
  await Promise.all([result.prevId, input.companyId].filter((x): x is string => !!x).map((id) => recountCompanyVehicles(tid, id)));
  return { ok: true, openOrdersUpdated: open.size };
});

/** Crea o edita una persona que refiere clientes (cobra comisión). */
export const saveReferrer = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, MANAGERS);
  const { referrerId, ...input } = parseInput(saveReferrerSchema, request.data);
  const tid = caller.tid;
  const phone = normalizePhone(input.phone);
  const data = {
    ...input, phone, email: input.email.toLowerCase(),
    searchKeywords: buildSearchKeywords([input.name, input.idNumber, input.email, ...phoneSearchTerms(phone)]),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };
  if (referrerId) {
    const ref = db.doc(`${companyCol.referrers(tid)}/${referrerId}`);
    const prev = await ref.get();
    if (!prev.exists) throw new HttpsError("not-found", "El referido no existe.");
    await ref.update(data);
    if (prev.get("name") !== input.name) {
      const [companies, customers] = await Promise.all([
        db.collection(companyCol.companies(tid)).where("referral.referrerId", "==", referrerId).get(),
        db.collection(col.customers(tid)).where("referral.referrerId", "==", referrerId).get(),
      ]);
      await batchUpdate([...companies.docs, ...customers.docs].map((d) => d.ref), { "referral.referrerName": input.name });
    }
    return { referrerId };
  }
  const ref = db.collection(companyCol.referrers(tid)).doc();
  await ref.set({ ...data, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  return { referrerId: ref.id };
});

/** Indica (o quita) quién gana comisión por una empresa o un cliente. Solo administración y gerencia. */
export const setReferral = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, MANAGERS);
  const input = parseInput(setReferralSchema, request.data);
  const tid = caller.tid;
  const targetRef = db.doc(input.target === "company" ? `${companyCol.companies(tid)}/${input.targetId}` : `${col.customers(tid)}/${input.targetId}`);
  const target = await targetRef.get();
  if (!target.exists) throw new HttpsError("not-found", input.target === "company" ? "La empresa no existe." : "El cliente no existe.");
  let referral: Record<string, unknown> | null = null;
  if (input.referral) {
    const r = await db.doc(`${companyCol.referrers(tid)}/${input.referral.referrerId}`).get();
    if (!r.exists) throw new HttpsError("not-found", "El referido no existe.");
    if (r.get("active") === false) throw new HttpsError("failed-precondition", "El referido está desactivado.");
    referral = {
      referrerId: r.id, referrerName: r.get("name") as string,
      pct: input.referral.pct ?? Number(r.get("defaultPct") ?? DEFAULT_COMMISSION_PCT), basis: input.referral.basis,
      startDate: input.referral.startDate, endDate: input.referral.endDate,
      setBy: caller.uid, setAt: FieldValue.serverTimestamp(),
    };
  }
  await targetRef.update({ referral, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  return { ok: true };
});

/**
 * Pago de una empresa repartido entre varias órdenes, en UNA transacción. Cada orden recibe su propio
 * recibo REC (misma lógica que registerPayment) vinculado al pago de empresa (PE-0001).
 */
export const registerCompanyPayment = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CASHIERS);
  const input = parseInput(registerCompanyPaymentSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const companyRef = db.doc(`${companyCol.companies(tid)}/${input.companyId}`);
  const cpRef = db.collection(companyCol.companyPayments(tid)).doc();
  const extras = paymentExtras(tid, { method: input.method, bank: input.bank, receiptPath: input.receiptPath });

  return db.runTransaction(async (tx) => {
    const company = await tx.get(companyRef);
    if (!company.exists) throw new HttpsError("not-found", "La empresa no existe.");
    const refs = input.allocations.map((a) => db.doc(`${orderCol.workOrders(tid)}/${a.orderId}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const payCounter = await readCounter(tx, tid, "payments");
    const cpCounter = await readCounter(tx, tid, "companyPayments");
    for (const [i, s] of snaps.entries()) {
      if (!s.exists) throw new HttpsError("not-found", "Una de las órdenes no existe.");
      if (s.get("companyId") !== input.companyId) throw new HttpsError("failed-precondition", `La orden ${s.get("code")} no es de esta empresa.`);
      if (s.get("status") === "CANCELLED") throw new HttpsError("failed-precondition", `La orden ${s.get("code")} está cancelada.`);
      const balance = Number(s.get("totals.total") ?? 0) - Number(s.get("paid") ?? 0);
      if (input.allocations[i]!.amount > balance) throw new HttpsError("failed-precondition", `El abono a ${s.get("code")} supera su saldo (${formatMoney(balance)}).`);
    }
    const cpCode = `PE-${pad(cpCounter.next)}`;
    const allocations: Array<{ orderId: string; orderCode: string; amount: number; paymentId: string; paymentCode: string }> = [];
    let total = 0;
    snaps.forEach((s, i) => {
      const a = input.allocations[i]!;
      const r: PaymentTargetRead = { tid, orderId: s.id, saleId: null, ref: refs[i]!, target: s, counter: { ref: payCounter.ref, next: payCounter.next + i }, wash: null };
      const res = writePaymentToTarget(tx, r, {
        amount: a.amount, method: input.method, reference: input.reference, bank: input.bank, receiptPath: input.receiptPath,
        uid: caller.uid, byName: name, note: `Pago de empresa ${cpCode} (${company.get("name")})`, skipCounter: true,
        extra: { companyId: input.companyId, companyPaymentId: cpRef.id },
      });
      allocations.push({ orderId: s.id, orderCode: (s.get("code") as string) ?? "", amount: a.amount, paymentId: res.paymentId, paymentCode: res.code });
      total += a.amount;
    });
    tx.set(payCounter.ref, { next: payCounter.next + snaps.length }, { merge: true });
    tx.set(cpCounter.ref, { next: cpCounter.next + 1 }, { merge: true });
    tx.set(cpRef, {
      number: cpCounter.next, code: cpCode, companyId: input.companyId, companyName: company.get("name") ?? "",
      amount: total, method: input.method, reference: input.reference, ...extras, notes: input.notes ?? "",
      allocations, status: "valid", receivedBy: caller.uid, receivedByName: name, at: FieldValue.serverTimestamp(),
    });
    return { companyPaymentId: cpRef.id, code: cpCode, amount: total, receipts: allocations.map((a) => a.paymentCode) };
  });
});

/**
 * Paga comisiones pendientes de un referido: las marca pagadas, crea el comprobante de pago (COM-0001)
 * y registra el gasto en la categoría "Comisiones" para que Finanzas lo reste de la utilidad.
 */
export const payCommissions = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, MANAGERS);
  const input = parseInput(payCommissionsSchema, request.data);
  const tid = caller.tid;
  if (input.receiptPath && !input.receiptPath.startsWith(`tenants/${tid}/expenses/`)) throw new HttpsError("invalid-argument", "Comprobante no válido.");
  const name = await actorName(caller.uid, caller.email);
  const payoutRef = db.collection(companyCol.commissionPayouts(tid)).doc();
  const expenseRef = db.collection(financeCol.expenses(tid)).doc();
  const extras = paymentExtras(tid, { method: input.method, bank: input.bank, receiptPath: null });

  return db.runTransaction(async (tx) => {
    const referrer = await tx.get(db.doc(`${companyCol.referrers(tid)}/${input.referrerId}`));
    if (!referrer.exists) throw new HttpsError("not-found", "El referido no existe.");
    const refs = input.commissionIds.map((id) => db.doc(`${companyCol.commissions(tid)}/${id}`));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const payoutCounter = await readCounter(tx, tid, "commissionPayouts");
    const expenseCounter = await readCounter(tx, tid, "expenses");
    let amount = 0;
    const orderCodes: string[] = [];
    for (const s of snaps) {
      if (!s.exists) throw new HttpsError("not-found", "Una de las comisiones no existe.");
      if (s.get("referrerId") !== input.referrerId) throw new HttpsError("failed-precondition", `La comisión de ${s.get("orderCode")} es de otra persona.`);
      if (s.get("status") !== "pending") throw new HttpsError("failed-precondition", `La comisión de ${s.get("orderCode")} ya no está pendiente.`);
      amount += Number(s.get("amount") ?? 0);
      orderCodes.push((s.get("orderCode") as string) ?? "");
    }
    const referrerName = referrer.get("name") as string;
    const code = `COM-${pad(payoutCounter.next)}`;
    const ts = FieldValue.serverTimestamp();
    let expenseCode = "";
    if (amount > 0) {
      expenseCode = `GAS-${pad(expenseCounter.next)}`;
      tx.set(expenseCounter.ref, { next: expenseCounter.next + 1 }, { merge: true });
      const desc = `Comisiones ${code} a ${referrerName}: ${orderCodes.join(", ")}`;
      tx.set(expenseRef, {
        number: expenseCounter.next, code: expenseCode, category: "Comisiones",
        description: desc.length > 300 ? `${desc.slice(0, 296)}...` : desc,
        amount, date: Timestamp.now(), method: input.method, reference: input.reference,
        supplierId: null, supplierName: referrerName,
        receiptPath: input.receiptPath ?? null,
        receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "application/pdf" : "image") : null,
        unit: "shop", bank: extras.bank, status: "valid", voidReason: "", commissionPayoutId: payoutRef.id,
        createdAt: ts, createdBy: caller.uid, updatedAt: ts, updatedBy: caller.uid,
      });
    }
    tx.set(payoutCounter.ref, { next: payoutCounter.next + 1 }, { merge: true });
    tx.set(payoutRef, {
      number: payoutCounter.next, code, referrerId: input.referrerId, referrerName,
      commissionIds: input.commissionIds, orderCodes, count: snaps.length, amount,
      method: input.method, bank: extras.bank, reference: input.reference,
      receiptPath: input.receiptPath ?? null, receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "pdf" : "image") : null,
      notes: input.notes ?? "", expenseId: amount > 0 ? expenseRef.id : "", expenseCode,
      by: caller.uid, byName: name, at: ts,
    });
    for (const r of refs) tx.update(r, { status: "paid", paidAt: ts, payoutId: payoutRef.id, updatedAt: ts });
    return { payoutId: payoutRef.id, code, amount, expenseCode };
  });
});

/** Anula una comisión pendiente (no se recrea) o marca como revisada una pagada con aviso. Solo administración. */
export const voidCommission = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const input = parseInput(voidCommissionSchema, request.data);
  const ref = db.doc(`${companyCol.commissions(caller.tid)}/${input.commissionId}`);
  const name = await actorName(caller.uid, caller.email);
  return db.runTransaction(async (tx) => {
    const c = await tx.get(ref);
    if (!c.exists) throw new HttpsError("not-found", "La comisión no existe.");
    const ts = FieldValue.serverTimestamp();
    if (input.action === "void") {
      if (c.get("status") !== "pending") throw new HttpsError("failed-precondition", "Solo se anulan comisiones pendientes.");
      tx.update(ref, { status: "voided", autoVoided: false, voidReason: `${input.reason} (${name})`, voidedAt: ts, updatedAt: ts });
    } else {
      if (!c.get("needsReview")) throw new HttpsError("failed-precondition", "Esta comisión no tiene avisos por revisar.");
      tx.update(ref, { needsReview: false, reviewNote: `${c.get("reviewNote") ?? ""} Revisada por ${name}: ${input.reason}`.trim(), updatedAt: ts });
    }
    return { ok: true };
  });
});
