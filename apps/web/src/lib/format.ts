import type { TimestampLike } from "@rapifix/shared";

export function toDate(value: TimestampLike | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  return typeof value.toDate === "function" ? value.toDate() : null;
}

export function formatDate(value: TimestampLike | Date | null | undefined, withTime = false): string {
  const d = toDate(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("es-HN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

export function formatRelative(value: TimestampLike | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  return formatDate(d);
}

export const formatKm = (km: number) => `${new Intl.NumberFormat("es-HN").format(km)} km`;

/** ABC123 -> ABC-123 para mostrar */
export function formatPlate(plate: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(plate);
  return m ? `${m[1]}-${m[2]}` : plate;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
