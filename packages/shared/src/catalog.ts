import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import type { Totals } from "./quote";

// ---------------- Catálogo ----------------
export const PRODUCT_UNITS = ["unidad", "juego", "litro", "galón", "metro", "kit", "caja"] as const;

export interface Product extends BaseDoc {
  sku: string;
  name: string;
  category: string;
  brand: string;
  supplier: string;
  unit: string;
  price: number; // centavos
  stock: number; // lo cambia solo el servidor (movimientos)
  minStock: number;
  location: string;
  taxable: boolean;
  active: boolean;
  searchKeywords: string[];
}

/** Costo en documento aparte: técnicos y vendedores no pueden leerlo. */
export interface ProductCost {
  cost: number;
  avgCost: number;
  lastPurchaseCost: number;
  updatedAt?: TimestampLike;
}

export interface Service extends BaseDoc {
  code: string;
  name: string;
  category: string;
  price: number;
  estimatedHours: number;
  taxable: boolean;
  active: boolean;
  /** Mantenimiento recomendado: cada cuántos días / km (0 = no genera recordatorio) */
  intervalDays?: number;
  intervalKm?: number;
  searchKeywords: string[];
}

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const cents = z.number().int().min(0, "Monto no válido").max(100_000_000_00);

export const productSchema = z.object({
  sku: text(40),
  name: text(120).min(2, "El nombre es obligatorio"),
  category: text(60),
  brand: text(60),
  supplier: text(80),
  unit: text(20).min(1),
  price: cents,
  minStock: z.number({ error: "Cantidad no válida" }).min(0).max(100000),
  location: text(60),
  taxable: z.boolean(),
  active: z.boolean(),
});
export type ProductInput = z.infer<typeof productSchema>;

export const serviceSchema = z.object({
  code: text(30),
  name: text(120).min(2, "El nombre es obligatorio"),
  category: text(60),
  price: cents,
  estimatedHours: z.number({ error: "Horas no válidas" }).min(0).max(500),
  taxable: z.boolean(),
  active: z.boolean(),
  intervalDays: z.number({ error: "Días no válidos" }).int().min(0).max(3650),
  intervalKm: z.number({ error: "Kilómetros no válidos" }).int().min(0).max(500_000),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

// ---------------- Inventario ----------------
export const MOVEMENT_TYPES = ["in", "out", "adjust", "return"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: "Entrada (compra)",
  out: "Salida",
  adjust: "Ajuste por conteo",
  return: "Devolución",
};

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  type: MovementType;
  qty: number;
  unitCost: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  orderId: string | null;
  orderCode: string | null;
  saleId: string | null;
  saleCode: string | null;
  by: string;
  byName: string;
  at: TimestampLike;
}

export const movementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(MOVEMENT_TYPES),
  /** entrada/salida/devolución: cantidad. ajuste: existencia contada. */
  qty: z.number().min(0).max(1_000_000),
  unitCost: cents.nullish(),
  reason: text(300),
});
export type MovementInput = z.infer<typeof movementSchema>;

export const consumePartSchema = z.object({
  orderId: z.string().min(1),
  quoteId: z.string().min(1),
  itemId: z.string().min(1),
});

// ---------------- Pagos ----------------
export const PAYMENT_METHODS = ["cash", "transfer", "card", "other", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Métodos que el personal registra a mano ("online" solo lo registra la pasarela). */
export const MANUAL_PAYMENT_METHODS = ["cash", "transfer", "card", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
  online: "En línea (ROKI)",
};

export interface Payment {
  id: string;
  number: number;
  code: string; // REC-0001
  amount: number;
  method: PaymentMethod;
  reference: string;
  status: "valid" | "voided";
  voidReason: string;
  customerId: string | null;
  customerName: string;
  orderId: string | null;
  orderCode: string | null;
  saleId: string | null;
  saleCode: string | null;
  receivedBy: string;
  receivedByName: string;
  at: TimestampLike;
  voidedAt?: TimestampLike | null;
  voidedBy?: string | null;
}

const paymentLine = z.object({
  amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: text(80),
});

export const registerPaymentSchema = paymentLine.extend({
  orderId: z.string().nullish(),
  saleId: z.string().nullish(),
});
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;

export const voidPaymentSchema = z.object({ paymentId: z.string().min(1), reason: text(300).min(3, "Indique el motivo") });

// ---------------- Punto de venta ----------------
export const SALE_ITEM_KINDS = ["product", "service", "other"] as const;
export type SaleItemKind = (typeof SALE_ITEM_KINDS)[number];

export interface SaleItem {
  id: string;
  kind: SaleItemKind;
  refId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  discount: number;
  taxable: boolean;
  lineTotal: number;
}

export interface Sale {
  id: string;
  number: number;
  code: string; // V-0001
  customerId: string | null;
  customerName: string;
  vehicleId: string | null;
  vehicleLabel: string;
  items: SaleItem[];
  taxRate: number;
  totals: Totals;
  paid: number;
  balance: number;
  status: "paid" | "partial";
  by: string;
  byName: string;
  at: TimestampLike;
}

export const createSaleSchema = z.object({
  customerId: z.string().nullish(),
  vehicleId: z.string().nullish(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        kind: z.enum(SALE_ITEM_KINDS),
        refId: z.string().nullish(),
        description: text(200).min(1, "Cada línea necesita descripción"),
        qty: z.number().positive("La cantidad debe ser mayor a 0").max(10_000),
        unitPrice: cents,
        discount: cents,
        taxable: z.boolean(),
      }),
    )
    .min(1, "Agregue al menos un producto o servicio")
    .max(100),
  payments: z.array(paymentLine).max(5),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

// ---------------- Pagos en línea (ROKI) ----------------
export interface OnlinePayment {
  id: string;
  orderId: string;
  orderCode: string;
  amount: number; // centavos
  status: "creating" | "pending" | "paid" | "failed" | "expired" | "voided" | "refunded" | "error";
  rokiPaymentId: number | null;
  transactionId: string | null;
  checkoutUrl: string;
  serviceFee: number; // centavos cobrados por ROKI al cliente
  paymentId: string | null; // pago registrado en RAPIFIX
  error: string;
  createdAt: TimestampLike;
  paidAt?: TimestampLike | null;
}

export const onlinePayStartSchema = z.object({
  token: z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido"),
  origin: z.string().url().max(200),
});

export const onlinePayConfigSchema = z.object({
  enabled: z.boolean(),
  serviceFee: z.boolean(),
  secretKey: z.string().trim().regex(/^sk_(test|live)_[A-Za-z0-9_\-]{8,}$/, "La llave secreta debe empezar con sk_test_ o sk_live_").nullish(),
  webhookSecret: z.string().trim().min(8, "Secreto de webhook no válido").max(300).nullish(),
});
export type OnlinePayConfigInput = z.infer<typeof onlinePayConfigSchema>;

export interface OnlinePayConfigStatus {
  enabled: boolean;
  serviceFee: boolean;
  environment: "test" | "live" | null;
  keyLast4: string;
  hasWebhookSecret: boolean;
  webhookUrl: string;
  lastEventAt: TimestampLike | null;
}

// ---------------- Carga masiva de productos (Excel) ----------------
export const importProductRowSchema = z.object({
  /** fila del Excel (para mostrar errores) */
  row: z.number().int().min(1).max(100000),
  sku: text(40),
  name: text(120).min(2, "El nombre es obligatorio"),
  category: text(60),
  brand: text(60),
  supplier: text(80),
  unit: text(20).min(1),
  price: cents,
  cost: cents.nullish(),
  stock: z.number().min(0).max(1_000_000).nullish(),
  minStock: z.number().min(0).max(100000),
  location: text(60),
  taxable: z.boolean(),
  active: z.boolean(),
});
export type ImportProductRow = z.infer<typeof importProductRowSchema>;

export const importProductsSchema = z.object({
  rows: z.array(importProductRowSchema).min(1).max(200),
  /** productos que ya existen: ajustar la existencia a la del Excel (ajuste por conteo) */
  updateStock: z.boolean(),
});
export type ImportProductsInput = z.infer<typeof importProductsSchema>;
