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
export const PAYMENT_METHODS = ["cash", "card", "transfer", "deposit", "other", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Métodos que el personal registra a mano ("online" solo lo registra la pasarela). */
export const MANUAL_PAYMENT_METHODS = ["cash", "card", "transfer", "deposit", "other"] as const;
/** Métodos donde se indica el banco y se puede subir comprobante */
export const BANK_METHODS: readonly PaymentMethod[] = ["transfer", "deposit"];
export const methodNeedsBank = (m: string) => m === "transfer" || m === "deposit";
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  deposit: "Depósito bancario",
  card: "Tarjeta (ROKI)",
  other: "Otro",
  online: "Link de pago (ROKI)",
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
  /** Transferencia/depósito: cuenta o banco donde entró el dinero. Tarjeta: terminal POS usado */
  bank?: string;
  /** Comprobante (foto o PDF) en Storage */
  receiptPath?: string | null;
  receiptType?: "image" | "pdf" | null;
  voidedAt?: TimestampLike | null;
  voidedBy?: string | null;
}

export const paymentReceiptPathRe = /^tenants\/[a-z0-9-]+\/paymentReceipts\/[A-Za-z0-9_-]+\.(jpg|png|webp|pdf)$/;
const paymentLine = z.object({
  amount: cents.refine((v) => v > 0, "El monto debe ser mayor a 0"),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: text(80),
  /** banco/cuenta (transferencia, depósito) o terminal (tarjeta) */
  bank: text(60).nullish(),
  receiptPath: z.string().max(300).regex(paymentReceiptPathRe, "Comprobante no válido").nullish(),
}).refine((p) => !methodNeedsBank(p.method) || !!p.bank?.trim(), { message: "Indique el banco o la cuenta donde entró el dinero", path: ["bank"] });

export const registerPaymentSchema = z.intersection(paymentLine, z.object({
  orderId: z.string().nullish(),
  saleId: z.string().nullish(),
}));
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;

/** Agregar o cambiar banco/comprobante de un pago ya registrado (p. ej. el depósito se confirma después). */
export const attachPaymentReceiptSchema = z.object({
  paymentId: z.string().min(1),
  bank: text(60).nullish(),
  receiptPath: z.string().max(300).regex(paymentReceiptPathRe, "Comprobante no válido").nullish(),
});
export type AttachPaymentReceiptInput = z.infer<typeof attachPaymentReceiptSchema>;
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
  status: "paid" | "partial" | "voided";
  voidReason?: string;
  /** Unidad de negocio. Sin valor = taller (mostrador). */
  unit?: BusinessUnit;
  /** Lavado del carwash que originó la venta. */
  washId?: string | null;
  by: string;
  byName: string;
  at: TimestampLike;
}

export const BUSINESS_UNITS = ["shop", "carwash"] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];
export const BUSINESS_UNIT_LABELS: Record<BusinessUnit, string> = { shop: "Taller", carwash: "Carwash" };

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
/** Qué se paga con el link: el saldo de una orden del taller o un lavado del carwash. */
export const ONLINE_PAY_TARGETS = ["order", "wash"] as const;
export type OnlinePayTarget = (typeof ONLINE_PAY_TARGETS)[number];

export interface OnlinePayment {
  id: string;
  /** sin valor = "order" (cobros creados antes de los lavados) */
  target?: OnlinePayTarget;
  orderId: string | null;
  orderCode: string | null;
  washId?: string | null;
  washCode?: string | null;
  /** el pago llegó pero algo no cuadró (lavado ya cobrado, cancelado o con otro total): revisar */
  needsReview?: boolean;
  reviewNote?: string;
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

const publicToken = z.string().regex(/^[2-9A-HJ-NP-Z]{10}$/, "Link no válido");

export const onlinePayStartSchema = z.object({
  token: publicToken,
  origin: z.string().url().max(200),
  /** link de una orden (portal) o de un lavado (/lavado/:token). Sin valor = orden. */
  kind: z.enum(ONLINE_PAY_TARGETS).nullish(),
});

export const onlinePayCheckSchema = z.object({ token: publicToken, kind: z.enum(ONLINE_PAY_TARGETS).nullish() });

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

export const voidSaleSchema = z.object({
  saleId: z.string().min(1),
  reason: text(300).min(3, "Indique el motivo"),
});

// ---------------- Comprobantes enviados por el cliente (link público) ----------------
export const PROOF_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];
export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = { pending: "Por revisar", approved: "Aprobado", rejected: "Rechazado" };
export const PROOF_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ProofContentType = (typeof PROOF_CONTENT_TYPES)[number];
export const PROOF_EXT: Record<ProofContentType, "jpg" | "png" | "webp" | "pdf"> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};
/** Tamaño máximo del archivo (ya decodificado) */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
/** Máximo de comprobantes por revisar a la vez por lavado u orden */
export const PROOF_MAX_PENDING = 3;
/** Métodos con que se aprueba un comprobante */
export const PROOF_METHODS = ["transfer", "deposit"] as const;

export interface PaymentProof {
  id: string;
  kind: OnlinePayTarget;
  washId: string | null;
  orderId: string | null;
  code: string;
  customerName: string;
  plate: string;
  amount: number;
  bank: string;
  reference: string;
  receiptPath: string;
  receiptType: "image" | "pdf";
  status: ProofStatus;
  createdAt: TimestampLike;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: TimestampLike | null;
  rejectReason: string;
  paymentId: string | null;
  /** método con que se registró al aprobarlo */
  method?: (typeof PROOF_METHODS)[number] | null;
}

/** Estado del último comprobante que ve el cliente en su link. */
export interface PublicProof {
  status: ProofStatus;
  amount: number;
  reason: string;
  /** epoch ms */
  at: number;
}

/** Tamaño en bytes de un texto base64 (sin decodificarlo). */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, "");
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/** Revisa los primeros bytes del archivo: que de verdad sea el tipo que dice ser. */
export function sniffProofType(bytes: Uint8Array): ProofContentType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "application/pdf";
  return null;
}

export const submitPaymentProofSchema = z.object({
  token: publicToken,
  kind: z.enum(ONLINE_PAY_TARGETS),
  bank: text(60).min(1, "Seleccione el banco"),
  reference: text(80),
  amount: cents.refine((v) => v > 0, "Indique el monto"),
  // 5 MB en base64 son unos 6.7 millones de caracteres
  fileBase64: z.string().min(16, "Adjunte la foto o el PDF del comprobante").max(7_000_000, "El archivo supera 5 MB"),
  contentType: z.enum(PROOF_CONTENT_TYPES, { error: "El comprobante debe ser una foto (JPG, PNG, WEBP) o un PDF" }),
});
export type SubmitPaymentProofInput = z.infer<typeof submitPaymentProofSchema>;

export const reviewPaymentProofSchema = z
  .object({
    proofId: z.string().min(1).max(128),
    action: z.enum(["approve", "reject"]),
    method: z.enum(PROOF_METHODS).nullish(),
    amount: cents.nullish(),
    reason: text(300).nullish(),
  })
  .refine((v) => v.action !== "reject" || (v.reason ?? "").trim().length >= 3, { message: "Indique el motivo del rechazo", path: ["reason"] })
  .refine((v) => v.action !== "approve" || v.amount == null || v.amount > 0, { message: "El monto debe ser mayor a 0", path: ["amount"] });
export type ReviewPaymentProofInput = z.infer<typeof reviewPaymentProofSchema>;
export interface ReviewPaymentProofResult {
  status: ProofStatus;
  paymentId: string | null;
  /** ya estaba revisado (no se hizo nada) */
  already: boolean;
}
