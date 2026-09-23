import { describe, expect, it } from "vitest";
import { buildSearchKeywords, normalizePlate, searchToken } from "../text";
import { formatPhone, normalizePhone } from "../phone";
import { can } from "../roles";
import { customerSchema, vehicleSchema } from "../schemas";

describe("text", () => {
  it("normaliza placas", () => expect(normalizePlate("abc-123 ")).toBe("ABC123"));
  it("genera keywords con prefijos y sin tildes", () => {
    const k = buildSearchKeywords(["María López", "ABC-123"]);
    expect(k).toContain("maria");
    expect(k).toContain("lop");
    expect(k).toContain("abc123");
    expect(k).toContain("ab");
  });
  it("token de búsqueda coincide con keywords", () => {
    const k = buildSearchKeywords(["Hyundai Tucson"]);
    expect(k).toContain(searchToken("TUCS"));
  });
});

describe("phone", () => {
  it("normaliza teléfonos de Honduras", () => {
    expect(normalizePhone("9999-8888")).toBe("+50499998888");
    expect(normalizePhone("504 9999 8888")).toBe("+50499998888");
    expect(formatPhone("+50499998888")).toBe("9999-8888");
  });
});

describe("roles", () => {
  it("técnico no puede escribir clientes", () => expect(can("technician", "customers.write")).toBe(false));
  it("gerente no administra usuarios", () => expect(can("manager", "users.manage")).toBe(false));
  it("admin puede todo", () => expect(can("admin", "users.manage")).toBe(true));
});

describe("schemas", () => {
  it("valida cliente", () => {
    const r = customerSchema.safeParse({
      firstName: "Juan", lastName: "Pérez", phone: "9999-8888", whatsapp: "", email: "",
      idNumber: "", rtn: "", address: "", city: "", notes: "", status: "active",
    });
    expect(r.success).toBe(true);
  });
  it("rechaza VIN con letra O", () => {
    const r = vehicleSchema.safeParse({
      customerId: "x", make: "Toyota", model: "Corolla", year: 2022, color: "", plate: "ABC123",
      vin: "OOOOOOOOOOOOOOOOO", mileage: 1, fuelType: "gasolina", engine: "", transmission: "automatica", notes: "",
    });
    expect(r.success).toBe(false);
  });
});
