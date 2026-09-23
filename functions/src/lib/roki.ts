import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "firebase-functions/v2";
import { HttpsError } from "firebase-functions/v2/https";
import { catalogCol } from "@rapifix/shared";
import { db } from "./admin";

/**
 * Cliente mínimo de ROKI Connect (API v2, verificado con el MCP oficial de ROKI).
 * - La llave secreta se lee en tiempo de ejecución de tenants/{tid}/private/roki (nunca del código).
 * - Los montos van en unidades decimales (150.50 = L 150.50), nunca centavos.
 * - El ambiente lo define el prefijo de la llave: sk_test_ (sandbox) / sk_live_ (producción).
 */
export const ROKI_BASE_URL = "https://aura.roki.systems/api/connect/v1";

export interface RokiConfig {
  enabled: boolean;
  serviceFee: boolean;
  secretKey: string;
  webhookSecret: string;
}

export async function getRokiConfig(tid: string): Promise<RokiConfig | null> {
  const snap = await db.doc(`${catalogCol.privateConfig(tid)}/roki`).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return { enabled: !!d.enabled, serviceFee: !!d.serviceFee, secretKey: d.secretKey ?? "", webhookSecret: d.webhookSecret ?? "" };
}

export interface RokiPayment {
  id: number;
  status: "pending" | "paid" | "partially_refunded" | "refunded" | "voided" | "expired" | "disabled";
  amount: number;
  subtotal: number;
  total: number;
  service_fee_amount?: number;
  currency_iso: string;
  external_reference: string;
  metadata: Record<string, string> | unknown[];
  checkout_url: string;
  transaction_id: string | null;
  paid_at: string | null;
  warnings?: string[];
}

export async function rokiRequest<T>(
  secretKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${ROKI_BASE_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
        "Accept-Language": "es",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      logger.error("ROKI error", { status: res.status, code: json?.code, message: json?.message, errors: json?.errors, path });
      if (res.status === 401) throw new HttpsError("failed-precondition", "La llave de ROKI no es válida. Revise la configuración de pagos en línea.");
      if (res.status === 422) throw new HttpsError("invalid-argument", `ROKI rechazó el cobro: ${json?.message ?? "datos no válidos"}`);
      throw new HttpsError("unavailable", "La pasarela de pagos no respondió. Intente de nuevo en un momento.");
    }
    // La API ignora campos desconocidos y los reporta aquí: si aparece algo, hay un nombre mal escrito.
    if (Array.isArray(json?.warnings) && json.warnings.length) logger.warn("ROKI warnings", { path, warnings: json.warnings });
    return json as T;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("ROKI network error", { path, err: String(err) });
    throw new HttpsError("unavailable", "No se pudo contactar la pasarela de pagos. Intente de nuevo.");
  } finally {
    clearTimeout(timer);
  }
}

/** Fecha en hora de Honduras (UTC-6, sin horario de verano) con el formato que pide ROKI. */
export function hondurasTime(d: Date): string {
  const hn = new Date(d.getTime() - 6 * 3600 * 1000);
  return hn.toISOString().replace("T", " ").slice(0, 19);
}

export const toDecimal = (cents: number) => Math.round(cents) / 100;
export const toCents = (amount: number) => Math.round(Number(amount) * 100);

/**
 * Verifica ROKI-Signature: t={timestamp},v1={hex}. HMAC-SHA256 sobre `timestamp + "." + cuerpo crudo`,
 * comparado en tiempo constante. (Doc oficial de ROKI, sección 14.4.)
 */
export function verifyRokiSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^[0-9a-fA-F]+$/.test(v1)) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
