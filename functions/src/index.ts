/**
 * RAPIFIX - Cloud Functions
 * Fase 1: usuarios y roles, datos demo, desnormalización y auditoría.
 * Fase 2: órdenes de trabajo, estados, secciones, historial y directorio del personal.
 * Fase 3: cotizaciones, aprobación pública y portal del cliente.
 */
export { bootstrapAdmin, createStaffUser, updateStaffUser } from "./callable/users";
export { seedDemoData } from "./callable/seed";
export { onVehicleWritten, onCustomerWritten, onVehiclePhotoWritten } from "./triggers/denormalize";
export { auditWriter } from "./triggers/audit";
export {
  createWorkOrder, changeWorkOrderStatus, updateWorkOrder, saveWorkOrderSection, addOrderEvent, touchSession,
} from "./callable/workOrders";
export { seedDemoOrders } from "./callable/seedOrders";
export { onWorkOrderWritten, onOrderPhotoWritten, onOrderPhotoUpdated, onOrderEventCreated, onUserWritten } from "./triggers/orders";
// Fase 3: cotizaciones y portal del cliente
export { saveQuote, sendQuote, newQuoteVersion, ensurePortal, recordQuoteDecision, convertQuoteToOrder } from "./callable/quotes";
export { respondToQuote, markQuoteViewed } from "./public/portal";
// Fase 4: inventario, pagos y punto de venta
export { registerInventoryMovement, consumeOrderPart } from "./callable/inventory";
export { registerPayment, voidPayment } from "./callable/payments";
export { createSale } from "./callable/sales";
export { seedDemoCatalog } from "./callable/seedCatalog";
// Pagos en línea con ROKI
export { getOnlinePayConfig, saveOnlinePayConfig } from "./callable/onlinePayConfig";
export { createOnlinePayment, checkOnlinePayment, rokiWebhook, reconcileOnlinePayments } from "./public/onlinePay";
// Fase 5: agenda, mantenimiento, técnicos, proveedores, compras y gastos
export { saveAppointment, setAppointmentStatus, saveMaintenance, maintenanceAction, saveEmployeeProfile, backfillMaintenance } from "./callable/operations";
export { saveSupplier, createPurchase, paySupplier, voidPurchase, saveExpense, voidExpense } from "./callable/finance";
export { onOrderDelivered, dailyMaintenance } from "./scheduled/daily";
export { importProducts } from "./callable/importProducts";
