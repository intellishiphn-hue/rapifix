import { describe, expect, it } from "vitest";
import {
  buildHistoryView, buildVisitDetail, confirmedPayments, DEFAULT_TEMPLATES, historyLinkState, historyVisitDocPath, historyVisitPath,
  HISTORY_LINE_TEXT, orderProgress, parsePublicHistory, parsePublicVisitDetail, pendingProofs, renderTemplate, setTemplateOverrides,
  shouldAutoEnableHistory, templateBody, templateUsesHistory, visitReceipt, withHistoryLine,
  type HistoryRaw, type RawVisitDetail,
} from "../index";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 18);

function detailRaw(extra: Partial<RawVisitDetail> = {}): RawVisitDetail {
  return {
    ownerName: "Ana Martínez",
    order: {
      id: "ord1", code: "OT-1050", status: "DELIVERED", type: "repair", customerId: "c1", vehicleId: "v1",
      createdAt: NOW - 5 * DAY, receivedAt: NOW - 5 * DAY, deliveredAt: NOW - 3 * DAY, mileageIn: 45200, mileageOut: 45215, mileageUnit: "km",
      totals: { total: 322000 }, paid: 200000, balance: 122000, portalToken: "PORTALTOK1", portalEnabled: true, activeQuoteId: "q2",
      reason: "Ruido al frenar",
      vehicle: { make: "Toyota", model: "Hilux", year: 2019, color: "Blanco", plate: "HAB1234" },
      diagnosis: {
        reportedProblem: "Ruido al frenar", technicianDiagnosis: "Pastillas delanteras gastadas al 90%", recommendations: "Cambiar líquido de frenos en 6 meses",
        obdCodes: ["P0300", "<script>"], completedAt: NOW - 4 * DAY,
        // internos: no salen
        testsPerformed: "Prueba de ruta con Carlos", observations: "El cliente se ve apurado",
      },
      // internos de la orden
      notes: "nota interna", technicians: [{ id: "t1", name: "Técnico Secreto" }], cancelReason: "",
    },
    quotes: [
      { id: "q1", code: "COT-0001", status: "superseded", orderId: "ord1", items: [{ type: "labor", description: "Versión vieja", qty: 1, unitPrice: 1, lineTotal: 1 }] },
      {
        id: "q2", code: "COT-0002", status: "approved", orderId: "ord1", taxRate: 15, notes: "margen 40% no decirle",
        coupon: { code: "BIENVENIDO", name: "Bienvenida", discount: 10, redemptionId: "secret-redemption" } as never,
        items: [
          { type: "labor", description: "Cambio de pastillas", qty: 1, unitPrice: 80000, discount: 0, lineTotal: 72000, couponDiscount: 8000, unitCost: 11111, techPay: [{ employeeId: "t1", mode: "percent", value: 30 }] },
          { type: "part", description: "Pastillas Bosch", qty: 2, unitPrice: 100000, discount: 10000, lineTotal: 190000, couponDiscount: 0, unitCost: 33333, productId: "p1" },
        ],
        totals: { subtotal: 280000, discount: 18000, couponDiscount: 8000, tax: 40000, total: 322000 },
      },
      { id: "q3", code: "COT-0003", status: "sent", orderId: "ord1", items: [] },
    ],
    payments: [
      { id: "p2", code: "REC-0011", amount: 50000, method: "transfer", status: "valid", orderId: "ord1", at: NOW - 3 * DAY, reference: "REF-SECRETA", bank: "BAC 1234", receivedByName: "Cajera María" },
      { id: "p1", code: "REC-0010", amount: 150000, method: "card", status: "valid", orderId: "ord1", at: NOW - 4 * DAY, reference: "AUTH-SECRET" },
      { id: "p3", code: "REC-0012", amount: 9999, method: "cash", status: "voided", orderId: "ord1", at: NOW - 3 * DAY },
      { id: "p4", code: "REC-0099", amount: 7777, method: "cash", status: "valid", orderId: "otra", at: NOW - 3 * DAY },
    ],
    events: [
      { at: NOW - 5 * DAY, text: "Vehículo recibido. Motivo: Ruido al frenar", visibleToCustomer: true, actorName: "Recepcionista Luis" },
      { at: NOW - 4 * DAY, text: "Nota interna: cliente pide descuento", visibleToCustomer: false },
      { at: NOW - 4 * DAY + 1000, text: "Iniciamos la reparación (demo)", visibleToCustomer: true },
    ],
    photos: [
      { url: "https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=1", caption: "Pastillas viejas", stage: "before", visibleToCustomer: true, at: NOW - 4 * DAY },
      { url: "https://firebasestorage.googleapis.com/v0/b/x/o/b.jpg?alt=media&token=2", caption: "Interna", stage: "during", visibleToCustomer: false },
      { url: "javascript:alert(1)", caption: "mala", visibleToCustomer: true },
    ],
    proofs: [
      { status: "pending", amount: 122000, method: "transfer", createdAt: NOW - DAY, reference: "REF-CLIENTE", bank: "Atlántida", receiptPath: "secret/path.jpg" },
      { status: "approved", amount: 50000, createdAt: NOW - 3 * DAY },
      { status: "rejected", amount: 1000, createdAt: NOW - 2 * DAY },
    ],
    ...extra,
  };
}

describe("detalle de visita (publicHistory/{token}/visits/{orderId})", () => {
  it("no saca campos internos (costos, pago a técnicos, notas, personal, referencias, pruebas, observaciones)", () => {
    const d = buildVisitDetail(detailRaw());
    const json = JSON.stringify(d);
    for (const secret of [
      "unitCost", "11111", "33333", "techPay", "employeeId", "margen", "nota interna", "Técnico Secreto", "Cajera", "Recepcionista",
      "REF-SECRETA", "AUTH-SECRET", "BAC 1234", "REF-CLIENTE", "Atlántida", "secret/path", "Prueba de ruta", "apurado", "testsPerformed",
      "observations", "secret-redemption", "productId", "Nota interna", "Versión vieja", "javascript", "Interna", "REC-0099", "PORTALTOK1/cotizacion",
    ]) expect(json, secret).not.toContain(secret);
  });

  it("toma la cotización aprobada vigente con precios, descuentos, cupón e ISV como la vio el cliente", () => {
    const q = buildVisitDetail(detailRaw()).quote!;
    expect(q.code).toBe("COT-0002");
    expect(q.lines).toEqual([
      { kind: "Mano de obra", part: false, d: "Cambio de pastillas", q: 1, unitPrice: 80000, discount: 0, total: 80000 },
      { kind: "Repuesto", part: true, d: "Pastillas Bosch", q: 2, unitPrice: 100000, discount: 10000, total: 190000 },
    ]);
    expect(q).toMatchObject({ subtotal: 280000, discount: 10000, coupon: { code: "BIENVENIDO", name: "Bienvenida", amount: 8000 }, tax: 40000, taxRate: 15, total: 322000 });
  });

  it("separa pagos confirmados (con recibo) de comprobantes en revisión; los anulados no cuentan", () => {
    const d = buildVisitDetail(detailRaw());
    expect(d.payments.map((p) => p.code)).toEqual(["REC-0010", "REC-0011"]);
    expect(d.payments[0]).toEqual({ code: "REC-0010", at: NOW - 4 * DAY, method: "Tarjeta", amount: 150000 });
    expect(d.pending).toEqual([{ at: NOW - DAY, amount: 122000, method: "Transferencia" }]);
    expect(d).toMatchObject({ total: 322000, paid: 200000, balance: 122000 });
    expect(pendingProofs([{ status: "approved", amount: 5 }, { status: "rejected", amount: 5 }])).toEqual([]);
    expect(confirmedPayments([{ id: "x", code: "R", amount: 0, status: "valid", orderId: "o" }], "o")).toEqual([]);
  });

  it("recibo por pago: lo pagado hasta ese pago y el saldo que quedó", () => {
    const d = buildVisitDetail(detailRaw());
    expect(visitReceipt(d, "REC-0010")).toMatchObject({ paidToDate: 150000, balanceAfter: 172000, number: 1, of: 2 });
    expect(visitReceipt(d, "REC-0011")).toMatchObject({ paidToDate: 200000, balanceAfter: 122000, number: 2 });
    expect(visitReceipt(d, "REC-0099")).toBeNull();
  });

  it("diagnóstico y recomendaciones solo cuando el diagnóstico está completado; OBD válidos", () => {
    const d = buildVisitDetail(detailRaw());
    expect(d.diagnosis).toEqual({ summary: "Pastillas delanteras gastadas al 90%", obdCodes: ["P0300"], recommendations: "Cambiar líquido de frenos en 6 meses" });
    expect(d.reported).toBe("Ruido al frenar");
    const draft = detailRaw();
    draft.order.diagnosis = { ...draft.order.diagnosis!, completedAt: null };
    expect(buildVisitDetail(draft).diagnosis).toBeNull();
  });

  it("solo fotos y actualizaciones visibles al cliente, en orden de fecha", () => {
    const d = buildVisitDetail(detailRaw());
    expect(d.photos).toHaveLength(1);
    expect(d.photos[0]).toMatchObject({ caption: "Pastillas viejas", stage: "before" });
    expect(d.timeline.map((e) => e.text)).toEqual(["Vehículo recibido. Motivo: Ruido al frenar", "Iniciamos la reparación"]);
  });

  it("encabezado: fechas, kilometraje con unidad, vehículo, link del portal y su vencimiento", () => {
    const d = buildVisitDetail(detailRaw());
    expect(d).toMatchObject({
      id: "ord1", code: "OT-1050", state: "delivered", statusLabel: "Entregado", progress: 100, typeLabel: "Reparación", warranty: false,
      inAt: NOW - 5 * DAY, outAt: NOW - 3 * DAY, mileageIn: 45200, mileageOut: 45215, unit: "km",
      vehicle: { plate: "HAB1234", make: "Toyota", model: "Hilux", year: 2019, color: "Blanco" }, ownerName: "Ana Martínez",
      link: "/orden/PORTALTOK1", linkUntil: NOW - 3 * DAY + 30 * DAY,
    });
    const w = detailRaw();
    w.order.type = "warranty";
    expect(buildVisitDetail(w).warranty).toBe(true);
  });

  it("la página vuelve a validar el JSON y descarta lo raro", () => {
    const d = buildVisitDetail(detailRaw());
    expect(parsePublicVisitDetail(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parsePublicVisitDetail({ id: "../../x" })).toBeNull();
    const bad = parsePublicVisitDetail({ ...d, link: "https://malo.com", photos: [{ url: "http://inseguro/x.jpg" }] })!;
    expect(bad.link).toBeNull();
    expect(bad.photos).toEqual([]);
  });

  it("rutas del detalle", () => {
    expect(historyVisitDocPath("TOK", "ord1")).toBe("publicHistory/TOK/visits/ord1");
    expect(historyVisitPath("TOK", "ord1")).toBe("/historial/TOK/visita/ord1");
  });
});

describe("orden en curso en el historial", () => {
  const raw: HistoryRaw = {
    kind: "customer", ownerId: "c1", name: "Ana", now: NOW,
    workshop: { name: "RAPIFIX", logoUrl: "", phone: "", whatsapp: "", address: "", city: "", hours: "" },
    vehicles: [{ id: "v1", plate: "HAB1234", customerId: "c1" }],
    orders: [{ id: "o2", code: "OT-2", status: "QUOTE_SENT", customerId: "c1", vehicleId: "v1", createdAt: NOW - DAY, portalToken: "PTOK2", totals: { total: 0 } }],
    quotes: [{ id: "q", code: "COT-9", status: "sent", orderId: "o2", vehicleId: "v1", customerId: "c1", items: [] }],
    payments: [], maintenance: [], washes: [], loyalty: [], memberships: [], carwash: { loyaltyEvery: 0, loyaltyStartStamps: 0 },
  };
  it("cada visita lleva su id, estado, avance y el link para aprobar la cotización", () => {
    const x = buildHistoryView(raw).vehicles[0]!.visits[0]!;
    expect(x).toMatchObject({ id: "o2", state: "in_shop", statusLabel: "Cotización enviada", quoteLink: "/orden/PTOK2/cotizacion" });
    expect(x.progress).toBeGreaterThan(0);
    expect(x.progress).toBeLessThan(100);
    expect(parsePublicHistory(JSON.parse(JSON.stringify(buildHistoryView(raw)))).vehicles[0]!.visits[0]!.quoteLink).toBe("/orden/PTOK2/cotizacion");
  });
  it("avance por estado", () => {
    expect(orderProgress("RECEIVED")).toBeGreaterThan(0);
    expect(orderProgress("READY")).toBe(100);
    expect(orderProgress("CANCELLED")).toBe(0);
  });
});

describe("activación automática del historial", () => {
  it("nunca activado: se activa solo", () => {
    expect(historyLinkState(undefined)).toBe("never");
    expect(historyLinkState(null)).toBe("never");
    expect(shouldAutoEnableHistory(undefined)).toBe(true);
  });
  it("activo: no se toca", () => {
    expect(historyLinkState({ token: "ABC", enabled: true })).toBe("active");
    expect(shouldAutoEnableHistory({ token: "ABC", enabled: true })).toBe(false);
  });
  it("desactivado a propósito (con o sin disabledAt): nunca se reactiva solo", () => {
    expect(historyLinkState({ token: null, enabled: false, disabledAt: 1, disabledBy: "u1" })).toBe("disabled");
    // links apagados antes de existir disabledAt
    expect(historyLinkState({ token: null, enabled: false })).toBe("disabled");
    expect(shouldAutoEnableHistory({ token: null, enabled: false })).toBe(false);
  });
});

describe("plantilla con {{historial}}", () => {
  const vars = { cliente: "Ana", vehiculo: "Toyota Hilux 2019", orden: "OT-1050", total: "L 3,220.00", taller: "RAPIFIX", link: "https://rapifix.hn/orden/X" };
  const url = "https://rapifix.hn/historial/ABCDEFGHJKMNPQRSTUVWXYZ2";
  it("vehículo listo: con historial activo sale la línea con el link", () => {
    setTemplateOverrides({});
    const text = renderTemplate(templateBody("listo"), { ...vars, historial: url });
    expect(text).toContain(`${HISTORY_LINE_TEXT} ${url}`);
    expect(withHistoryLine("listo", templateBody("listo"), text, url).match(/historial de su vehículo/g)).toHaveLength(1);
  });
  it("sin historial activo no queda la frase suelta", () => {
    const text = renderTemplate(templateBody("listo"), vars);
    expect(text).not.toContain("historial");
    expect(text).not.toContain("{{");
    expect(withHistoryLine("listo", templateBody("listo"), text, "")).toBe(text);
  });
  it("plantilla del taller sin {{historial}}: se agrega al final; si ya trae el link, no se duplica", () => {
    setTemplateOverrides({ listo: "Hola {{cliente}}, su carro está listo. Total {{total}}." });
    const body = templateBody("listo");
    const text = withHistoryLine("listo", body, renderTemplate(body, { ...vars, historial: url }), url);
    expect(text.endsWith(`${HISTORY_LINE_TEXT} ${url}`)).toBe(true);
    setTemplateOverrides({ listo: "Hola {{cliente}}. Su historial: {{historial}}" });
    const b2 = templateBody("listo");
    const t2 = withHistoryLine("listo", b2, renderTemplate(b2, { ...vars, historial: url }), url);
    expect(t2.split(url)).toHaveLength(2);
    setTemplateOverrides({});
  });
  it("solo listo y entregado llevan la línea automática", () => {
    expect(withHistoryLine("reparacion", "x", "x", url)).toBe("x");
    expect(templateUsesHistory("listo")).toBe(true);
    expect(templateUsesHistory("entregado")).toBe(true);
    expect(templateUsesHistory("reparacion")).toBe(false);
    expect(DEFAULT_TEMPLATES.find((t) => t.key === "entregado")!.body).toContain("{{historial}}");
  });
});
