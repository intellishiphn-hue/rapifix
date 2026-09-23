import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  buildSearchKeywords, catalogCol, createPurchaseSchema, financeCol, formatMoney, paySupplierSchema, saveExpenseSchema,
  saveSupplierSchema, voidExpenseSchema, voidPurchaseSchema, type Role,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";
import { actorName } from "../lib/actors";
import { pad, readCounter } from "../lib/counters";

const BUYERS: Role[] = ["admin", "manager", "warehouse"];
const FINANCE: Role[] = ["admin", "manager"];

export const saveSupplier = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, BUYERS);
  const { supplierId, ...input } = parseInput(saveSupplierSchema, request.data);
  const tid = caller.tid;
  const data = {
    ...input,
    searchKeywords: buildSearchKeywords([input.name, input.contactName, input.rtn, input.phone]),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };
  if (supplierId) {
    const ref = db.doc(`${financeCol.suppliers(tid)}/${supplierId}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "El proveedor no existe.");
    await ref.update(data);
    return { supplierId };
  }
  const ref = db.collection(financeCol.suppliers(tid)).doc();
  await ref.set({ ...data, balanceDue: 0, createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
  return { supplierId: ref.id };
});

/**
 * Registra una compra a proveedor. Las líneas enlazadas a productos entran al inventario con su costo
 * (costo promedio ponderado). Lo no pagado queda como cuenta por pagar.
 */
export const createPurchase = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, BUYERS);
  const input = parseInput(createPurchaseSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const supplierRef = db.doc(`${financeCol.suppliers(tid)}/${input.supplierId}`);
  const purchaseRef = db.collection(financeCol.purchases(tid)).doc();

  const items = input.items.map((it) => ({
    productId: it.productId ?? null, description: it.description, qty: it.qty, unitCost: it.unitCost,
    lineTotal: Math.round(it.qty * it.unitCost),
  }));
  const subtotal = items.reduce((a, it) => a + it.lineTotal, 0);
  const total = subtotal + input.tax;
  const payAmount = input.payment?.amount ?? 0;
  if (payAmount > 0 && !FINANCE.includes(caller.role)) throw new HttpsError("permission-denied", "Solo administración o gerencia puede registrar pagos a proveedores.");
  if (payAmount > total) throw new HttpsError("invalid-argument", "El pago no puede ser mayor al total de la compra.");

  // Cantidades por producto (una compra puede traer el mismo producto en dos líneas)
  const byProduct = new Map<string, { qty: number; cost: number }>();
  for (const it of items) {
    if (!it.productId) continue;
    const prev = byProduct.get(it.productId) ?? { qty: 0, cost: 0 };
    byProduct.set(it.productId, { qty: prev.qty + it.qty, cost: prev.cost + it.lineTotal });
  }

  return db.runTransaction(async (tx) => {
    const supplier = await tx.get(supplierRef);
    if (!supplier.exists) throw new HttpsError("not-found", "El proveedor no existe.");
    const productIds = [...byProduct.keys()];
    const prods = await Promise.all(productIds.map((id) => tx.get(db.doc(`${catalogCol.products(tid)}/${id}`))));
    const costs = await Promise.all(productIds.map((id) => tx.get(db.doc(`${catalogCol.productCosts(tid)}/${id}`))));
    const counter = await readCounter(tx, tid, "purchases");
    const payCounter = payAmount > 0 ? await readCounter(tx, tid, "supplierPayments") : null;
    prods.forEach((p) => { if (!p.exists) throw new HttpsError("not-found", "Uno de los productos ya no existe."); });

    const code = `CMP-${pad(counter.next)}`;
    tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });

    prods.forEach((p, i) => {
      const { qty, cost } = byProduct.get(p.id)!;
      const unitCost = Math.round(cost / qty);
      const before = Number(p.get("stock") ?? 0);
      const after = before + qty;
      const prevAvg = Number(costs[i]!.get("avgCost") ?? costs[i]!.get("cost") ?? 0);
      const avg = after > 0 ? Math.round((Math.max(before, 0) * prevAvg + qty * unitCost) / after) : unitCost;
      tx.update(p.ref, { stock: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      tx.set(costs[i]!.ref, { cost: unitCost, lastPurchaseCost: unitCost, avgCost: avg, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection(catalogCol.movements(tid)).doc(), {
        productId: p.id, productName: p.get("name"), sku: p.get("sku") ?? "", type: "in", qty, unitCost,
        stockBefore: before, stockAfter: after, reason: `Compra ${code} · ${supplier.get("name")}${input.invoiceNumber ? ` · Fact. ${input.invoiceNumber}` : ""}`,
        orderId: null, orderCode: null, saleId: null, saleCode: null, purchaseId: purchaseRef.id, purchaseCode: code,
        by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
      });
    });

    const balance = total - payAmount;
    tx.set(purchaseRef, {
      number: counter.next, code, supplierId: supplier.id, supplierName: supplier.get("name"),
      invoiceNumber: input.invoiceNumber, date: Timestamp.fromMillis(input.date),
      dueDate: input.dueDate != null ? Timestamp.fromMillis(input.dueDate) : null,
      items, subtotal, tax: input.tax, total, paid: payAmount, balance,
      status: balance <= 0 ? "paid" : payAmount > 0 ? "partial" : "pending",
      notes: input.notes, voidReason: "",
      createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    tx.update(supplierRef, { balanceDue: FieldValue.increment(balance), lastPurchaseAt: FieldValue.serverTimestamp() });
    if (payCounter && input.payment) {
      tx.set(payCounter.ref, { next: payCounter.next + 1 }, { merge: true });
      tx.set(db.collection(financeCol.supplierPayments(tid)).doc(), {
        number: payCounter.next, code: `PP-${pad(payCounter.next)}`, supplierId: supplier.id, supplierName: supplier.get("name"),
        purchaseId: purchaseRef.id, purchaseCode: code, amount: payAmount, method: input.payment.method, reference: input.payment.reference,
        status: "valid", by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
      });
    }
    return { purchaseId: purchaseRef.id, code, balance };
  });
});

/** Pago o abono a una compra (cuenta por pagar). */
export const paySupplier = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(paySupplierSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const purchaseRef = db.doc(`${financeCol.purchases(tid)}/${input.purchaseId}`);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(purchaseRef);
    if (!p.exists) throw new HttpsError("not-found", "La compra no existe.");
    if (p.get("status") === "voided") throw new HttpsError("failed-precondition", "La compra está anulada.");
    const balance = Number(p.get("balance") ?? 0);
    if (input.amount > balance) throw new HttpsError("failed-precondition", `El monto supera el saldo (${formatMoney(balance)}).`);
    const counter = await readCounter(tx, tid, "supplierPayments");
    const code = `PP-${pad(counter.next)}`;
    tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });
    const newBalance = balance - input.amount;
    tx.update(purchaseRef, {
      paid: Number(p.get("paid") ?? 0) + input.amount, balance: newBalance, status: newBalance <= 0 ? "paid" : "partial",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
    });
    tx.update(db.doc(`${financeCol.suppliers(tid)}/${p.get("supplierId")}`), { balanceDue: FieldValue.increment(-input.amount) });
    tx.set(db.collection(financeCol.supplierPayments(tid)).doc(), {
      number: counter.next, code, supplierId: p.get("supplierId"), supplierName: p.get("supplierName"),
      purchaseId: p.id, purchaseCode: p.get("code"), amount: input.amount, method: input.method, reference: input.reference,
      status: "valid", by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
    });
    return { code, balance: newBalance };
  });
});

/**
 * Anula una compra sin pagos. Revierte la entrada al inventario (si todavía hay existencia suficiente).
 */
export const voidPurchase = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(voidPurchaseSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const purchaseRef = db.doc(`${financeCol.purchases(tid)}/${input.purchaseId}`);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(purchaseRef);
    if (!p.exists) throw new HttpsError("not-found", "La compra no existe.");
    if (p.get("status") === "voided") throw new HttpsError("failed-precondition", "La compra ya está anulada.");
    if (Number(p.get("paid") ?? 0) > 0) throw new HttpsError("failed-precondition", "La compra tiene pagos registrados. No se puede anular.");
    const items = (p.get("items") as Array<{ productId: string | null; qty: number }>) ?? [];
    const byProduct = new Map<string, number>();
    items.forEach((it) => it.productId && byProduct.set(it.productId, (byProduct.get(it.productId) ?? 0) + it.qty));
    const prods = await Promise.all([...byProduct.keys()].map((id) => tx.get(db.doc(`${catalogCol.products(tid)}/${id}`))));
    for (const prod of prods) {
      if (!prod.exists) continue;
      const qty = byProduct.get(prod.id)!;
      const before = Number(prod.get("stock") ?? 0);
      if (before < qty) throw new HttpsError("failed-precondition", `No se puede anular: ${prod.get("name")} ya se usó (hay ${before}, la compra trajo ${qty}).`);
    }
    for (const prod of prods) {
      if (!prod.exists) continue;
      const qty = byProduct.get(prod.id)!;
      const before = Number(prod.get("stock") ?? 0);
      tx.update(prod.ref, { stock: before - qty, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
      tx.set(db.collection(catalogCol.movements(tid)).doc(), {
        productId: prod.id, productName: prod.get("name"), sku: prod.get("sku") ?? "", type: "out", qty, unitCost: 0,
        stockBefore: before, stockAfter: before - qty, reason: `Anulación de compra ${p.get("code")}: ${input.reason}`,
        orderId: null, orderCode: null, saleId: null, saleCode: null, purchaseId: p.id, purchaseCode: p.get("code"),
        by: caller.uid, byName: name, at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(purchaseRef, { status: "voided", voidReason: input.reason, balance: 0, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    tx.update(db.doc(`${financeCol.suppliers(tid)}/${p.get("supplierId")}`), { balanceDue: FieldValue.increment(-Number(p.get("balance") ?? 0)) });
    return { ok: true };
  });
});

/** Registra o edita un gasto. El comprobante se sube antes a Storage y aquí se guarda su ruta. */
export const saveExpense = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(saveExpenseSchema, request.data);
  const tid = caller.tid;
  if (input.receiptPath && !input.receiptPath.startsWith(`tenants/${tid}/expenses/`)) throw new HttpsError("invalid-argument", "Comprobante no válido.");
  const supplier = input.supplierId ? await db.doc(`${financeCol.suppliers(tid)}/${input.supplierId}`).get() : null;
  if (supplier && !supplier.exists) throw new HttpsError("not-found", "El proveedor no existe.");
  const data = {
    category: input.category, description: input.description, amount: input.amount, date: Timestamp.fromMillis(input.date),
    method: input.method, reference: input.reference,
    supplierId: input.supplierId ?? null, supplierName: supplier?.exists ? (supplier.get("name") as string) : "",
    receiptPath: input.receiptPath ?? null,
    receiptType: input.receiptPath ? (input.receiptPath.endsWith(".pdf") ? "application/pdf" : "image") : null,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid,
  };
  if (input.expenseId) {
    const ref = db.doc(`${financeCol.expenses(tid)}/${input.expenseId}`);
    const e = await ref.get();
    if (!e.exists) throw new HttpsError("not-found", "El gasto no existe.");
    if (e.get("status") === "voided") throw new HttpsError("failed-precondition", "El gasto está anulado.");
    await ref.update(data);
    return { expenseId: ref.id, code: e.get("code") as string };
  }
  const ref = db.collection(financeCol.expenses(tid)).doc();
  const code = await db.runTransaction(async (tx) => {
    const counter = await readCounter(tx, tid, "expenses");
    const c = `GAS-${pad(counter.next)}`;
    tx.set(counter.ref, { next: counter.next + 1 }, { merge: true });
    tx.set(ref, { ...data, number: counter.next, code: c, status: "valid", voidReason: "", createdAt: FieldValue.serverTimestamp(), createdBy: caller.uid });
    return c;
  });
  return { expenseId: ref.id, code };
});

export const voidExpense = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, FINANCE);
  const input = parseInput(voidExpenseSchema, request.data);
  const ref = db.doc(`${financeCol.expenses(caller.tid)}/${input.expenseId}`);
  const e = await ref.get();
  if (!e.exists) throw new HttpsError("not-found", "El gasto no existe.");
  await ref.update({ status: "voided", voidReason: input.reason, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  return { ok: true };
});
