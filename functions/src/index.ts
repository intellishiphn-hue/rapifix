/**
 * RAPIFIX - Cloud Functions
 * Fase 1: usuarios y roles, datos demo, desnormalización y auditoría.
 */
export { bootstrapAdmin, createStaffUser, updateStaffUser } from "./callable/users";
export { seedDemoData } from "./callable/seed";
export { onVehicleWritten, onCustomerWritten, onVehiclePhotoWritten } from "./triggers/denormalize";
export { auditWriter } from "./triggers/audit";
