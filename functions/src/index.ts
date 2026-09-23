/**
 * RAPIFIX - Cloud Functions
 * Fase 1: usuarios y roles, datos demo, desnormalización y auditoría.
 * Fase 2: órdenes de trabajo, estados, secciones, historial y directorio del personal.
 */
export { bootstrapAdmin, createStaffUser, updateStaffUser } from "./callable/users";
export { seedDemoData } from "./callable/seed";
export { onVehicleWritten, onCustomerWritten, onVehiclePhotoWritten } from "./triggers/denormalize";
export { auditWriter } from "./triggers/audit";
export {
  createWorkOrder, changeWorkOrderStatus, updateWorkOrder, saveWorkOrderSection, addOrderEvent, touchSession,
} from "./callable/workOrders";
export { seedDemoOrders } from "./callable/seedOrders";
export { onWorkOrderWritten, onOrderPhotoWritten, onUserWritten } from "./triggers/orders";
