/** Todo el dinero se guarda en centavos (enteros) para evitar errores de redondeo. */
export type Money = number;

export const toCents = (lempiras: number): Money => Math.round(lempiras * 100);
export const fromCents = (cents: Money): number => cents / 100;

export function formatMoney(cents: Money, currency = "HNL"): string {
  const value = fromCents(cents);
  const formatted = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return currency === "HNL" ? `L ${formatted}` : `${currency} ${formatted}`;
}
