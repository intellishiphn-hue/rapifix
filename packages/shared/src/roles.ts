export const ROLES = ["admin", "manager", "reception", "technician", "warehouse", "seller", "washer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  reception: "Recepción",
  technician: "Técnico",
  warehouse: "Bodega",
  seller: "Vendedor",
  washer: "Lavador",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Acceso completo al sistema, usuarios y configuración.",
  manager: "Administración del taller y reportes.",
  reception: "Clientes, vehículos, órdenes, citas, cotizaciones y pagos.",
  technician: "Órdenes asignadas, diagnóstico, fotos y repuestos.",
  warehouse: "Inventario, repuestos y proveedores.",
  seller: "Punto de venta, clientes y ventas.",
  washer: "Carwash: ver la cola, registrar carros y cambiar su estado. No cobra.",
};

export const PERMISSIONS = [
  "dashboard.view",
  "dashboard.financials",
  "customers.read",
  "customers.write",
  "vehicles.read",
  "vehicles.write",
  "settings.read",
  "settings.write",
  "users.manage",
  "audit.read",
  "orders.read",
  "orders.create",
  "orders.diagnose",
  "quotes.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.manage",
  "sales.create",
  "payments.read",
  "payments.void",
  "agenda.read",
  "agenda.manage",
  "maintenance.manage",
  "employees.read",
  "employees.manage",
  "suppliers.manage",
  "purchases.manage",
  "expenses.manage",
  "reports.view",
  "reports.financial",
  "messages.read",
  "carwash.read",
  "carwash.create",
  "carwash.charge",
  "carwash.manage",
  "carwash.reports",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;

/**
 * Matriz de permisos. OJO: esto solo controla la interfaz.
 * La protección real está en firestore.rules, storage.rules y Cloud Functions.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL,
  manager: ALL.filter((p) => p !== "users.manage"),
  reception: [
    "dashboard.view", "customers.read", "customers.write", "vehicles.read", "vehicles.write", "settings.read",
    "orders.read", "orders.create", "orders.diagnose", "quotes.manage",
    "catalog.read", "sales.create", "payments.read",
    "agenda.read", "agenda.manage", "maintenance.manage", "employees.read", "reports.view", "messages.read",
    "carwash.read", "carwash.create", "carwash.charge",
  ],
  technician: ["dashboard.view", "customers.read", "vehicles.read", "orders.read", "orders.diagnose", "catalog.read", "agenda.read"],
  warehouse: [
    "dashboard.view", "customers.read", "vehicles.read", "orders.read", "catalog.read", "catalog.manage", "inventory.manage",
    "suppliers.manage", "purchases.manage", "reports.view",
  ],
  seller: [
    "dashboard.view", "customers.read", "customers.write", "vehicles.read", "vehicles.write", "orders.read",
    "catalog.read", "sales.create", "payments.read", "agenda.read", "reports.view", "messages.read",
    "carwash.read", "carwash.create", "carwash.charge",
  ],
  washer: ["carwash.read", "carwash.create"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
