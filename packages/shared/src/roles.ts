export const ROLES = ["admin", "manager", "reception", "technician", "warehouse", "seller"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  reception: "Recepción",
  technician: "Técnico",
  warehouse: "Bodega",
  seller: "Vendedor",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Acceso completo al sistema, usuarios y configuración.",
  manager: "Administración del taller y reportes.",
  reception: "Clientes, vehículos, órdenes, citas, cotizaciones y pagos.",
  technician: "Órdenes asignadas, diagnóstico, fotos y repuestos.",
  warehouse: "Inventario, repuestos y proveedores.",
  seller: "Punto de venta, clientes y ventas.",
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
  reception: ["dashboard.view", "customers.read", "customers.write", "vehicles.read", "vehicles.write", "settings.read"],
  technician: ["dashboard.view", "customers.read", "vehicles.read"],
  warehouse: ["dashboard.view", "customers.read", "vehicles.read"],
  seller: ["dashboard.view", "customers.read", "customers.write", "vehicles.read", "vehicles.write"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
