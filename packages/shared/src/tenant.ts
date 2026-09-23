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

export const orderCol = {
  workOrders: (tid: string) => `tenants/${tid}/workOrders`,
  events: (tid: string, orderId: string) => `tenants/${tid}/workOrders/${orderId}/events`,
  photos: (tid: string, orderId: string) => `tenants/${tid}/workOrders/${orderId}/photos`,
  staff: (tid: string) => `tenants/${tid}/staffDirectory`,
} as const;

export const orderStoragePath = {
  photo: (tid: string, orderId: string, fileId: string) => `tenants/${tid}/workOrders/${orderId}/photos/${fileId}.jpg`,
} as const;

export const quoteCol = {
  quotes: (tid: string) => `tenants/${tid}/quotes`,
  portal: "publicPortal",
} as const;

export const catalogCol = {
  products: (tid: string) => `tenants/${tid}/products`,
  productCosts: (tid: string) => `tenants/${tid}/productCosts`,
  services: (tid: string) => `tenants/${tid}/services`,
  movements: (tid: string) => `tenants/${tid}/inventoryMovements`,
  payments: (tid: string) => `tenants/${tid}/payments`,
  sales: (tid: string) => `tenants/${tid}/sales`,
  onlinePayments: (tid: string) => `tenants/${tid}/onlinePayments`,
  rokiEvents: (tid: string) => `tenants/${tid}/rokiEvents`,
  privateConfig: (tid: string) => `tenants/${tid}/private`,
} as const;
