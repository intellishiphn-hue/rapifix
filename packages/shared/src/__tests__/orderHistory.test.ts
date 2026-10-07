import { describe, expect, it } from "vitest";
import {
  deliveredMs, filterHistory, groupHistory, historyDayLabel, historyTechnicians, isRecentlyDelivered, matchesHistorySearch,
  shopDays, summarizeHistory, type HistoryOrder,
} from "../orderHistory";

const ts = (iso: string | number) => {
  const d = new Date(iso);
  return { toDate: () => d, toMillis: () => d.getTime() };
};
const H = 3_600_000;

let n = 0;
function order(p: Partial<HistoryOrder> & { delivered?: string | null; created?: string; total?: number }): HistoryOrder {
  n++;
  const total = p.total ?? 100_000;
  const paid = p.paid ?? total;
  return {
    id: `o${n}`, code: `OT-${1000 + n}`, type: "repair",
    customerId: "c1", customer: { fullName: "José Martínez Núñez", phone: "+50499887766", whatsapp: "+50499887766" },
    vehicleId: "v1", vehicle: { make: "Toyota", model: "Hilux", year: 2019, color: "Blanco", plate: "HAB1234" },
    technicianIds: ["t1"], technicians: [{ id: "t1", name: "Carlos Mejía" }],
    totals: { subtotal: total, discount: 0, tax: 0, total }, paid, balance: total - paid,
    createdAt: ts(p.created ?? "2026-10-01T15:00:00Z"),
    updatedAt: ts("2026-10-05T18:00:00Z"), statusChangedAt: ts("2026-10-05T18:00:00Z"),
    deliveredAt: p.delivered === null ? null : ts(p.delivered ?? "2026-10-05T18:00:00Z"),
    ...p,
  } as HistoryOrder;
}

describe("entregadas en el tablero (24 horas)", () => {
  const now = new Date("2026-10-06T18:00:00Z").getTime();
  it("se queda mientras no cumpla 24 horas", () => {
    expect(isRecentlyDelivered(order({ delivered: new Date(now - 23 * H).toISOString() }), now)).toBe(true);
    expect(isRecentlyDelivered(order({ delivered: new Date(now - 60_000).toISOString() }), now)).toBe(true);
  });
  it("sale al cumplir 24 horas", () => {
    expect(isRecentlyDelivered(order({ delivered: new Date(now - 24 * H).toISOString() }), now)).toBe(false);
    expect(isRecentlyDelivered(order({ delivered: "2026-09-01T12:00:00Z" }), now)).toBe(false);
  });
  it("sin deliveredAt usa el cambio de estado y luego la última edición", () => {
    const a = order({ delivered: null, statusChangedAt: ts(now - 2 * H) });
    expect(deliveredMs(a)).toBe(now - 2 * H);
    expect(isRecentlyDelivered(a, now)).toBe(true);
    const b = order({ delivered: null, statusChangedAt: undefined as never, updatedAt: ts(now - 30 * H) });
    expect(deliveredMs(b)).toBe(now - 30 * H);
    expect(isRecentlyDelivered(b, now)).toBe(false);
  });
});

describe("días en taller", () => {
  it("cuenta días completos entre ingreso y entrega", () => {
    expect(shopDays(order({ created: "2026-10-01T15:00:00Z", delivered: "2026-10-05T18:00:00Z" }))).toBe(4);
    expect(shopDays(order({ created: "2026-10-05T14:00:00Z", delivered: "2026-10-05T23:00:00Z" }))).toBe(0);
  });
  it("nunca es negativo", () => expect(shopDays(order({ created: "2026-10-06T00:00:00Z", delivered: "2026-10-05T00:00:00Z" }))).toBe(0));
});

describe("búsqueda", () => {
  const o = order({});
  it("ignora tildes y mayúsculas", () => {
    expect(matchesHistorySearch(o, "jose martinez")).toBe(true);
    expect(matchesHistorySearch(o, "NUÑEZ")).toBe(true);
    expect(matchesHistorySearch(o, "nunez")).toBe(true);
  });
  it("placa con o sin guion", () => {
    expect(matchesHistorySearch(o, "hab-1234")).toBe(true);
    expect(matchesHistorySearch(o, "HAB 1234")).toBe(true);
    expect(matchesHistorySearch(o, "b123")).toBe(true);
  });
  it("teléfono con espacios o guiones", () => {
    expect(matchesHistorySearch(o, "9988-7766")).toBe(true);
    expect(matchesHistorySearch(o, "9988 7766")).toBe(true);
    expect(matchesHistorySearch(o, "887766")).toBe(true);
  });
  it("marca, modelo y código", () => {
    expect(matchesHistorySearch(o, "hilux")).toBe(true);
    expect(matchesHistorySearch(o, "toyota hilux 2019")).toBe(true);
    expect(matchesHistorySearch(o, o.code.toLowerCase())).toBe(true);
    expect(matchesHistorySearch(o, o.code.replace("-", " "))).toBe(true);
  });
  it("todas las palabras deben coincidir", () => {
    expect(matchesHistorySearch(o, "jose corolla")).toBe(false);
    expect(matchesHistorySearch(o, "pedro")).toBe(false);
  });
  it("vacío deja pasar todo", () => expect(matchesHistorySearch(o, "   ")).toBe(true));
});

describe("filtros", () => {
  const list = [
    order({ total: 100_000, paid: 100_000 }),
    order({ total: 200_000, paid: 50_000, type: "maintenance", technicianIds: ["t2"], technicians: [{ id: "t2", name: "Ana López" }] }),
    order({ total: 0, paid: 0, technicianIds: [], technicians: [] }),
  ];
  it("estado de pago", () => {
    expect(filterHistory(list, { payment: "paid" })).toHaveLength(2);
    expect(filterHistory(list, { payment: "balance" }).map((o) => o.totals.total)).toEqual([200_000]);
  });
  it("técnico y sin técnico", () => {
    expect(filterHistory(list, { technicianId: "t2" })).toHaveLength(1);
    expect(filterHistory(list, { technicianId: "none" })).toHaveLength(1);
  });
  it("tipo de trabajo y combinación con texto", () => {
    expect(filterHistory(list, { type: "maintenance" })).toHaveLength(1);
    expect(filterHistory(list, { type: "maintenance", search: "hilux", payment: "balance" })).toHaveLength(1);
    expect(filterHistory(list, { type: "maintenance", search: "corolla" })).toHaveLength(0);
  });
  it("lista de técnicos sin repetir, ordenada", () => {
    expect(historyTechnicians(list).map((t) => t.name)).toEqual(["Ana López", "Carlos Mejía"]);
  });
});

describe("resumen", () => {
  it("suma facturado, cobrado, saldo, ticket y días promedio", () => {
    const s = summarizeHistory([
      order({ total: 100_000, paid: 100_000, created: "2026-10-01T12:00:00Z", delivered: "2026-10-03T12:00:00Z" }),
      order({ total: 200_000, paid: 50_000, created: "2026-10-01T12:00:00Z", delivered: "2026-10-02T00:00:00Z" }),
    ]);
    expect(s).toEqual({ count: 2, billed: 300_000, collected: 150_000, balance: 150_000, withBalance: 1, avgTicket: 150_000, avgDays: 1.3 });
  });
  it("sin órdenes no divide entre cero", () => {
    expect(summarizeHistory([])).toEqual({ count: 0, billed: 0, collected: 0, balance: 0, withBalance: 0, avgTicket: 0, avgDays: null });
  });
  it("saldo negativo (pago de más) no resta", () => {
    expect(summarizeHistory([order({ total: 100_000, paid: 120_000 })]).balance).toBe(0);
  });
});

describe("agrupar", () => {
  // 6 de octubre de 2026, 10:00 a. m. en Honduras
  const now = new Date("2026-10-06T16:00:00Z").getTime();
  it("etiquetas de día", () => {
    expect(historyDayLabel("2026-10-06", now)).toBe("Hoy");
    expect(historyDayLabel("2026-10-05", now)).toBe("Ayer");
    expect(historyDayLabel("2026-10-03", now)).toBe("sábado 3 de octubre");
    expect(historyDayLabel("2025-12-31", now)).toBe("miércoles 31 de diciembre de 2025");
  });
  it("el día se corta a medianoche de Honduras, no de UTC", () => {
    const groups = groupHistory([
      order({ delivered: "2026-10-06T05:30:00Z" }), // 11:30 p. m. del 5 en Honduras
      order({ delivered: "2026-10-06T06:30:00Z" }), // 12:30 a. m. del 6
      order({ delivered: "2026-10-06T15:00:00Z" }),
    ], "day", now);
    expect(groups.map((g) => [g.label, g.count])).toEqual([["Hoy", 2], ["Ayer", 1]]);
    expect(groups[0]!.orders[0]!.deliveredAt!.toMillis()).toBeGreaterThan(groups[0]!.orders[1]!.deliveredAt!.toMillis());
  });
  it("por cliente: visitas y total gastado", () => {
    const other = { customerId: "c2", customer: { fullName: "María Paz", phone: "+50433221100", whatsapp: "" } };
    const groups = groupHistory([
      order({ total: 100_000 }), order({ total: 50_000, ...other }), order({ total: 250_000, paid: 0 }),
    ], "customer", now);
    expect(groups[0]).toMatchObject({ label: "José Martínez Núñez", count: 2, total: 350_000, balance: 250_000 });
    expect(groups[1]).toMatchObject({ label: "María Paz", count: 1, total: 50_000 });
  });
  it("por vehículo: historial de un carro", () => {
    const groups = groupHistory([
      order({}), order({}),
      order({ vehicleId: "v2", vehicle: { make: "Honda", model: "CR-V", year: 2015, color: "", plate: "PDC4455" } }),
    ], "vehicle", now);
    expect(groups.map((g) => [g.label, g.plate, g.count])).toEqual([["Toyota Hilux 2019", "HAB1234", 2], ["Honda CR-V 2015", "PDC4455", 1]]);
  });
});
