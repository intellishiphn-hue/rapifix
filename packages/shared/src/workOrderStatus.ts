import type { Role } from "./roles";

/** Estados de la orden de trabajo. */
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

export const CLOSED_STATUSES: readonly WorkOrderStatus[] = ["DELIVERED", "CANCELLED"];
export const isOpenStatus = (s: WorkOrderStatus) => !CLOSED_STATUSES.includes(s);

export type StatusColor =
  | "slate" | "sky" | "indigo" | "violet" | "amber" | "teal" | "blue" | "orange" | "cyan" | "green" | "emerald" | "red";

export const STATUS_META: Record<WorkOrderStatus, { label: string; color: StatusColor; portalStep: number; short: string }> = {
  RECEIVED: { label: "Recibido", short: "Recibido", color: "slate", portalStep: 0 },
  INSPECTION: { label: "Inspección", short: "Inspección", color: "sky", portalStep: 1 },
  DIAGNOSIS: { label: "Diagnóstico", short: "Diagnóstico", color: "indigo", portalStep: 2 },
  AWAITING_QUOTE: { label: "Esperando cotización", short: "Por cotizar", color: "violet", portalStep: 2 },
  QUOTE_SENT: { label: "Cotización enviada", short: "Cotiz. enviada", color: "amber", portalStep: 3 },
  AWAITING_APPROVAL: { label: "Esperando aprobación", short: "Por aprobar", color: "amber", portalStep: 3 },
  APPROVED: { label: "Aprobado", short: "Aprobado", color: "teal", portalStep: 4 },
  IN_REPAIR: { label: "En reparación", short: "En reparación", color: "blue", portalStep: 4 },
  WAITING_PARTS: { label: "Esperando repuestos", short: "Esp. repuestos", color: "orange", portalStep: 4 },
  QUALITY_CONTROL: { label: "Control de calidad", short: "Control calidad", color: "cyan", portalStep: 5 },
  READY: { label: "Listo para entrega", short: "Listo", color: "green", portalStep: 6 },
  DELIVERED: { label: "Entregado", short: "Entregado", color: "emerald", portalStep: 7 },
  CANCELLED: { label: "Cancelado", short: "Cancelado", color: "red", portalStep: -1 },
};

export const KANBAN_COLUMNS = [
  { key: "received", label: "Recibido", statuses: ["RECEIVED", "INSPECTION"] },
  { key: "diagnosis", label: "Diagnóstico", statuses: ["DIAGNOSIS", "AWAITING_QUOTE"] },
  { key: "approval", label: "Esperando aprobación", statuses: ["QUOTE_SENT", "AWAITING_APPROVAL"] },
  { key: "repair", label: "Reparación", statuses: ["APPROVED", "IN_REPAIR", "WAITING_PARTS"] },
  { key: "qc", label: "Control de calidad", statuses: ["QUALITY_CONTROL"] },
  { key: "ready", label: "Listo", statuses: ["READY"] },
  { key: "delivered", label: "Entregado", statuses: ["DELIVERED"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly WorkOrderStatus[] }>;

/**
 * Cambio de estado libre: el personal elige directamente el estado que corresponde,
 * sin tener que seguir un orden. Solo se restringe lo sensible:
 * - Entregado y Cancelado: solo administración, gerencia y recepción.
 * - Reabrir una orden entregada o cancelada: solo administración y gerencia.
 * - Bodega: solo marca "Esperando repuestos" / "En reparación".
 */
const DESK_ONLY: readonly WorkOrderStatus[] = ["DELIVERED", "CANCELLED"];

export function canTransition(role: Role | null | undefined, from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (!role || from === to) return false;
  const closed = from === "DELIVERED" || from === "CANCELLED";
  switch (role) {
    case "admin":
    case "manager":
      return true;
    case "reception":
      return !closed;
    case "technician":
      return !closed && !DESK_ONLY.includes(to);
    case "warehouse":
      return (["APPROVED", "IN_REPAIR", "WAITING_PARTS"] as WorkOrderStatus[]).includes(from) && (to === "WAITING_PARTS" || to === "IN_REPAIR");
    default:
      return false;
  }
}

/** Estados a los que el rol puede mover la orden, en el orden natural del flujo. */
export function allowedTransitions(role: Role | null | undefined, from: WorkOrderStatus): WorkOrderStatus[] {
  return WORK_ORDER_STATUSES.filter((to) => canTransition(role, from, to));
}

/** Pasos del portal del cliente (Fase 3) */
export const PORTAL_STEPS = [
  "Vehículo recibido",
  "Inspección realizada",
  "Diagnóstico completado",
  "Cotización aprobada",
  "Reparación en proceso",
  "Control de calidad",
  "Vehículo listo",
] as const;
