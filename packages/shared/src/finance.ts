import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "./catalog";

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const id = z.string().min(1).max(128);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);

// ---------------- Proveedores ----------------
export interface Supplier extends BaseDoc {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  rtn: string;
  categories: string;
  address: string;
  notes: string;
  creditDays: number;
  active: boolean;
  balanceDue: number; // centavos, lo mantiene el servidor
  searchKeywords: string[];
}

export const saveSupplierSchema = z.object({
  supplierId: id.nullish(),
  name: text(120).min(2, "El nombre es obligatorio"),
  contactName: text(80),
  phone: text(30),
  email: text(120),
  rtn: text(20),
  categories: text(200),
  address: text(250),
  notes: text(1000),
  creditDays: z.number().int().min(0).max(365),
  active: z.boolean(),
});
export type SaveSupplierInput = z.infer<typeof saveSupplierSchema>;

// ---------------- Compras (cuentas por pagar) ----------------
export interface PurchaseItem {
  productId: string | null; // si viene del inventario, entra a existencias
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export const PURCHASE_STATUSES = ["pending", "partial", "paid", "voided"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "Por pagar",
  partial: "Abonada",
  paid: "Pagada",
  voided: "Anulada",
};

export interface Purchase extends BaseDoc {
  number: number;
  code: string; // CMP-0001
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  date: TimestampLike;
  dueDate: TimestampLike | null;
  items: PurchaseItem[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  status: PurchaseStatus;
  notes: string;
  voidReason: string;
}

export const createPurchaseSchema = z.object({
  supplierId: id,
  invoiceNumber: text(40),
  date: z.number().int().min(0),
  dueDate: z.number().int().min(0).nullish(),
  items: z.array(z.object({
    productId: id.nullish(),
    description: text(160).min(1, "Describa cada línea"),
    qty: z.number().positive("Cantidad no válida").max(1_000_000),
    unitCost: cents,
  })).min(1, "Agregue al menos una línea").max(100),
  tax: cents,
  notes: text(1000),
  /** pago al contado o abono inicial (opcional) */
  payment: z.object({ amount: cents, method: z.enum(MANUAL_PAYMENT_METHODS), reference: text(80) }).nullish(),
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export interface SupplierPayment {
  id: string;
  number: number;
  code: string; // PP-0001
  supplierId: string;
  supplierName: string;
  purchaseId: string;
  purchaseCode: string;
  amount: number;
  method: ManualPaymentMethod;
  reference: string;
  status: "valid" | "voided";
  by: string;
  byName: string;
  at: TimestampLike;
}

export const paySupplierSchema = z.object({
  purchaseId: id,
  amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: text(80),
});

export const voidPurchaseSchema = z.object({ purchaseId: id, reason: text(300).min(3, "Indique el motivo") });

// ---------------- Gastos ----------------
export const EXPENSE_CATEGORIES = [
  "Alquiler", "Energía y agua", "Internet y teléfono", "Salarios", "Herramientas", "Insumos del taller",
  "Mantenimiento del local", "Publicidad", "Combustible y transporte", "Impuestos y permisos", "Servicios profesionales",
  "Bancos y comisiones", "Otros",
] as const;

export interface Expense extends BaseDoc {
  number: number;
  code: string; // GAS-0001
  category: string;
  description: string;
  amount: number;
  date: TimestampLike;
  method: ManualPaymentMethod;
  reference: string;
  supplierId: string | null;
  supplierName: string;
  receiptPath: string | null; // Storage (imagen o PDF)
  receiptType: string | null;
  status: "valid" | "voided";
  voidReason: string;
}

export const saveExpenseSchema = z.object({
  expenseId: id.nullish(),
  category: text(60).min(1, "Seleccione la categoría"),
  description: text(300).min(2, "Describa el gasto"),
  amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  date: z.number().int().min(0),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: text(80),
  supplierId: id.nullish(),
  receiptPath: z.string().max(300).regex(/^tenants\/[a-z0-9-]+\/expenses\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/, "Comprobante no válido").nullish(),
});
export type SaveExpenseInput = z.infer<typeof saveExpenseSchema>;

export const voidExpenseSchema = z.object({ expenseId: id, reason: text(300).min(3, "Indique el motivo") });
