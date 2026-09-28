import { describe, expect, it } from "vitest";
import {
  adjustLoyaltyStamps, adjustLoyaltyStampsSchema, applyLoyaltyWash, carwashSettingsFrom, clampStartStamps, loyaltyProgressText, loyaltyWelcomeFor,
} from "../carwash";
import {
  base64Bytes, onlinePayCheckSchema, onlinePayStartSchema, PROOF_MAX_BYTES, reviewPaymentProofSchema, sniffProofType, submitPaymentProofSchema,
} from "../catalog";
import { carwashReadyBody, renderTemplate, setTemplateOverrides, templateBody, templateMissingLink } from "../templates";

describe("sellos de bienvenida", () => {
  it("la configuración limita los sellos de regalo a 0..N-1", () => {
    expect(carwashSettingsFrom({}).loyaltyStartStamps).toBe(0);
    expect(carwashSettingsFrom({ loyaltyEvery: 10, loyaltyStartStamps: 2 }).loyaltyStartStamps).toBe(2);
    expect(carwashSettingsFrom({ loyaltyEvery: 10, loyaltyStartStamps: 15 }).loyaltyStartStamps).toBe(9);
    expect(carwashSettingsFrom({ loyaltyEvery: 10, loyaltyStartStamps: -3 }).loyaltyStartStamps).toBe(0);
    expect(carwashSettingsFrom({ loyaltyEvery: 0, loyaltyStartStamps: 4 }).loyaltyStartStamps).toBe(0);
    expect(clampStartStamps("2.7", 10)).toBe(2);
  });

  it("solo la tarjeta nueva recibe el regalo", () => {
    const cfg = { loyaltyEvery: 10, loyaltyStartStamps: 2 };
    expect(loyaltyWelcomeFor({ exists: false }, cfg)).toBe(2);
    expect(loyaltyWelcomeFor({ exists: true, welcomePending: true }, cfg)).toBe(2);
    // Tarjetas que ya existían (sin marca) o que ya recibieron el regalo
    expect(loyaltyWelcomeFor({ exists: true }, cfg)).toBe(0);
    expect(loyaltyWelcomeFor({ exists: true, welcomePending: false }, cfg)).toBe(0);
    expect(loyaltyWelcomeFor({ exists: false }, { loyaltyEvery: 0, loyaltyStartStamps: 2 })).toBe(0);
  });

  it("tarjeta nueva con 2 de regalo: el primer lavado la deja en 3", () => {
    expect(applyLoyaltyWash({ count: 0, rewardsAvailable: 0 }, 10, 2)).toEqual({ count: 3, rewardsAvailable: 0, earned: false });
  });

  it("si el regalo más el lavado completan la tarjeta se genera el premio", () => {
    expect(applyLoyaltyWash({ count: 0, rewardsAvailable: 0 }, 3, 2)).toEqual({ count: 0, rewardsAvailable: 1, earned: true });
    expect(applyLoyaltyWash({ count: 0, rewardsAvailable: 0 }, 1, 0)).toEqual({ count: 0, rewardsAvailable: 1, earned: true });
  });

  it("cuenta de más (se bajó N) genera los premios completos", () => {
    expect(applyLoyaltyWash({ count: 9, rewardsAvailable: 0 }, 5)).toEqual({ count: 0, rewardsAvailable: 2, earned: true });
  });

  it("después de canjear el premio sigue normal, sin regalo", () => {
    let s = applyLoyaltyWash({ count: 0, rewardsAvailable: 0 }, 10, 2);
    for (let i = 0; i < 7; i++) s = applyLoyaltyWash(s, 10);
    expect(s).toEqual({ count: 0, rewardsAvailable: 1, earned: true });
    s = applyLoyaltyWash({ count: s.count, rewardsAvailable: 0 }, 10);
    expect(s.count).toBe(1);
  });
});

describe("ajuste manual de sellos", () => {
  it("suma y resta sin bajar de 0", () => {
    expect(adjustLoyaltyStamps({ count: 4, rewardsAvailable: 0 }, 3, 10)).toEqual({ count: 7, rewardsAvailable: 0, rewardsEarned: 0 });
    expect(adjustLoyaltyStamps({ count: 4, rewardsAvailable: 1 }, -10, 10)).toEqual({ count: 0, rewardsAvailable: 1, rewardsEarned: 0 });
  });
  it("si llega a N genera premio", () => {
    expect(adjustLoyaltyStamps({ count: 8, rewardsAvailable: 0 }, 2, 10)).toEqual({ count: 0, rewardsAvailable: 1, rewardsEarned: 1 });
    expect(adjustLoyaltyStamps({ count: 8, rewardsAvailable: 0 }, 13, 10)).toEqual({ count: 1, rewardsAvailable: 2, rewardsEarned: 2 });
  });
  it("tarjeta desactivada: solo cambia el conteo", () => {
    expect(adjustLoyaltyStamps({ count: 2, rewardsAvailable: 0 }, 20, 0)).toEqual({ count: 22, rewardsAvailable: 0, rewardsEarned: 0 });
  });
  it("valida la entrada", () => {
    expect(adjustLoyaltyStampsSchema.safeParse({ plate: "hab-1234", delta: 2, reason: "Promoción" }).success).toBe(true);
    expect(adjustLoyaltyStampsSchema.safeParse({ plate: "HAB1234", delta: 0, reason: "Promoción" }).success).toBe(false);
    expect(adjustLoyaltyStampsSchema.safeParse({ plate: "HAB1234", delta: 1.5, reason: "Promoción" }).success).toBe(false);
    expect(adjustLoyaltyStampsSchema.safeParse({ plate: "HAB1234", delta: -1, reason: "" }).success).toBe(false);
  });
  it("texto para el cliente", () => {
    expect(loyaltyProgressText(7, 10)).toBe("7 de 10: le faltan 3 para un lavado gratis.");
    expect(loyaltyProgressText(9, 10)).toContain("próximo lavado es gratis");
    expect(loyaltyProgressText(2, 10, 1)).toBe("Tiene 1 lavado gratis disponible.");
    expect(loyaltyProgressText(2, 0)).toBe("");
  });
});

describe("comprobantes del cliente", () => {
  const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString("base64");
  it("reconoce el tipo real del archivo", () => {
    expect(sniffProofType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffProofType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffProofType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffProofType(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffProofType(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d]))).toBeNull(); // <htm
  });
  it("calcula el tamaño del base64 sin decodificar", () => {
    for (const n of [1, 2, 3, 10, 1000]) expect(base64Bytes(b64(Array.from({ length: n }, (_, i) => i % 256)))).toBe(n);
    expect(PROOF_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
  it("valida el envío", () => {
    const ok = { token: "ABCDE23456", kind: "wash", bank: "BAC", reference: "", amount: 25000, fileBase64: b64(Array(20).fill(1)), contentType: "image/jpeg" };
    expect(submitPaymentProofSchema.safeParse(ok).success).toBe(true);
    expect(submitPaymentProofSchema.safeParse({ ...ok, contentType: "text/html" }).success).toBe(false);
    expect(submitPaymentProofSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(submitPaymentProofSchema.safeParse({ ...ok, bank: "" }).success).toBe(false);
    expect(submitPaymentProofSchema.safeParse({ ...ok, token: "abc" }).success).toBe(false);
    expect(submitPaymentProofSchema.safeParse({ ...ok, kind: "sale" }).success).toBe(false);
  });
  it("revisión: rechazar exige motivo", () => {
    expect(reviewPaymentProofSchema.safeParse({ proofId: "p1", action: "approve", method: "transfer" }).success).toBe(true);
    expect(reviewPaymentProofSchema.safeParse({ proofId: "p1", action: "reject" }).success).toBe(false);
    expect(reviewPaymentProofSchema.safeParse({ proofId: "p1", action: "reject", reason: "No aparece en el banco" }).success).toBe(true);
    expect(reviewPaymentProofSchema.safeParse({ proofId: "p1", action: "approve", method: "cash" }).success).toBe(false);
  });
  it("pago en línea: orden por defecto, o lavado", () => {
    expect(onlinePayStartSchema.parse({ token: "ABCDE23456", origin: "https://x.web.app" }).kind).toBeUndefined();
    expect(onlinePayStartSchema.safeParse({ token: "ABCDE23456", origin: "https://x.web.app", kind: "wash" }).success).toBe(true);
    expect(onlinePayCheckSchema.safeParse({ token: "ABCDE23456", kind: "otro" }).success).toBe(false);
  });
});

describe("WhatsApp: carro listo con link", () => {
  it("por pagar lleva el total y el link; sin link se quita la frase", () => {
    setTemplateOverrides({});
    const t = renderTemplate(carwashReadyBody(false), { cliente: "Ana", placa: "HAB 1234", total: "L 250.00", link: "https://x/lavado/ABCDE23456", sellos: "" });
    expect(t).toContain("L 250.00");
    expect(t).toContain("https://x/lavado/ABCDE23456");
    const sin = renderTemplate(carwashReadyBody(false), { cliente: "Ana", placa: "HAB 1234", total: "L 250.00" });
    expect(sin).not.toContain("Puede pagar");
    expect(sin).not.toContain("{{");
  });
  it("ya pagado usa la variante sin cobro", () => {
    setTemplateOverrides({});
    const t = renderTemplate(carwashReadyBody(true), { cliente: "Ana", placa: "HAB 1234", total: "L 250.00", link: "https://x/lavado/ABCDE23456" });
    expect(t).not.toContain("Total");
    expect(t).toContain("https://x/lavado/ABCDE23456");
  });
  it("respeta la plantilla editada por el taller y avisa si no tiene link", () => {
    setTemplateOverrides({ carwashReady: "Hola {{cliente}}, su carro está listo." });
    expect(templateMissingLink("carwashReady")).toBe(true);
    expect(carwashReadyBody(false)).toBe("Hola {{cliente}}, su carro está listo.");
    // Solo editó la de "por pagar": para pagado también se usa su texto
    expect(carwashReadyBody(true)).toBe("Hola {{cliente}}, su carro está listo.");
    setTemplateOverrides({ carwashReady: "Listo: {{link}}" });
    expect(templateMissingLink("carwashReady")).toBe(false);
    setTemplateOverrides({});
    expect(templateMissingLink("carwashReady")).toBe(false);
    expect(templateBody("carwashReady")).toContain("{{link}}");
  });
});
