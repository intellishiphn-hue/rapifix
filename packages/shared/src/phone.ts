/**
 * Teléfonos en E.164 (+<código><número>). Honduras (+504) es el país por defecto:
 * sin país indicado, 8 dígitos se interpretan como número hondureño (compatibilidad).
 */

export interface PhoneCountry {
  /** código ISO 3166-1 alfa-2 */
  iso: string;
  name: string;
  /** código de país sin "+", ej. "504" */
  dial: string;
  /** largo mínimo y máximo del número nacional (sin el código) */
  min: number;
  max: number;
  /** prefijos de área que identifican al país cuando comparte código (+1) */
  areaCodes?: string[];
  /** prefijo troncal local que se quita al guardar (ej. "0" en Reino Unido) */
  trunk?: string;
}

const generic = { min: 6, max: 14 };

/** Países del selector, en el orden en que se muestran. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "HN", name: "Honduras", dial: "504", min: 8, max: 8 },
  { iso: "US", name: "Estados Unidos", dial: "1", min: 10, max: 10 },
  { iso: "CA", name: "Canadá", dial: "1", min: 10, max: 10 },
  { iso: "MX", name: "México", dial: "52", min: 10, max: 10 },
  { iso: "GT", name: "Guatemala", dial: "502", min: 8, max: 8 },
  { iso: "SV", name: "El Salvador", dial: "503", min: 8, max: 8 },
  { iso: "NI", name: "Nicaragua", dial: "505", min: 8, max: 8 },
  { iso: "CR", name: "Costa Rica", dial: "506", min: 8, max: 8 },
  { iso: "PA", name: "Panamá", dial: "507", ...generic },
  { iso: "CO", name: "Colombia", dial: "57", ...generic },
  { iso: "ES", name: "España", dial: "34", ...generic },
  { iso: "DO", name: "República Dominicana", dial: "1", min: 10, max: 10, areaCodes: ["809", "829", "849"] },
  { iso: "VE", name: "Venezuela", dial: "58", ...generic, trunk: "0" },
  { iso: "PE", name: "Perú", dial: "51", ...generic, trunk: "0" },
  { iso: "CL", name: "Chile", dial: "56", ...generic },
  { iso: "AR", name: "Argentina", dial: "54", ...generic, trunk: "0" },
  { iso: "EC", name: "Ecuador", dial: "593", ...generic, trunk: "0" },
  { iso: "IT", name: "Italia", dial: "39", ...generic },
  { iso: "DE", name: "Alemania", dial: "49", ...generic, trunk: "0" },
  { iso: "FR", name: "Francia", dial: "33", ...generic, trunk: "0" },
  { iso: "GB", name: "Reino Unido", dial: "44", ...generic, trunk: "0" },
];

export const DEFAULT_PHONE_COUNTRY = "HN";
/** Opción "Otro": el usuario escribe el número completo con +código. */
export const OTHER_PHONE_COUNTRY = "XX";

export const PHONE_ERROR = "Número no válido para el país seleccionado";

const E164 = /^\+[1-9]\d{6,14}$/;
const onlyDigits = (v: string) => v.replace(/\D/g, "");
const isInternational = (v: string) => /^\s*(\+|00)/.test(v);

export function phoneCountryByIso(iso: string | null | undefined): PhoneCountry | null {
  return PHONE_COUNTRIES.find((c) => c.iso === iso) ?? null;
}

/** Busca el país por código ("504", "+504"). Para +1 devuelve Estados Unidos. */
function countryByDial(dial: string): PhoneCountry | null {
  const d = onlyDigits(dial);
  return PHONE_COUNTRIES.find((c) => c.dial === d) ?? null;
}

/**
 * País de un número E.164 (o de cualquier texto con +código). Para +1 elige
 * República Dominicana si el área es 809/829/849 y Estados Unidos en los demás casos.
 */
export function phoneCountry(e164: string | null | undefined): PhoneCountry | null {
  if (!e164) return null;
  const digits = onlyDigits(e164);
  if (!digits) return null;
  // Honduras sin "+": 8 dígitos
  if (!isInternational(e164) && digits.length === 8) return phoneCountryByIso("HN");
  const matches = PHONE_COUNTRIES.filter((c) => digits.startsWith(c.dial) && !c.areaCodes);
  if (!matches.length) return null;
  const best = matches.sort((a, b) => b.dial.length - a.dial.length)[0]!;
  if (best.dial === "1") {
    const area = digits.slice(1, 4);
    const special = PHONE_COUNTRIES.find((c) => c.dial === "1" && c.areaCodes?.includes(area));
    if (special) return special;
    return phoneCountryByIso("US");
  }
  return best;
}

/** Número nacional (sin código de país) de un E.164. */
export function phoneNational(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = onlyDigits(e164);
  const c = phoneCountry(e164);
  if (!c) return digits;
  if (!isInternational(e164) && digits.length === 8) return digits;
  return digits.slice(c.dial.length);
}

/**
 * Normaliza a E.164.
 * - Si el texto empieza con "+" o "00" se respeta el código escrito.
 * - Con `countryDial` ("504", "+1", "52"...) se antepone ese código al número nacional
 *   (si el número ya trae el código, no se duplica).
 * - Sin país: 8 dígitos = Honduras (+504); en otro caso se antepone "+".
 */
export function normalizePhone(value: string, countryDial?: string | null): string {
  const raw = (value ?? "").trim();
  let digits = onlyDigits(raw);
  if (!digits) return "";
  if (isInternational(raw)) {
    if (raw.replace(/^\s+/, "").startsWith("00")) digits = digits.slice(2);
    return digits ? `+${digits}` : "";
  }
  const dial = countryDial ? onlyDigits(countryDial) : "";
  if (dial) {
    const country = countryByDial(dial);
    const min = country?.min ?? generic.min;
    const max = country?.max ?? generic.max;
    if (digits.startsWith(dial) && digits.length - dial.length >= min && digits.length > max) {
      return `+${digits}`;
    }
    if (country?.trunk && digits.startsWith(country.trunk) && digits.length - country.trunk.length >= min) {
      digits = digits.slice(country.trunk.length);
    }
    return `+${dial}${digits}`;
  }
  if (digits.length === 8) return `+504${digits}`;
  return `+${digits}`;
}

/** ¿Es un E.164 válido? Honduras 8 dígitos, +1 10 dígitos, el resto 6 a 14 (total ≤ 15). */
export function isValidE164(e164: string): boolean {
  if (!E164.test(e164)) return false;
  const c = phoneCountry(e164);
  if (!c) return true; // código no listado ("Otro"): basta el formato E.164
  const n = e164.length - 1 - c.dial.length;
  return n >= c.min && n <= c.max;
}

/**
 * Valida un teléfono. Con `countryDial` se valida para ese país. Sin país: si trae "+" o "00"
 * se valida como E.164 según su código; si no, se acepta el formato hondureño (8 dígitos)
 * o 10 a 15 dígitos (compatibilidad).
 */
export function isValidPhone(value: string, countryDial?: string | null): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  if (countryDial || isInternational(raw)) return isValidE164(normalizePhone(raw, countryDial));
  const digits = onlyDigits(raw);
  return digits.length === 8 || (digits.length >= 10 && digits.length <= 15);
}

/** Formato del número nacional sin el código (para el campo de texto). */
export function formatNational(iso: string | null | undefined, national: string): string {
  const d = onlyDigits(national);
  if (iso === "HN" || iso === "GT" || iso === "SV" || iso === "NI" || iso === "CR") {
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
  }
  if ((iso === "US" || iso === "CA" || iso === "DO") && d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (iso === "MX" && d.length === 10) {
    return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  }
  return d;
}

/**
 * Para mostrar: Honduras "9999-8888" (sin código); +1 "+1 (305) 555-1234";
 * México "+52 55 1234 5678"; el resto "+CC número".
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = onlyDigits(value);
  if (!digits) return value;
  if (!isInternational(value) && digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (!isInternational(value) && !(digits.length === 11 && digits.startsWith("504"))) return value;
  const c = phoneCountry(`+${digits}`);
  if (!c) return `+${digits}`;
  const national = digits.slice(c.dial.length);
  if (c.iso === "HN") return national.length === 8 ? formatNational("HN", national) : `+504 ${national}`;
  return `+${c.dial} ${formatNational(c.iso, national)}`;
}

/** Siempre con código de país: "+504 9999-8888", "+1 (305) 555-1234". */
export function formatPhoneIntl(value: string | null | undefined): string {
  if (!value) return "";
  const e164 = normalizePhone(value);
  const c = phoneCountry(e164);
  if (!c) return e164;
  return `+${c.dial} ${formatNational(c.iso, e164.slice(1 + c.dial.length))}`;
}

/**
 * Términos de búsqueda para un teléfono: número nacional completo y sus últimos 7/4 dígitos,
 * para que se pueda buscar por el final del número sin importar el código de país.
 */
export function phoneSearchTerms(value: string | null | undefined): string[] {
  if (!value) return [];
  const national = phoneNational(normalizePhone(value));
  if (!national) return [];
  const terms = [national];
  if (national.length > 8) terms.push(national.slice(-8));
  if (national.length > 7) terms.push(national.slice(-7));
  if (national.length > 4) terms.push(national.slice(-4));
  return Array.from(new Set(terms));
}

/**
 * Link de WhatsApp con texto (fallback manual). Se usa api.whatsapp.com/send en lugar de
 * wa.me porque la redirección de wa.me daña los emojis del mensaje.
 */
export function whatsappLink(phone: string, text?: string): string {
  const digits = onlyDigits(normalizePhone(phone) || phone);
  const base = `https://api.whatsapp.com/send?phone=${digits}`;
  return text ? `${base}&text=${encodeURIComponent(text.normalize("NFC"))}` : base;
}
