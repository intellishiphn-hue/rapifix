import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { buildSearchKeywords, col, normalizePhone, normalizePlate } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { requireRole } from "../lib/guards";

const CUSTOMERS = [
  { key: "juan", firstName: "Juan", lastName: "Pérez", phone: "9876-5432", email: "juan.perez@example.com", city: "Tegucigalpa", address: "Col. Palmira, Calle Principal", idNumber: "0801-1985-12345" },
  { key: "maria", firstName: "María", lastName: "López", phone: "9654-3210", email: "maria.lopez@example.com", city: "Tegucigalpa", address: "Res. Lomas del Guijarro", idNumber: "0801-1990-54321" },
  { key: "carlos", firstName: "Carlos", lastName: "Hernández", phone: "3321-7788", email: "", city: "Comayagüela", address: "Col. Kennedy, Bloque 5", idNumber: "0801-1978-11223" },
];

const VEHICLES = [
  { owner: "juan", make: "Toyota", model: "Corolla", year: 2022, color: "Blanco", plate: "HAB-1234", vin: "JTDBR32E720123456", mileage: 38500, fuelType: "gasolina", engine: "1.8L", transmission: "cvt" },
  { owner: "maria", make: "Ford", model: "Explorer", year: 2019, color: "Negro", plate: "HCD-5678", vin: "1FM5K8GT4KGA12345", mileage: 72300, fuelType: "gasolina", engine: "3.5L V6", transmission: "automatica" },
  { owner: "carlos", make: "Hyundai", model: "Tucson", year: 2021, color: "Gris", plate: "HEF-9012", vin: "KM8J33A46MU123456", mileage: 45100, fuelType: "gasolina", engine: "2.0L", transmission: "automatica" },
  { owner: "juan", make: "Kia", model: "Sportage", year: 2020, color: "Rojo", plate: "HGH-3456", vin: "KNDPM3AC4L7123456", mileage: 61800, fuelType: "diesel", engine: "2.0L CRDi", transmission: "automatica" },
  { owner: "maria", make: "BMW", model: "X3", year: 2023, color: "Azul", plate: "HIJ-7890", vin: "5UX53DP06P9123456", mileage: 18900, fuelType: "gasolina", engine: "2.0L Turbo", transmission: "automatica" },
] as const;

/** Carga datos de demostración (una sola vez). Solo administradores. */
export const seedDemoData = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const tid = caller.tid;
  const flagRef = db.doc(`tenants/${tid}/meta/demoSeed`);
  if ((await flagRef.get()).exists) {
    throw new HttpsError("already-exists", "Los datos demo ya fueron cargados.");
  }

  const now = FieldValue.serverTimestamp();
  const meta = { createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid };
  const batch = db.batch();
  const ids: Record<string, { id: string; fullName: string; phone: string }> = {};

  for (const c of CUSTOMERS) {
    const ref = db.collection(col.customers(tid)).doc();
    const fullName = `${c.firstName} ${c.lastName}`;
    const phone = normalizePhone(c.phone);
    ids[c.key] = { id: ref.id, fullName, phone };
    batch.set(ref, {
      firstName: c.firstName,
      lastName: c.lastName,
      fullName,
      phone,
      whatsapp: phone,
      email: c.email,
      idNumber: c.idNumber,
      rtn: "",
      address: c.address,
      city: c.city,
      notes: "Cliente de demostración",
      status: "active",
      vehicleCount: 0,
      openOrders: 0,
      balanceDue: 0,
      lastVisitAt: null,
      searchKeywords: buildSearchKeywords([fullName, c.phone, phone, c.email, c.idNumber, c.city]),
      ...meta,
    });
  }

  for (const v of VEHICLES) {
    const owner = ids[v.owner]!;
    const ref = db.collection(col.vehicles(tid)).doc();
    const plate = normalizePlate(v.plate);
    batch.set(ref, {
      customerId: owner.id,
      customer: { fullName: owner.fullName, phone: owner.phone },
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      plate,
      vin: v.vin,
      mileage: v.mileage,
      mileageUpdatedAt: now,
      fuelType: v.fuelType,
      engine: v.engine,
      transmission: v.transmission,
      notes: "",
      coverPhotoUrl: "",
      photoCount: 0,
      archived: false,
      searchKeywords: buildSearchKeywords([plate, v.make, v.model, String(v.year), v.color, v.vin, owner.fullName]),
      ...meta,
    });
    batch.set(ref.collection("mileageLog").doc(), {
      mileage: v.mileage, source: "manual", note: "Registro inicial (demo)", at: now, by: caller.uid, byName: "Sistema",
    });
  }

  batch.set(flagRef, { at: now, by: caller.uid });
  await batch.commit();
  return { customers: CUSTOMERS.length, vehicles: VEHICLES.length };
});
