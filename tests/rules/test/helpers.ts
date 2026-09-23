import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";

export const PROJECT_ID = "demo-rapifix";
export const TID = "rapifix";
export const T = `tenants/${TID}`;

export const ROLES = ["admin", "manager", "reception", "technician", "warehouse", "seller"] as const;
export type Role = (typeof ROLES)[number];

const root = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));

/**
 * Crea el entorno de pruebas. El host/puerto de los emuladores se toma de las
 * variables que pone `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST, etc.).
 */
export function createEnv(opts: { storage?: boolean } = {}): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    // La regla de Storage de fotos de órdenes consulta Firestore, así que
    // cargamos siempre las reglas de Firestore.
    firestore: { rules: readFileSync(root("firestore.rules"), "utf8") },
    ...(opts.storage ? { storage: { rules: readFileSync(root("storage.rules"), "utf8") } } : {}),
  });
}

/** uid por defecto de cada rol: admin1, manager1, reception1, tech1, warehouse1, seller1 */
export function uidOf(role: Role): string {
  return role === "technician" ? "tech1" : `${role}1`;
}

export function ctxAs(env: RulesTestEnvironment, role: Role, uid = uidOf(role), tid = TID): RulesTestContext {
  return env.authenticatedContext(uid, { tid, role });
}

export const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
export const fixedTs = () => firebase.firestore.Timestamp.fromDate(new Date("2025-01-01T00:00:00Z"));

/** Cliente válido según validCustomer() + validCreateMeta() */
export function newCustomer(uid: string, extra: Record<string, unknown> = {}) {
  return {
    firstName: "Juan",
    lastName: "Pérez",
    fullName: "Juan Pérez",
    phone: "99998888",
    whatsapp: "",
    email: "",
    idNumber: "",
    rtn: "",
    address: "",
    city: "Tegucigalpa",
    notes: "",
    status: "active",
    vehicleCount: 0,
    openOrders: 0,
    balanceDue: 0,
    searchKeywords: ["juan", "perez"],
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...extra,
  };
}

/** Producto válido según validProduct() */
export function newProduct(uid: string, extra: Record<string, unknown> = {}) {
  return {
    sku: "FIL-001",
    name: "Filtro de aceite",
    category: "Filtros",
    brand: "Bosch",
    supplier: "",
    unit: "unidad",
    price: 25000,
    stock: 0,
    minStock: 2,
    location: "A1",
    taxable: true,
    active: true,
    searchKeywords: ["filtro"],
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTs(),
    updatedAt: serverTs(),
    ...extra,
  };
}
