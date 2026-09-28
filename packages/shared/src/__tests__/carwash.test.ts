import { describe, expect, it } from "vitest";
import {
  addMonthsHN, applyLoyaltyWash, buildWashItems, carwashSettingsFrom, computeCommission, computeWashCharge, extendMembership,
  loyaltyText, membershipCanUse, membershipWindow, netOf, priceForSize, rewardCap, SAMPLE_CARWASH_MENU, washCommissionTotal, washPlate,
  saveWashSchema, chargeWashSchema, carwashVehicleData, isPendingVehicle, CARWASH_VEHICLE_NOTE, pickVehicleForPlate, linkWashCustomerSchema,
  type CarwashService,
} from "../carwash";
import { vehicleSchema } from "../schemas";
import { can, ROLES } from "../roles";
import { renderTemplate, templateBody } from "../templates";

const svc = (id: string, over: Partial<CarwashService> = {}) =>
  ({
    id,
    name: id,
    kind: "wash",
    prices: { turismo: 15000, camioneta: 18000, pickup: 20000, oversize: null },
    commission: { type: "percent", value: 20 },
    active: true,
    ...over,
  }) as Pick<CarwashService, "id" | "name" | "kind" | "prices" | "commission" | "active">;

const services = [
  svc("basico"),
  svc("completo", { prices: { turismo: 25000, camioneta: 30000, pickup: 33000, oversize: null } }),
  svc("aroma", { kind: "extra", prices: { turismo: 4000, camioneta: 4000, pickup: 4000, oversize: 4000 }, commission: { type: "fixed", value: 500 } }),
];

describe("carwash: precios por tamaño", () => {
  it("toma el precio del tamaño y null es a convenir", () => {
    expect(priceForSize(services[0]!, "camioneta")).toBe(18000);
    expect(priceForSize(services[0]!, "oversize")).toBeNull();
  });
  it("normaliza placas", () => expect(washPlate(" hab-12 34 ")).toBe("HAB1234"));
  it("arma líneas con precio por tamaño y comisión", () => {
    const items = buildWashItems({ size: "pickup", selections: [{ serviceId: "completo" }, { serviceId: "aroma" }], services });
    expect(items.map((i) => i.price)).toEqual([33000, 4000]);
    expect(items.map((i) => i.commission)).toEqual([6600, 500]);
    expect(washCommissionTotal(items)).toBe(7100);
  });
  it("oversize sin precio exige precio escrito a mano", () => {
    expect(() => buildWashItems({ size: "oversize", selections: [{ serviceId: "basico" }], services })).toThrow(/precio/);
    const items = buildWashItems({ size: "oversize", selections: [{ serviceId: "basico", price: 60000 }], services });
    expect(items[0]!.price).toBe(60000);
  });
  it("no permite dos lavados principales ni repetidos", () => {
    expect(() => buildWashItems({ size: "turismo", selections: [{ serviceId: "basico" }, { serviceId: "completo" }], services })).toThrow();
    expect(() => buildWashItems({ size: "turismo", selections: [{ serviceId: "aroma" }, { serviceId: "aroma" }], services })).toThrow();
  });
});

describe("carwash: comisión", () => {
  it("porcentaje y fijo", () => {
    expect(computeCommission({ type: "percent", value: 20 }, 25000)).toBe(5000);
    expect(computeCommission({ type: "percent", value: 12.5 }, 15000)).toBe(1875);
    expect(computeCommission({ type: "fixed", value: 3000 }, 99999)).toBe(3000);
    expect(computeCommission({ type: "percent", value: 0 }, 15000)).toBe(0);
  });
  it("la comisión se calcula sobre el precio de menú aunque vaya cubierto", () => {
    const items = buildWashItems({ size: "turismo", selections: [{ serviceId: "basico" }], services, membershipServiceIds: ["basico"] });
    expect(items[0]!.price).toBe(0);
    expect(items[0]!.commission).toBe(3000);
  });
});

describe("carwash: ISV", () => {
  it("precio con ISV incluido: el total es exactamente el precio", () => {
    for (let p = 1000; p < 200000; p += 777) {
      const r = computeWashCharge([p, 4000], 15, "included");
      expect(r.totals.total).toBe(p + 4000);
    }
  });
  it("incluido con descuento: total = precio - descuento", () => {
    const r = computeWashCharge([25000, 4000], 15, "included", 5000);
    expect(r.totals.total).toBe(24000);
    expect(netOf(r.totals) + r.totals.tax).toBe(24000);
  });
  it("sumar ISV", () => {
    const r = computeWashCharge([10000], 15, "add");
    expect(r.totals).toEqual({ subtotal: 10000, discount: 0, tax: 1500, total: 11500 });
  });
  it("exento", () => {
    const r = computeWashCharge([10000, 500], 15, "exempt");
    expect(r.totals.total).toBe(10500);
    expect(r.totals.tax).toBe(0);
    expect(r.lines.every((l) => !l.taxable)).toBe(true);
  });
  it("todo cubierto da total 0", () => {
    expect(computeWashCharge([0, 0], 15, "included").totals.total).toBe(0);
  });
});

describe("carwash: lealtad", () => {
  it("cada N lavados genera un premio", () => {
    let s = { count: 0, rewardsAvailable: 0 };
    for (let i = 0; i < 9; i++) s = applyLoyaltyWash(s, 10);
    expect(s).toMatchObject({ count: 9, rewardsAvailable: 0 });
    const r = applyLoyaltyWash(s, 10);
    expect(r).toEqual({ count: 0, rewardsAvailable: 1, earned: true });
  });
  it("desactivada con 0", () => expect(applyLoyaltyWash({ count: 3, rewardsAvailable: 0 }, 0)).toEqual({ count: 3, rewardsAvailable: 0, earned: false }));
  it("tope del premio: lavado más barato del tamaño o monto fijo", () => {
    expect(rewardCap({ rewardMode: "cheapest", rewardMaxPrice: 0 }, services, "camioneta")).toBe(18000);
    expect(rewardCap({ rewardMode: "cheapest", rewardMaxPrice: 0 }, services, "oversize")).toBeNull();
    expect(rewardCap({ rewardMode: "upTo", rewardMaxPrice: 20000 }, services, "turismo")).toBe(20000);
  });
  it("el premio cubre el lavado hasta el tope y los extras se cobran", () => {
    const items = buildWashItems({ size: "turismo", selections: [{ serviceId: "completo" }, { serviceId: "aroma" }], services, rewardCap: 15000 });
    expect(items[0]).toMatchObject({ price: 10000, covered: "reward" });
    expect(items[1]).toMatchObject({ price: 4000, covered: null });
  });
  it("el premio necesita un lavado", () => {
    expect(() => buildWashItems({ size: "turismo", selections: [{ serviceId: "aroma" }], services, rewardCap: 15000 })).toThrow();
  });
  it("texto de sellos", () => {
    expect(loyaltyText(7, 10)).toContain("7 de 10");
    expect(loyaltyText(0, 10, 1)).toContain("1 lavado gratis");
    expect(loyaltyText(3, 0)).toBe("");
  });
});

describe("carwash: membresías", () => {
  const day = 86400000;
  it("suma meses en hora de Honduras (fin de mes)", () => {
    const jan31 = Date.UTC(2026, 0, 31, 6 + 10); // 31 ene 10:00 HN
    const r = new Date(addMonthsHN(jan31, 1) - 6 * 3600000);
    expect([r.getUTCMonth(), r.getUTCDate(), r.getUTCHours()]).toEqual([1, 28, 10]);
  });
  it("cobertura: solo servicios incluidos y dentro del límite", () => {
    expect(membershipCanUse(4, 3)).toBe(true);
    expect(membershipCanUse(4, 4)).toBe(false);
    expect(membershipCanUse(null, 99)).toBe(true);
    const items = buildWashItems({ size: "turismo", selections: [{ serviceId: "basico" }, { serviceId: "aroma" }], services, membershipServiceIds: ["basico"] });
    expect(items.map((i) => [i.price, i.covered])).toEqual([[0, "membership"], [4000, null]]);
  });
  it("vencida si pasó la fecha pagada", () => {
    const now = Date.UTC(2026, 5, 1);
    const w = membershipWindow({ status: "active", periodStart: now - 40 * day, periodEnd: now - 10 * day, paidUntil: now - 10 * day, usedInPeriod: 3 }, now);
    expect(w.active).toBe(false);
  });
  it("pasa al mes siguiente con el uso en 0", () => {
    const start = Date.UTC(2026, 0, 10, 12);
    const m = { status: "active" as const, periodStart: start, periodEnd: addMonthsHN(start, 1), paidUntil: addMonthsHN(start, 3), usedInPeriod: 4 };
    const w = membershipWindow(m, addMonthsHN(start, 1) + day);
    expect(w).toMatchObject({ active: true, usedInPeriod: 0, rolled: true, periodStart: m.periodEnd });
  });
  it("renovar antes de vencer extiende la fecha pagada; vencida empieza hoy", () => {
    const now = Date.UTC(2026, 3, 1, 12);
    const cur = { active: true, periodStart: now - 5 * day, periodEnd: now + 20 * day, paidUntil: now + 20 * day, usedInPeriod: 2 };
    const e = extendMembership(cur, 1, now);
    expect(e.paidUntil).toBe(addMonthsHN(cur.paidUntil, 1));
    expect(e.usedInPeriod).toBe(2);
    const n = extendMembership({ ...cur, active: false }, 2, now);
    expect(n).toMatchObject({ periodStart: now, usedInPeriod: 0, paidUntil: addMonthsHN(now, 2) });
  });
});

describe("carwash: configuración, validaciones, roles y plantillas", () => {
  it("configuración con valores por defecto y saneados", () => {
    expect(carwashSettingsFrom(null)).toMatchObject({ loyaltyEvery: 10, taxMode: "included" });
    expect(carwashSettingsFrom({ loyaltyEvery: -3, taxMode: "x" as never }).loyaltyEvery).toBe(0);
  });
  it("menú de ejemplo válido", () => {
    expect(SAMPLE_CARWASH_MENU.filter((s) => s.kind === "wash")).toHaveLength(6);
    expect(SAMPLE_CARWASH_MENU.filter((s) => s.kind === "extra")).toHaveLength(3);
  });
  it("saveWash normaliza la placa", () => {
    const r = saveWashSchema.parse({ plate: "hab-1234", size: "turismo", customerName: "", phone: "", items: [{ serviceId: "a" }], notes: "", useReward: false, useMembership: false });
    expect(r.plate).toBe("HAB1234");
  });
  it("cobro exige al menos un pago", () => {
    expect(chargeWashSchema.safeParse({ washId: "w", discount: 0, payments: [] }).success).toBe(false);
  });
  it("rol lavador: solo carwash, sin cobrar ni reportes", () => {
    expect(ROLES).toContain("washer");
    expect(can("washer", "carwash.read")).toBe(true);
    expect(can("washer", "carwash.create")).toBe(true);
    expect(can("washer", "carwash.charge")).toBe(false);
    expect(can("washer", "carwash.reports")).toBe(false);
    expect(can("washer", "dashboard.view")).toBe(false);
    expect(can("seller", "carwash.charge")).toBe(true);
    expect(can("manager", "carwash.manage")).toBe(true);
    expect(can("technician", "carwash.read")).toBe(false);
  });
  it("plantilla de carro listo con sellos", () => {
    const t = renderTemplate(templateBody("carwashReady"), { cliente: "Ana", placa: "HAB-1234", sellos: loyaltyText(7, 10), taller: "RAPIFIX" });
    expect(t).toContain("HAB-1234");
    expect(t).toContain("7 de 10");
    const t2 = renderTemplate(templateBody("carwashReady"), { cliente: "Ana", placa: "HAB-1234", taller: "RAPIFIX" });
    expect(t2).not.toContain("{{");
  });
});

describe("carros del carwash en el taller", () => {
  it("el vehículo mínimo pasa la validación de vehículos del taller y normaliza la placa", () => {
    const v = carwashVehicleData({ plate: "hab-12 34", customerId: "c1", customer: { fullName: "Juan Pérez", phone: "+50499998888" }, year: 2026 });
    expect(v.plate).toBe("HAB1234");
    expect(v.customerId).toBe("c1");
    expect(v.notes).toBe(CARWASH_VEHICLE_NOTE);
    expect(v.archived).toBe(false);
    expect(v.photoCount).toBe(0);
    expect(v.searchKeywords).toContain("hab1234");
    expect(v.searchKeywords).toContain("juan");
    expect(v.searchKeywords).toContain("perez");
    expect(isPendingVehicle(v)).toBe(true);
    expect(isPendingVehicle({ make: "Toyota", model: "Hilux" })).toBe(false);
    const { customer: _c, mileageUpdatedAt: _m, coverPhotoUrl: _p, photoCount: _n, archived: _a, searchKeywords: _k, ...input } = v;
    expect(vehicleSchema.safeParse(input).success).toBe(true);
    // Mismos campos que permiten las reglas para vehículos
    const allowed = ["customerId", "customer", "make", "model", "year", "color", "plate", "vin", "mileage", "mileageUpdatedAt", "fuelType", "engine",
      "transmission", "notes", "coverPhotoUrl", "photoCount", "archived", "searchKeywords", "createdAt", "createdBy", "updatedAt", "updatedBy"];
    expect(Object.keys(v).every((k) => allowed.includes(k))).toBe(true);
  });

  it("elige el vehículo de la placa sin reasignar dueños", () => {
    const a = { id: "a", customerId: "otro", archived: false };
    const b = { id: "b", customerId: "c1", archived: false };
    const c = { id: "c", customerId: "c1", archived: true };
    expect(pickVehicleForPlate([a, b], "c1")?.id).toBe("b");
    expect(pickVehicleForPlate([a, b], null)?.id).toBe("a");
    expect(pickVehicleForPlate([c, a], "c1")?.id).toBe("a");
    expect(pickVehicleForPlate([c], "c1")?.id).toBe("c");
    expect(pickVehicleForPlate([], "c1")).toBeNull();
  });

  it("vincular lavado: pide lavado y cliente", () => {
    expect(linkWashCustomerSchema.safeParse({ washId: "w1", customerId: "c1" }).success).toBe(true);
    expect(linkWashCustomerSchema.safeParse({ washId: "w1", customerId: "c1", vehicleId: null }).success).toBe(true);
    expect(linkWashCustomerSchema.safeParse({ washId: "w1", customerId: "" }).success).toBe(false);
    expect(linkWashCustomerSchema.safeParse({ customerId: "c1" }).success).toBe(false);
  });
});
