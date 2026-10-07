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

import { balanceAfter, consumedByItem, diffQuotes, newVersionSchema, publicDiff, QUOTE_STATUS_META, quoteStatusLabel, stockImpact, stockNoticeText } from "../quote";

const q = (items: Array<Partial<Parameters<typeof computeQuote>[0][number]>>) => computeQuote(items.map((i) => line(i)), 15);

describe("diffQuotes", () => {
  const prev = q([
    { id: "a", type: "labor", description: "Cambio de pastillas", unitPrice: 80000 },
    { id: "b", productId: "p1", description: "Pastillas delanteras", unitPrice: 120000 },
    { id: "c", description: "Líquido de frenos", unitPrice: 30000 },
  ]);
  it("sin cambios", () => {
    const d = diffQuotes(prev, prev);
    expect(d.hasChanges).toBe(false);
    expect(d.unchanged).toBe(3);
    expect(d.difference).toBe(0);
  });
  it("detecta agregadas, quitadas y modificadas por id", () => {
    const next = q([
      { id: "a", type: "labor", description: "Cambio de pastillas", unitPrice: 80000 },
      { id: "b", productId: "p1", description: "Pastillas delanteras", unitPrice: 120000, qty: 2 },
      { id: "z", productId: "p9", description: "Disco de freno", unitPrice: 200000 },
    ]);
    const d = diffQuotes(prev, next);
    expect(d.added.map((i) => i.id)).toEqual(["z"]);
    expect(d.removed.map((i) => i.id)).toEqual(["c"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]!.fields).toEqual(["qty"]);
    expect(d.unchanged).toBe(1);
    expect(d.previousTotal).toBe(prev.totals.total);
    expect(d.difference).toBe(next.totals.total - prev.totals.total);
    expect(d.difference).toBeGreaterThan(0);
    expect(d.hasChanges).toBe(true);
  });
  it("si el id cambió, empareja por producto y descripción (sin importar tildes ni mayúsculas)", () => {
    const next = q([
      { id: "n1", type: "labor", description: "cambio de pastillas", unitPrice: 90000 },
      { id: "n2", productId: "p1", description: "PASTILLAS DELANTERAS", unitPrice: 120000 },
      { id: "n3", description: "Liquido de frenos", unitPrice: 30000 },
    ]);
    const d = diffQuotes(prev, next);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed.map((c) => c.before.id).sort()).toEqual(["a", "b", "c"]);
    expect(d.changed.find((c) => c.before.id === "a")!.fields).toContain("unitPrice");
  });
  it("mismo texto pero otro producto no se empareja", () => {
    const next = q([{ id: "n", productId: "p2", description: "Pastillas delanteras", unitPrice: 120000 }]);
    const d = diffQuotes(q([{ id: "b", productId: "p1", description: "Pastillas delanteras", unitPrice: 120000 }]), next);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
  });
  it("líneas repetidas: cada una se empareja una sola vez", () => {
    const a = q([{ id: "1", description: "Tornillo", unitPrice: 100 }, { id: "2", description: "Tornillo", unitPrice: 100 }]);
    const b = q([{ id: "x", description: "Tornillo", unitPrice: 100 }]);
    const d = diffQuotes(a, b);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toHaveLength(0);
  });
  it("detecta cambio de descuento y diferencia negativa", () => {
    const next = q([
      { id: "a", type: "labor", description: "Cambio de pastillas", unitPrice: 80000, discount: 10000 },
      { id: "b", productId: "p1", description: "Pastillas delanteras", unitPrice: 120000 },
      { id: "c", description: "Líquido de frenos", unitPrice: 30000 },
    ]);
    const d = diffQuotes(prev, next);
    expect(d.changed[0]!.fields).toEqual(["discount"]);
    expect(d.difference).toBe(-11500);
  });
  it("publicDiff no expone costos ni ids", () => {
    const next = q([{ id: "z", productId: "p9", description: "Disco", unitPrice: 200000, unitCost: 150000 }]);
    const pub = publicDiff(diffQuotes(prev, next));
    expect(Object.keys(pub.added[0]!).sort()).toEqual(["description", "lineTotal", "qty", "type", "unitPrice"]);
    expect(pub.removed).toHaveLength(3);
  });
});

describe("modificación de cotización aprobada: saldo e inventario", () => {
  it("saldo = total nuevo − pagado; saldo a favor si pagó de más", () => {
    expect(balanceAfter(100000, 40000)).toEqual({ balance: 60000, credit: 0 });
    expect(balanceAfter(100000, 130000)).toEqual({ balance: -30000, credit: 30000 });
  });
  it("lee lo descontado por línea desde order.consumed", () => {
    expect(consumedByItem({ q1_a: { qty: 2 }, q1_b_c: { qty: 1 }, q2_a: { qty: 9 } }, "q1")).toEqual({ a: 2, b_c: 1 });
    expect(consumedByItem(undefined, "q1")).toEqual({});
  });
  it("avisa de repuestos ya descontados que se quitan o cambian, y conserva los que siguen", () => {
    const prev = q([
      { id: "a", productId: "p1", description: "Filtro", qty: 1 },
      { id: "b", productId: "p2", description: "Aceite", qty: 4 },
      { id: "c", productId: "p3", description: "Bujía", qty: 4 },
      { id: "d", productId: "p4", description: "Banda", qty: 1 },
      { id: "e", productId: "p5", description: "No descontado", qty: 1 },
    ]).items;
    const next = q([
      { id: "a", productId: "p1", description: "Filtro", qty: 1 },
      { id: "b", productId: "p2", description: "Aceite", qty: 3 },
      { id: "c", productId: "p3", description: "Bujía", qty: 6 },
      { id: "d", productId: "OTRO", description: "Banda de otra marca", qty: 1 },
    ]).items;
    const r = stockImpact(prev, next, { a: 1, b: 4, c: 4, d: 1 });
    expect(r.carry).toEqual(["a", "b", "c"]);
    expect(r.notices.map((n) => [n.kind, n.description])).toEqual([["reduced", "Aceite"], ["increased", "Bujía"], ["removed", "Banda"]]);
    expect(stockNoticeText(r.notices[2]!)).toContain("ya había salido de inventario");
    expect(stockImpact(prev, next, {}).notices).toEqual([]);
  });
  it("estado Reemplazada y etiqueta Descartada", () => {
    expect(QUOTE_STATUS_META.superseded).toEqual({ label: "Reemplazada", tone: "gray" });
    expect(quoteStatusLabel({ status: "expired", discardedAt: new Date() as never })).toBe("Descartada");
    expect(quoteStatusLabel({ status: "expired" })).toBe("Expirada");
  });
  it("el motivo es opcional en el esquema pero mínimo 3 caracteres si viene", () => {
    expect(newVersionSchema.safeParse({ quoteId: "x" }).success).toBe(true);
    expect(newVersionSchema.safeParse({ quoteId: "x", reason: "ab" }).success).toBe(false);
    expect(newVersionSchema.safeParse({ quoteId: "x", reason: "Apareció fuga" }).success).toBe(true);
  });
});
