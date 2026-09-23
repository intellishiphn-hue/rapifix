/** Estados de la orden de trabajo (se usan desde la Fase 2, definidos desde ya). */
export const WORK_ORDER_STATUSES = [
  "RECEIVED",
  "INSPECTION",
  "DIAGNOSIS",
  "AWAITING_QUOTE",
  "QUOTE_SENT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_REPAIR",
  "WAITING_PARTS",
  "QUALITY_CONTROL",
  "READY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const KANBAN_COLUMNS = [
  { key: "received", label: "Recibido", statuses: ["RECEIVED", "INSPECTION"] },
  { key: "diagnosis", label: "Diagnóstico", statuses: ["DIAGNOSIS", "AWAITING_QUOTE"] },
  { key: "approval", label: "Esperando aprobación", statuses: ["QUOTE_SENT", "AWAITING_APPROVAL"] },
  { key: "repair", label: "Reparación", statuses: ["APPROVED", "IN_REPAIR", "WAITING_PARTS"] },
  { key: "qc", label: "Control de calidad", statuses: ["QUALITY_CONTROL"] },
  { key: "ready", label: "Listo", statuses: ["READY"] },
  { key: "delivered", label: "Entregado", statuses: ["DELIVERED"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly WorkOrderStatus[] }>;

export const STATUS_META: Record<WorkOrderStatus, { label: string; color: string; portalStep: number }> = {
  RECEIVED: { label: "Recibido", color: "slate", portalStep: 0 },
  INSPECTION: { label: "Inspección", color: "sky", portalStep: 1 },
  DIAGNOSIS: { label: "Diagnóstico", color: "indigo", portalStep: 2 },
  AWAITING_QUOTE: { label: "Esperando cotización", color: "violet", portalStep: 2 },
  QUOTE_SENT: { label: "Cotización enviada", color: "amber", portalStep: 3 },
  AWAITING_APPROVAL: { label: "Esperando aprobación", color: "amber", portalStep: 3 },
  APPROVED: { label: "Aprobado", color: "teal", portalStep: 4 },
  IN_REPAIR: { label: "En reparación", color: "blue", portalStep: 4 },
  WAITING_PARTS: { label: "Esperando repuestos", color: "orange", portalStep: 4 },
  QUALITY_CONTROL: { label: "Control de calidad", color: "cyan", portalStep: 5 },
  READY: { label: "Listo para entrega", color: "green", portalStep: 6 },
  DELIVERED: { label: "Entregado", color: "emerald", portalStep: 7 },
  CANCELLED: { label: "Cancelado", color: "red", portalStep: -1 },
};
