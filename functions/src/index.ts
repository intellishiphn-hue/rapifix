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
