import { describe, expect, it } from "vitest";
import { buildPublicCarwash, type CarwashPlan, type CarwashService } from "../index";

const svc = (id: string, extra: Partial<CarwashService> = {}): CarwashService =>
  ({
    id,
    name: `Servicio ${id}`,
    description: "Desc",
    kind: "wash",
    prices: { turismo: 15000, camioneta: 18000, pickup: 18000, oversize: null },
    minutes: 30,
    commission: { type: "percent", value: 10 },
    active: true,
    sort: 1,
    ...extra,
  }) as CarwashService;

describe("buildPublicCarwash", () => {
  it("solo servicios activos, ordenados y sin precios", () => {
    const out = buildPublicCarwash([svc("b", { sort: 2 }), svc("a", { sort: 1 }), svc("x", { active: false })], [], { loyaltyEvery: 10, loyaltyStartStamps: 2 });
    expect(out.services.map((s) => s.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(out)).not.toMatch(/15000|18000|commission|prices|minutes/);
    expect(out.services[0]?.sizes).toEqual(["turismo", "camioneta", "pickup", "oversize"]);
    expect(out.services[0]?.quoteSizes).toEqual(["oversize"]);
    expect(out.loyalty).toEqual({ every: 10, startStamps: 2 });
  });

  it("planes activos con nombres de servicios incluidos y sin precio", () => {
    const plans = [
      { id: "p1", name: "Plan SUV", size: "camioneta", price: 99900, includedServiceIds: ["a", "x"], washesPerMonth: 4, active: true },
      { id: "p2", name: "Inactivo", size: "turismo", price: 1, includedServiceIds: [], washesPerMonth: null, active: false },
      { id: "p3", name: "Ilimitado", size: "turismo", price: 1, includedServiceIds: ["a"], washesPerMonth: null, active: true },
    ] as unknown as CarwashPlan[];
    const out = buildPublicCarwash([svc("a"), svc("x", { active: false })], plans, { loyaltyEvery: 0, loyaltyStartStamps: 0 });
    expect(out.plans.map((p) => p.id)).toEqual(["p3", "p1"]);
    expect(out.plans[1]).toEqual({ id: "p1", name: "Plan SUV", size: "camioneta", washesPerMonth: 4, includedNames: ["Servicio a"] });
    expect(out.plans[0]?.washesPerMonth).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/99900|price/);
    expect(out.loyalty.every).toBe(0);
  });
});
