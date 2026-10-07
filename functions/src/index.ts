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
export { saveQuote, sendQuote, newQuoteVersion, discardQuoteRevision, ensurePortal, recordQuoteDecision, convertQuoteToOrder } from "./callable/quotes";
export { respondToQuote, markQuoteViewed } from "./public/portal";
// Fase 4: inventario, pagos y punto de venta
export { registerInventoryMovement, consumeOrderPart } from "./callable/inventory";
export { registerPayment, voidPayment, attachPaymentReceipt } from "./callable/payments";
export { createSale } from "./callable/sales";
export { seedDemoCatalog } from "./callable/seedCatalog";
// Pagos en línea con ROKI
export { getOnlinePayConfig, saveOnlinePayConfig } from "./callable/onlinePayConfig";
export { createOnlinePayment, checkOnlinePayment, rokiWebhook, reconcileOnlinePayments } from "./public/onlinePay";
// Fase 5: agenda, mantenimiento, técnicos, proveedores, compras y gastos
export { saveAppointment, setAppointmentStatus, saveMaintenance, maintenanceAction, saveEmployeeProfile, backfillMaintenance } from "./callable/operations";
export { saveSupplier, createPurchase, paySupplier, voidPurchase, saveExpense, voidExpense } from "./callable/finance";
export { onOrderDelivered, dailyMaintenance } from "./scheduled/daily";
// Gastos fijos, presupuesto y cierre del mes
export { saveFixedCost, generateFixedCosts, payPendingExpense, adjustPendingExpense, saveFinanceBudget } from "./callable/fixedCosts";
export { dailyFixedCosts } from "./scheduled/fixedCosts";
export { importProducts } from "./callable/importProducts";
export { deleteWorkOrder } from "./callable/deleteWorkOrder";
export { onSettingsBranding } from "./triggers/branding";
export { voidSale } from "./callable/voidSale";
// Carwash: menú, cola, cobros, lealtad y membresías
export {
  saveCarwashService, reorderCarwashServices, seedCarwashMenu, saveCarwashPlan, carwashLookup, saveWash, linkWashCustomer, setWashStatus,
  assignWasher, cancelWash, chargeWash, sellMembership, cancelMembership, getWashPayLink, adjustLoyaltyStamps, fixWashPlate,
} from "./callable/carwash";
export { onCarwashWashWritten, onCarwashPhotoWritten } from "./triggers/carwash";
// Comprobantes de transferencia/depósito que sube el cliente desde su link
export { submitPaymentProof } from "./public/paymentProofs";
export { reviewPaymentProof } from "./callable/paymentProofs";
export { carwashDaily } from "./scheduled/carwash";
// WhatsApp automático (OpenWA en la computadora del taller): cola, clave del worker y su punto de conexión
export { queueWhatsApp, retryWhatsApp, cancelWhatsApp, createWaWorkerToken, revokeWaWorkerToken } from "./callable/whatsapp";
export { waWorker } from "./public/waWorker";
