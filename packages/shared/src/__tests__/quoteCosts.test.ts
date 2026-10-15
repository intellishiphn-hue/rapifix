import { describe, expect, it } from "vitest";
import { computeQuote, type QuoteItem } from "../quote";
import { applyCostChanges, costChangesText, costOnlyChanges, quoteProfit, updateQuoteCostsSchema } from "../quoteCosts";
import { formatMoney } from "../money";

const line = (o: Partial<Parameters<typeof computeQuote>[0][number]>) => ({
  id: "1", type: "service" as const, description: "x", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true, ...o,
});
const items = (): QuoteItem[] =>
  computeQuote([
    line({ id: "a", description: "Recarga de aire", unitCost: 100000, unitPrice: 100000 }),
    line({ id: "b", type: "part", productId: "p1", description: "Filtro", qty: 2, unitCost: 15000, unitPrice: 25000, discount: 1000 }),
  ], 15).items;

describe("applyCostChanges", () => {
  it("solo cambia unitCost; precios, descuentos y totales quedan iguales", () => {
    const before = items();
    const r = applyCostChanges(before, [{ itemId: "a", unitCost: 90000 }], { strict: true });
    expect(r.items[0]!.unitCost).toBe(90000);
    const { unitCost: _x, ...restAfter } = r.items[0]!;
    const { unitCost: _y, ...restBefore } = before[0]!;
    expect(restAfter).toEqual(restBefore);
    expect(r.items[1]).toBe(before[1]); // línea sin cambio: misma referencia
    expect(r.changes).toEqual([{ itemId: "a", description: "Recarga de aire", qty: 1, before: 100000, after: 90000 }]);
    // los totales recalculados no cambian
    expect(computeQuote(r.items, 15).totals).toEqual(computeQuote(before, 15).totals);
  });

  it("ignora costos iguales al actual", () => {
    const r = applyCostChanges(items(), [{ itemId: "a", unitCost: 100000 }], { strict: true });
    expect(r.changes).toEqual([]);
  });

  it("en modo estricto una línea que no existe es error; sin estricto se ignora", () => {
    expect(() => applyCostChanges(items(), [{ itemId: "zz", unitCost: 1 }], { strict: true })).toThrow();
    expect(applyCostChanges(items(), [{ itemId: "zz", unitCost: 1 }]).changes).toEqual([]);
  });

  it("onlyIfCost: no pisa un costo que la modificación ya había cambiado", () => {
    const rev = items().map((it) => (it.id === "b" ? { ...it, unitCost: 17000 } : it));
    const r = applyCostChanges(rev, [{ itemId: "a", unitCost: 90000 }, { itemId: "b", unitCost: 16000 }], { onlyIfCost: { a: 100000, b: 15000 } });
    expect(r.items.find((x) => x.id === "a")!.unitCost).toBe(90000);
    expect(r.items.find((x) => x.id === "b")!.unitCost).toBe(17000);
    expect(r.changes.map((c) => c.itemId)).toEqual(["a"]);
  });

  it("texto del historial", () => {
    const r = applyCostChanges(items(), [{ itemId: "a", unitCost: 90000 }]);
    expect(costChangesText(r.changes)).toBe(`Recarga de aire ${formatMoney(100000)} → ${formatMoney(90000)}`);
  });
});

describe("quoteProfit", () => {
  it("total de línea menos cantidad por costo", () => {
    // a: 1000 − 1000 = 0; b: (2×250 − 10) − 2×150 = 190
    expect(quoteProfit(items())).toBe(19000);
    const r = applyCostChanges(items(), [{ itemId: "a", unitCost: 90000 }]);
    expect(quoteProfit(r.items)).toBe(29000);
  });
});

describe("costOnlyChanges", () => {
  it("detecta cuando lo único que cambia es el costo", () => {
    const base = items();
    const next = base.map((it) => (it.id === "a" ? { ...it, unitCost: 90000 } : it));
    expect(costOnlyChanges(base, next)?.map((c) => [c.itemId, c.before, c.after])).toEqual([["a", 100000, 90000]]);
  });
  it("null si cambia el precio, la cantidad o una línea, o si no cambia nada", () => {
    const base = items();
    expect(costOnlyChanges(base, base)).toBeNull();
    expect(costOnlyChanges(base, base.map((it) => (it.id === "a" ? { ...it, unitCost: 1, unitPrice: 1 } : it)))).toBeNull();
    expect(costOnlyChanges(base, base.map((it) => (it.id === "b" ? { ...it, unitCost: 1, qty: 3 } : it)))).toBeNull();
    expect(costOnlyChanges(base, base.slice(0, 1))).toBeNull();
  });
});

describe("updateQuoteCostsSchema", () => {
  it("valida centavos enteros, no negativos y sin líneas repetidas", () => {
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [{ itemId: "a", unitCost: 90000 }] }).success).toBe(true);
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [{ itemId: "a", unitCost: -1 }] }).success).toBe(false);
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [{ itemId: "a", unitCost: 1.5 }] }).success).toBe(false);
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [] }).success).toBe(false);
    expect(updateQuoteCostsSchema.safeParse({ quoteId: "q", costs: [{ itemId: "a", unitCost: 1 }, { itemId: "a", unitCost: 2 }] }).success).toBe(false);
  });
});
