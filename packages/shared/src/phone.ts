/**
 * Normaliza teléfonos de Honduras al formato E.164 (+504XXXXXXXX).
 * Acepta "9999-9999", "504 9999 9999", "+50499999999". Otros países se dejan con +.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 8) return `+504${digits}`;
  if (digits.length === 11 && digits.startsWith("504")) return `+${digits}`;
  return `+${digits}`;
}

/** +50499998888 -> 9999-8888 (formato local para mostrar) */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("504")) {
    return `${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return value;
}

/**
 * Link de WhatsApp con texto (fallback manual). Se usa api.whatsapp.com/send en lugar de
 * wa.me porque la redirección de wa.me daña los emojis del mensaje.
 */
export function whatsappLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  const base = `https://api.whatsapp.com/send?phone=${digits}`;
  return text ? `${base}&text=${encodeURIComponent(text.normalize("NFC"))}` : base;
}

export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 8 || (digits.length >= 10 && digits.length <= 15);
}
