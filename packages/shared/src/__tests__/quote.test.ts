import { describe, expect, it } from "vitest";
import { computeQuote } from "../quote";

const line = (o: Partial<Parameters<typeof computeQuote>[0][number]>) => ({
  id: "1", type: "part" as const, description: "x", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true, ...o,
});

describe("computeQuote", () => {
  it("calcula ISV 15% sobre la base con descuento", () => {
    const r = computeQuote([line({ qty: 2, unitPrice: 50000, discount: 10000 }), line({ id: "2", type: "labor", unitPrice: 80000 })], 15);
    expect(r.items[0]!.lineTotal).toBe(90000);
    expect(r.totals).toEqual({ subtotal: 180000, discount: 10000, tax: 25500, total: 195500 });
  });
  it("no aplica ISV a líneas exentas y limita el descuento", () => {
    const r = computeQuote([line({ unitPrice: 10000, discount: 50000, taxable: false })], 15);
    expect(r.items[0]!.lineTotal).toBe(0);
    expect(r.totals.tax).toBe(0);
  });
});
