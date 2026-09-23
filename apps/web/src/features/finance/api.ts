import { collection, doc, limit, orderBy, query, Timestamp, where, type QueryConstraint } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import {
  catalogCol, financeCol, financeStoragePath, hnDayKey, orderCol, searchToken,
  type CreatePurchaseInput, type Expense, type ManualPaymentMethod, type Purchase, type Sale, type SaveExpenseInput,
  type SaveSupplierInput, type Supplier, type SupplierPayment, type WorkOrder,
} from "@rapifix/shared";
import { callable, db, storage, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { newId, uploadImage } from "@/lib/storage";

const suppliersCol = () => collection(db, financeCol.suppliers(TENANT_ID));
const purchasesCol = () => collection(db, financeCol.purchases(TENANT_ID));
const supplierPaymentsCol = () => collection(db, financeCol.supplierPayments(TENANT_ID));
const expensesCol = () => collection(db, financeCol.expenses(TENANT_ID));

// ---------- Functions ----------
export const saveSupplier = callable<SaveSupplierInput, { supplierId: string }>("saveSupplier");
export const createPurchase = callable<CreatePurchaseInput, { purchaseId: string; code: string; balance: number }>("createPurchase");
export const paySupplier = callable<{ purchaseId: string; amount: number; method: ManualPaymentMethod; reference: string }, { code: string; balance: number }>("paySupplier");
export const voidPurchase = callable<{ purchaseId: string; reason: string }, { ok: boolean }>("voidPurchase");
export const saveExpense = callable<SaveExpenseInput, { expenseId: string; code: string }>("saveExpense");
export const voidExpense = callable<{ expenseId: string; reason: string }, { ok: boolean }>("voidExpense");

// ---------- Fechas (hora de Honduras, UTC-6 sin horario de verano) ----------
const HN_OFFSET = 6 * 3600 * 1000;

/** "YYYY-MM-DD" -> epoch ms. Hoy usa la hora actual; otros días, mediodía de Honduras. */
export function dayKeyToMs(key: string): number {
  if (key === hnDayKey(Date.now())) return Date.now();
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, 12) + HN_OFFSET;
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Mes "YYYY-MM" -> [inicio, fin) en hora de Honduras */
export function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number);
  return [new Date(Date.UTC(y!, m! - 1, 1) + HN_OFFSET), new Date(Date.UTC(y!, m!, 1) + HN_OFFSET)];
}

export const currentMonth = () => hnDayKey(Date.now()).slice(0, 7);

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const s = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, 15)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + delta, 1)).toISOString().slice(0, 7);
}

// ---------- Proveedores ----------
export const supplierRef = (id: string) => doc(db, financeCol.suppliers(TENANT_ID), id);

/** Sin índices compuestos: búsqueda por palabra clave o lista por nombre; el filtro de activos es local. */
export function useSuppliers(search: string, showInactive: boolean) {
  const token = searchToken(search);
  const c: QueryConstraint[] = token.length >= 2 ? [where("searchKeywords", "array-contains", token), limit(200)] : [orderBy("name"), limit(500)];
  const state = useQueryData<Supplier>(query(suppliersCol(), ...c), `suppliers|${token.length >= 2 ? token : ""}`);
  const data = state.data
    .filter((s) => showInactive || s.active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { ...state, data };
}

export function useActiveSuppliers() {
  const state = useQueryData<Supplier>(query(suppliersCol(), orderBy("name"), limit(500)), "suppliers|");
  return { ...state, data: state.data.filter((s) => s.active) };
}

export function useSupplier(id: string | undefined) {
  return useDocData<Supplier>(id ? supplierRef(id) : null, `supplier-${id}`);
}

export function useSupplierPurchases(supplierId: string | undefined) {
  return useQueryData<Purchase>(supplierId ? query(purchasesCol(), where("supplierId", "==", supplierId), orderBy("date", "desc"), limit(200)) : null, `purchases-supplier-${supplierId}`);
}

export function useSupplierPayments(opts: { supplierId?: string; purchaseId?: string }) {
  const c: QueryConstraint[] | null = opts.supplierId ? [where("supplierId", "==", opts.supplierId)] : opts.purchaseId ? [where("purchaseId", "==", opts.purchaseId)] : null;
  return useQueryData<SupplierPayment>(c ? query(supplierPaymentsCol(), ...c, orderBy("at", "desc"), limit(200)) : null, `supplierPayments-${opts.supplierId ?? ""}-${opts.purchaseId ?? ""}`);
}

// ---------- Compras ----------
export type PurchaseFilter = "due" | "all" | "voided";

export function usePurchases(filter: PurchaseFilter, month: string) {
  let q;
  if (filter === "due") q = query(purchasesCol(), where("status", "in", ["pending", "partial"]), orderBy("dueDate"), limit(500));
  else if (filter === "voided") q = query(purchasesCol(), where("status", "==", "voided"), limit(300));
  else {
    const [start, end] = monthRange(month);
    q = query(purchasesCol(), where("date", ">=", Timestamp.fromDate(start)), where("date", "<", Timestamp.fromDate(end)), orderBy("date", "desc"), limit(500));
  }
  const state = useQueryData<Purchase>(q, `purchases-${filter}-${filter === "all" ? month : ""}`);
  const data = filter === "voided" ? [...state.data].sort((a, b) => (b.date?.toMillis?.() ?? 0) - (a.date?.toMillis?.() ?? 0)) : state.data;
  return { ...state, data };
}

export function useOpenPurchases() {
  return useQueryData<Purchase>(query(purchasesCol(), where("status", "in", ["pending", "partial"]), orderBy("dueDate"), limit(500)), "purchases-due-");
}

export function isOverdue(p: Pick<Purchase, "dueDate" | "balance" | "status">): boolean {
  if (p.status === "voided" || p.balance <= 0 || !p.dueDate?.toMillis) return false;
  return hnDayKey(p.dueDate.toMillis()) < hnDayKey(Date.now());
}

// ---------- Gastos ----------
export function useExpenses(month: string) {
  const [start, end] = monthRange(month);
  return useQueryData<Expense>(
    query(expensesCol(), where("date", ">=", Timestamp.fromDate(start)), where("date", "<", Timestamp.fromDate(end)), orderBy("date", "desc"), limit(1000)),
    `expenses-${month}`,
  );
}

export const MAX_RECEIPT_MB = 10;

/** Sube el comprobante (imagen comprimida o PDF) y devuelve su ruta en Storage. */
export async function uploadExpenseReceipt(file: File, onProgress?: (pct: number) => void): Promise<string> {
  if (file.size > MAX_RECEIPT_MB * 1024 * 1024) throw new Error(`El archivo supera ${MAX_RECEIPT_MB} MB.`);
  const id = newId();
  if (file.type === "application/pdf") {
    const path = financeStoragePath.expenseReceipt(TENANT_ID, id, "pdf");
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: "application/pdf" });
    await new Promise<void>((resolve, reject) => {
      task.on("state_changed", (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, () => resolve());
    });
    return path;
  }
  if (file.type.startsWith("image/")) {
    const path = financeStoragePath.expenseReceipt(TENANT_ID, id, "jpg");
    await uploadImage(file, path, onProgress); // comprime y sube como image/jpeg
    return path;
  }
  throw new Error("El comprobante debe ser una foto o un PDF.");
}

export async function openReceipt(path: string) {
  const w = window.open("", "_blank");
  try {
    const url = await getDownloadURL(ref(storage, path));
    if (w) w.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (err) {
    w?.close();
    throw err;
  }
}

// ---------- Cuentas por cobrar ----------
export function useReceivableOrders() {
  const state = useQueryData<WorkOrder>(query(collection(db, orderCol.workOrders(TENANT_ID)), where("balance", ">", 0), orderBy("balance", "desc"), limit(500)), "receivables-orders");
  return { ...state, data: state.data.filter((o) => o.status !== "CANCELLED") };
}

export function useReceivableSales(enabled: boolean) {
  return useQueryData<Sale>(enabled ? query(collection(db, catalogCol.sales(TENANT_ID)), where("balance", ">", 0), orderBy("balance", "desc"), limit(500)) : null, `receivables-sales-${enabled}`);
}
