import { describe, expect, it } from "vitest";
import {
  formatPhone, formatPhoneIntl, isValidE164, isValidPhone, normalizePhone, phoneCountry, phoneNational, phoneSearchTerms, whatsappLink,
} from "../phone";
import { customerSchema, settingsSchema } from "../schemas";
import { buildSearchKeywords, searchToken } from "../text";

describe("normalizePhone", () => {
  it("mantiene el comportamiento hondureño sin país", () => {
    expect(normalizePhone("9999-8888")).toBe("+50499998888");
    expect(normalizePhone("504 9999 8888")).toBe("+50499998888");
    expect(normalizePhone("+50499998888")).toBe("+50499998888");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("  ")).toBe("");
  });
  it("respeta el código escrito con + o 00", () => {
    expect(normalizePhone("+1 (305) 555-1234")).toBe("+13055551234");
    expect(normalizePhone("0013055551234")).toBe("+13055551234");
    expect(normalizePhone("+52 55 1234 5678", "504")).toBe("+525512345678");
    // un número internacional corto no se confunde con Honduras
    expect(normalizePhone("+50612345678")).toBe("+50612345678");
  });
  it("usa el país seleccionado", () => {
    expect(normalizePhone("3055551234", "1")).toBe("+13055551234");
    expect(normalizePhone("(305) 555-1234", "+1")).toBe("+13055551234");
    expect(normalizePhone("1 305 555 1234", "1")).toBe("+13055551234");
    expect(normalizePhone("55 1234 5678", "52")).toBe("+525512345678");
    expect(normalizePhone("9999-8888", "504")).toBe("+50499998888");
    expect(normalizePhone("50499998888", "504")).toBe("+50499998888");
    expect(normalizePhone("5555-1234", "502")).toBe("+50255551234");
    expect(normalizePhone("612 345 678", "34")).toBe("+34612345678");
    expect(normalizePhone("07911 123456", "44")).toBe("+447911123456");
    expect(normalizePhone("0991234567", "593")).toBe("+593991234567");
  });
});

describe("validación", () => {
  it("valida por país", () => {
    expect(isValidPhone("9999-8888", "504")).toBe(true);
    expect(isValidPhone("9999-888", "504")).toBe(false);
    expect(isValidPhone("3055551234", "1")).toBe(true);
    expect(isValidPhone("305555123", "1")).toBe(false);
    expect(isValidPhone("5512345678", "52")).toBe(true);
    expect(isValidPhone("12345", "57")).toBe(false);
    expect(isValidPhone("3001234567", "57")).toBe(true);
    expect(isValidPhone("123456789012345", "57")).toBe(false); // total > 15
  });
  it("valida E.164 sin país", () => {
    expect(isValidPhone("+13055551234")).toBe(true);
    expect(isValidPhone("+1305555123")).toBe(false);
    expect(isValidPhone("+50499998888")).toBe(true);
    expect(isValidPhone("+5049999888")).toBe(false);
    expect(isValidPhone("+8613812345678")).toBe(true); // código no listado ("Otro")
    expect(isValidPhone("9999-8888")).toBe(true);
    expect(isValidE164("+0123456789")).toBe(false);
    expect(isValidE164("+1234567890123456")).toBe(false);
  });
  it("esquemas aceptan internacional con mensaje nuevo", () => {
    const base = { firstName: "Ana", lastName: "Ruiz", whatsapp: "", email: "", idNumber: "", rtn: "", address: "", city: "", notes: "", status: "active" as const };
    expect(customerSchema.safeParse({ ...base, phone: "+13055551234" }).success).toBe(true);
    expect(customerSchema.safeParse({ ...base, phone: "9999-8888" }).success).toBe(true);
    const bad = customerSchema.safeParse({ ...base, phone: "+1305555" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("Número no válido para el país seleccionado");
    expect(settingsSchema.shape.whatsapp.safeParse("+525512345678").success).toBe(true);
  });
});

describe("país y formato", () => {
  it("detecta el país", () => {
    expect(phoneCountry("+50499998888")?.iso).toBe("HN");
    expect(phoneCountry("+13055551234")?.iso).toBe("US");
    expect(phoneCountry("+18095551234")?.iso).toBe("DO");
    expect(phoneCountry("+525512345678")?.iso).toBe("MX");
    expect(phoneCountry("+50255551234")?.iso).toBe("GT");
    expect(phoneCountry("+593991234567")?.iso).toBe("EC");
    expect(phoneCountry("+447911123456")?.iso).toBe("GB");
    expect(phoneCountry("+8613812345678")).toBeNull();
    expect(phoneNational("+13055551234")).toBe("3055551234");
  });
  it("formatea para mostrar", () => {
    expect(formatPhone("+50499998888")).toBe("9999-8888");
    expect(formatPhone("+13055551234")).toBe("+1 (305) 555-1234");
    expect(formatPhone("+525512345678")).toBe("+52 55 1234 5678");
    expect(formatPhone("+34612345678")).toBe("+34 612345678");
    expect(formatPhone("+50612345678")).toBe("+506 1234-5678");
    expect(formatPhone("+8613812345678")).toBe("+8613812345678");
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
    expect(formatPhoneIntl("+50499998888")).toBe("+504 9999-8888");
    expect(formatPhoneIntl("9999-8888")).toBe("+504 9999-8888");
    expect(formatPhoneIntl("+13055551234")).toBe("+1 (305) 555-1234");
  });
});

describe("WhatsApp y búsqueda", () => {
  it("el link usa los dígitos del E.164 sin anteponer 504", () => {
    expect(whatsappLink("+13055551234")).toBe("https://api.whatsapp.com/send?phone=13055551234");
    expect(whatsappLink("+525512345678", "Hola")).toBe("https://api.whatsapp.com/send?phone=525512345678&text=Hola");
    expect(whatsappLink("+50499998888")).toBe("https://api.whatsapp.com/send?phone=50499998888");
  });
  it("se puede buscar por los últimos dígitos", () => {
    const k = buildSearchKeywords(phoneSearchTerms("+13055551234"));
    expect(k).toContain(searchToken("3055551234"));
    expect(k).toContain(searchToken("555-1234"));
    expect(k).toContain(searchToken("1234"));
    const hn = buildSearchKeywords(phoneSearchTerms("+50499998888"));
    expect(hn).toContain("99998888");
    expect(hn).toContain("8888");
  });
});
