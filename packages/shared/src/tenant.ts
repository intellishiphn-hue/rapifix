/** Rutas de Firestore/Storage. Todo lo operativo vive bajo tenants/{tid}. */
export const DEFAULT_TENANT_ID = "rapifix";

export const col = {
  users: "users",
  tenants: "tenants",
  customers: (tid: string) => `tenants/${tid}/customers`,
  vehicles: (tid: string) => `tenants/${tid}/vehicles`,
  mileageLog: (tid: string, vehicleId: string) => `tenants/${tid}/vehicles/${vehicleId}/mileageLog`,
  vehiclePhotos: (tid: string, vehicleId: string) => `tenants/${tid}/vehicles/${vehicleId}/photos`,
  settings: (tid: string) => `tenants/${tid}/settings`,
  auditLogs: (tid: string) => `tenants/${tid}/auditLogs`,
  counters: (tid: string) => `tenants/${tid}/counters`,
} as const;

export const storagePath = {
  vehiclePhoto: (tid: string, vehicleId: string, fileId: string) =>
    `tenants/${tid}/vehicles/${vehicleId}/photos/${fileId}.jpg`,
  logo: (tid: string, ext: string) => `tenants/${tid}/branding/logo.${ext}`,
} as const;
