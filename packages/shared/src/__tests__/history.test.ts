import { describe, expect, it } from "vitest";
import {
  historyBookingUrl, buildHistoryView, fitHistorySize, historyBytes, historyLinkAlive, HISTORY_TOKEN_RE, parsePublicHistory, sortByUrgency, utf8Bytes,
  type HistoryRaw, type RawHistoryOrder, type RawHistoryQuote,
} from "../index";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 18); // 30 oct 2026, 12:00 en Honduras

const workshop = { name: "RAPIFIX", logoUrl: "", phone: "", whatsapp: "+50492854852", address: "Blvd. CEE", city: "Tegucigalpa", hours: "" };

function order(id: string, extra: Partial<RawHistoryOrder> = {}): RawHistoryOrder {
  return {
    id, code: `OT-${id}`, status: "DELIVERED", customerId: "c1", vehicleId: "v1", createdAt: NOW - 40 * DAY, deliveredAt: NOW - 38 * DAY,
    mileageIn: 45200, mileageOut: 45210, mileageUnit: "km", totals: { total: 250000 }, paid: 250000, balance: 0, portalToken: `TOK${id}`,
    activeQuoteId: `q-${id}`,
    // campos internos que NUNCA deben salir
    notes: "nota interna del taller", cancelReason: "", technicians: [{ id: "t1", name: "Técnico Secreto" }],
    ...extra,
  };
}

function quote(id: string, orderId: string | null, extra: Partial<RawHistoryQuote> = {}): RawHistoryQuote {
  return {
    id, code: `COT-${id}`, status: "approved", orderId, vehicleId: "v1", customerId: "c1", createdAt: NOW - 39 * DAY,
    items: [
      { type: "labor", description: "Cambio de pastillas delanteras", qty: 1, unitCost: 11111, unitPrice: 80000, techPay: [{ employeeId: "t1", mode: "percent", value: 30 }] },
      { type: "service", description: "Alineación", qty: 1, unitCost: 22222, unitPrice: 50000 },
      { type: "part", description: "Pastillas Bosch", qty: 2, unitCost: 33333, unitPrice: 60000, productId: "p1" },
    ],
    totals: { total: 250000 },
    notes: "margen 45% no decirle",
    ...extra,
  };
}

function raw(extra: Partial<HistoryRaw> = {}): HistoryRaw {
  return {
    kind: "customer", ownerId: "c1", name: "Ana Martínez", now: NOW, workshop,
    vehicles: [
      { id: "v1", plate: "HAB1234", make: "Toyota", model: "Hilux", year: 2019, color: "Blanco", mileage: 45210, odometerUnit: "km", customerId: "c1", archived: false, vin: "SECRETVIN" },
      { id: "v2", plate: "PCD5678", make: "Honda", model: "CR-V", year: 2017, color: "Gris", mileage: 28100, odometerUnit: "mi", customerId: "c1", archived: false },
      { id: "v3", plate: "OLD0001", make: "Nissan", model: "Sentra", year: 2010, customerId: "c1", archived: true },
    ],
    orders: [order("1"), order("2", { status: "IN_REPAIR", isOpen: true, deliveredAt: null, createdAt: NOW - 2 * DAY, totals: { total: 100000 }, paid: 0, balance: 100000, activeQuoteId: null })],
    quotes: [quote("q-1", "1"), quote("q-open", null, { status: "sent", publicToken: "DIRECTTOKEN", sentAt: NOW - DAY, totals: { total: 70000 } })],
    payments: [
      { id: "p1", code: "REC-0001", amount: 250000, method: "card", status: "valid", orderId: "1", at: NOW - 38 * DAY, reference: "AUTH-SECRET", receivedByName: "Cajera" },
      { id: "p2", code: "REC-0002", amount: 9999, method: "cash", status: "voided", orderId: "1", at: NOW - 38 * DAY },
    ],
    maintenance: [
      { id: "m1", vehicleId: "v1", serviceName: "Cambio de aceite", status: "upcoming", dueDate: NOW + 60 * DAY, nextMileage: 50210, odometerUnit: "km", notes: "interno" },
      { id: "m2", vehicleId: "v1", serviceName: "Rotación de llantas", status: "overdue", dueDate: NOW - 5 * DAY },
      { id: "m3", vehicleId: "v1", serviceName: "Frenos", status: "done" },
    ],
    washes: [
      { id: "w1", code: "LAV-0001", plate: "HAB1234", status: "delivered", total: 15000, paid: true, items: [{ name: "Lavado completo", kind: "wash", commission: 1500 }], createdAt: NOW - 3 * DAY, deliveredAt: NOW - 3 * DAY, payToken: "WASHTOKEN1", washerName: "Lavador X" },
      { id: "w2", code: "LAV-0002", plate: "HAB1234", status: "cancelled", total: 15000, createdAt: NOW - 4 * DAY },
      { id: "w3", code: "LAV-0003", plate: "HAB1234", customerId: "otro", status: "delivered", total: 15000, createdAt: NOW - 400 * DAY },
    ],
    loyalty: [{ plate: "HAB1234", exists: true, count: 6, rewardsAvailable: 0 }],
    memberships: [],
    carwash: { loyaltyEvery: 10, loyaltyStartStamps: 0 },
    ...extra,
  };
}

describe("buildHistoryView: seguridad", () => {
  it("no saca costos, pago a técnicos, comisiones, notas internas ni datos de pago privados", () => {
    const json = JSON.stringify(buildHistoryView(raw()));
    expect(json).not.toMatch(/unitCost|unitPrice|techPay|commission|11111|22222|33333/);
    expect(json).not.toMatch(/nota interna|margen 45|interno|Técnico Secreto|technicians/);
    expect(json).not.toMatch(/AUTH-SECRET|reference|Cajera|SECRETVIN|Lavador X|washerName|customerId|ownerId/);
  });

  it("no muestra vehículos archivados ni de otro dueño, ni lavados de otra persona con la misma placa", () => {
    const v = buildHistoryView(raw({ vehicles: [...raw().vehicles, { id: "v9", plate: "XYZ999", customerId: "otro" }] }));
    expect(v.vehicles.map((x) => x.plate)).toEqual(["HAB1234", "PCD5678"]);
    expect(v.vehicles[0]!.washes.map((w) => w.code)).toEqual(["LAV-0001"]);
  });

  it("no muestra órdenes de un dueño anterior del mismo vehículo ni canceladas", () => {
    const v = buildHistoryView(raw({ orders: [order("1"), order("3", { customerId: "dueño-anterior" }), order("4", { status: "CANCELLED" })] }));
    expect(v.vehicles[0]!.visits.map((x) => x.code)).toEqual(["OT-1"]);
  });

  it("un vehículo de empresa no sale en el historial del chofer", () => {
    const base = raw();
    const v = buildHistoryView({ ...base, vehicles: base.vehicles.map((x) => (x.id === "v2" ? { ...x, companyId: "e1" } : x)) });
    expect(v.vehicles.map((x) => x.plate)).toEqual(["HAB1234"]);
  });
});

describe("buildHistoryView: contenido", () => {
  const v = buildHistoryView(raw());
  const hilux = v.vehicles[0]!;

  it("visitas en orden descendente, la abierta marcada en el taller", () => {
    expect(hilux.visits.map((x) => [x.code, x.state])).toEqual([["OT-2", "in_shop"], ["OT-1", "delivered"]]);
  });

  it("trabajos y repuestos de la cotización aprobada, con pagos válidos y link de la orden", () => {
    const done = hilux.visits[1]!;
    expect(done.work).toEqual([{ d: "Cambio de pastillas delanteras", q: 1 }, { d: "Alineación", q: 1 }]);
    expect(done.parts).toEqual([{ d: "Pastillas Bosch", q: 2 }]);
    expect(done.total).toBe(250000);
    expect(done.balance).toBe(0);
    expect(done.payments).toEqual([{ code: "REC-0001", amount: 250000, method: "Tarjeta", at: NOW - 38 * DAY }]);
    expect(done.link).toBe("/orden/TOK1");
    expect(done.linkUntil).toBe(NOW - 38 * DAY + 30 * DAY);
    expect(historyLinkAlive(done, NOW)).toBe(false); // entregada hace 38 días: el portal ya venció
    expect(historyLinkAlive(hilux.visits[0]!, NOW)).toBe(true);
  });

  it("odómetro con su unidad", () => {
    expect(v.vehicles[1]!.unit).toBe("mi");
    expect(hilux.visits[1]!.mileageIn).toBe(45200);
  });

  it("próximos mantenimientos: vencidos primero, sin los realizados", () => {
    expect(hilux.maintenance.map((m) => [m.service, m.status])).toEqual([["Rotación de llantas", "overdue"], ["Cambio de aceite", "upcoming"]]);
  });

  it("cotización abierta con su link y lavados con la tarjeta de lealtad", () => {
    expect(hilux.quotes).toEqual([expect.objectContaining({ code: "COT-q-open", link: "/orden/DIRECTTOKEN/cotizacion", total: 70000 })]);
    expect(hilux.washes).toEqual([expect.objectContaining({ code: "LAV-0001", services: ["Lavado completo"], link: "/lavado/WASHTOKEN1", paid: true })]);
    expect(hilux.loyalty).toEqual({ count: 6, every: 10, rewardsAvailable: 0 });
  });

  it("resumen: visitas y gasto del año y saldo pendiente", () => {
    expect(v.summary.visitsYear).toBe(2);
    expect(v.summary.spentYear).toBe(350000);
    expect(v.summary.balance).toBe(100000);
    expect(v.summary.termsLabel).toBeNull();
  });

  it("membresía activa de la placa", () => {
    const withM = buildHistoryView(raw({
      memberships: [{ id: "m", code: "MEM-0001", plate: "HAB1234", planName: "Ilimitado", status: "active", periodStart: NOW - 10 * DAY, periodEnd: NOW + 20 * DAY, paidUntil: NOW + 20 * DAY, usedInPeriod: 3, plan: { washesPerMonth: 4 }, totalPaid: 99999 }],
    }));
    expect(withM.vehicles[0]!.membership).toEqual(expect.objectContaining({ planName: "Ilimitado", washesPerMonth: 4, usedInPeriod: 3 }));
    expect(JSON.stringify(withM)).not.toMatch(/99999|totalPaid/);
  });
});

describe("buildHistoryView: empresa (flotilla)", () => {
  const vehicles = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, plate: `FLT00${i}`, make: "Toyota", model: "Hilux", year: 2020, mileage: 10000 * (i + 1), companyId: "e1", customerId: `chofer${i}` }));
  const orders: RawHistoryOrder[] = [
    order("a", { vehicleId: "f0", companyId: "e1", customerId: "chofer0", totals: { total: 100000 }, paid: 0, balance: 100000, deliveredAt: NOW - 60 * DAY, createdAt: NOW - 61 * DAY }),
    order("b", { vehicleId: "f1", companyId: "e1", customerId: "chofer1", totals: { total: 50000 }, paid: 0, balance: 50000, deliveredAt: NOW - 2 * DAY, createdAt: NOW - 3 * DAY }),
    order("c", { vehicleId: "f2", companyId: "e1", customerId: "chofer2", totals: { total: 80000 }, paid: 80000, balance: 0, createdAt: Date.UTC(2025, 5, 1), deliveredAt: Date.UTC(2025, 5, 2) }),
    order("x", { vehicleId: "f3", companyId: null, customerId: "chofer3" }), // trabajo personal del chofer: no es de la empresa
  ];
  const v = buildHistoryView(raw({
    kind: "company", ownerId: "e1", name: "Transportes del Norte", vehicles, orders, quotes: [], payments: [], washes: [], loyalty: [],
    terms: { paymentTerms: "credit", creditDays: 30 },
    maintenance: [
      { id: "1", vehicleId: "f4", serviceName: "Aceite", status: "due", dueDate: NOW + 5 * DAY },
      { id: "2", vehicleId: "f5", serviceName: "Frenos", status: "overdue", dueDate: NOW - 10 * DAY },
      { id: "3", vehicleId: "f0", serviceName: "Llantas", status: "upcoming", dueDate: NOW + 90 * DAY },
      { id: "4", vehicleId: "f1", serviceName: "Batería", status: "overdue", dueDate: NOW - 30 * DAY },
    ],
  }));

  it("totales de la flota: unidades, visitas y gasto del año, saldo y vencido según crédito", () => {
    expect(v.summary.vehicles).toBe(6);
    expect(v.summary.visitsYear).toBe(2);
    expect(v.summary.spentYear).toBe(150000);
    expect(v.summary.balance).toBe(150000);
    expect(v.summary.overdue).toBe(100000); // entregada hace 60 días con crédito 30: vencida
    expect(v.summary.termsLabel).toBe("Crédito 30 días");
    expect(v.vehicles.find((x) => x.plate === "FLT003")!.visits).toEqual([]);
  });

  it("próximos mantenimientos de toda la flota por urgencia", () => {
    expect(v.summary.upcoming.map((u) => [u.plate, u.service])).toEqual([
      ["FLT001", "Batería"], ["FLT005", "Frenos"], ["FLT004", "Aceite"], ["FLT000", "Llantas"],
    ]);
  });
});

describe("tamaño, lectura y utilidades", () => {
  it("recorta lavados y visitas viejas si el documento es muy grande", () => {
    const many = Array.from({ length: 50 }, (_, i) => order(`o${i}`, { createdAt: NOW - (i + 1) * DAY, deliveredAt: NOW - i * DAY }));
    const quotes = many.map((o) => quote(`q-${o.id}`, o.id, { items: Array.from({ length: 40 }, (_, k) => ({ type: "part", description: `Repuesto número ${k} con descripción larga para ocupar espacio`, qty: 1 })) }));
    const v = buildHistoryView(raw({ orders: many, quotes }));
    expect(v.truncated).toBe(false);
    const small = fitHistorySize(v, 60_000);
    expect(small.truncated).toBe(true);
    expect(historyBytes(small)).toBeLessThanOrEqual(60_000);
    expect(small.vehicles[0]!.visits.length).toBeGreaterThanOrEqual(5);
    expect(small.vehicles[0]!.visits[0]!.code).toBe("OT-o0"); // quedan las más recientes
  });

  it("utf8Bytes cuenta tildes y emojis", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("ñ")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("🚗")).toBe(4);
  });

  it("parsePublicHistory limpia datos raros y descarta links que no son del portal", () => {
    const p = parsePublicHistory({ kind: "company", name: 5, vehicles: [{ plate: "A1", visits: [{ code: "OT-1", link: "https://evil.example/x", total: "9" }], quotes: [{ code: "C", link: "javascript:alert(1)" }] }] });
    expect(p.kind).toBe("company");
    expect(p.name).toBe("");
    expect(p.vehicles[0]!.visits[0]!.link).toBeNull();
    expect(p.vehicles[0]!.visits[0]!.total).toBe(0);
    expect(p.vehicles[0]!.quotes).toEqual([]);
    const ok = parsePublicHistory(buildHistoryView(raw()));
    expect(ok.vehicles[0]!.visits[1]!.link).toBe("/orden/TOK1");
  });

  it("token, orden por urgencia y motivo para agendar", () => {
    expect(HISTORY_TOKEN_RE.test("ABCDEFGHJKMNPQRSTUVWXYZ2")).toBe(true);
    expect(HISTORY_TOKEN_RE.test("abc")).toBe(false);
    expect(sortByUrgency([{ status: "upcoming", dueAt: 1 }, { status: "overdue", dueAt: 5 }, { status: "due", dueAt: null }]).map((x) => x.status)).toEqual(["overdue", "due", "upcoming"]);
    const url = historyBookingUrl({ service: "Cambio de aceite", plate: "HAB1234", vehicle: "Toyota Hilux 2019" });
    expect(url.startsWith("/agendar?motivo=mantenimiento&")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect([q.get("placa"), q.get("vehiculo"), q.get("detalle")]).toEqual(["HAB1234", "Toyota Hilux 2019", "Cambio de aceite"]);
  });
});
