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

/** Transiciones normales del flujo. */
export const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  RECEIVED: ["INSPECTION", "DIAGNOSIS", "CANCELLED"],
  INSPECTION: ["DIAGNOSIS", "CANCELLED"],
  DIAGNOSIS: ["AWAITING_QUOTE", "APPROVED", "CANCELLED"],
  AWAITING_QUOTE: ["QUOTE_SENT", "AWAITING_APPROVAL", "DIAGNOSIS", "CANCELLED"],
  QUOTE_SENT: ["AWAITING_APPROVAL", "APPROVED", "AWAITING_QUOTE", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "AWAITING_QUOTE", "CANCELLED"],
  APPROVED: ["IN_REPAIR", "WAITING_PARTS", "CANCELLED"],
  IN_REPAIR: ["WAITING_PARTS", "QUALITY_CONTROL", "CANCELLED"],
  WAITING_PARTS: ["IN_REPAIR", "CANCELLED"],
  QUALITY_CONTROL: ["READY", "IN_REPAIR"],
  READY: ["DELIVERED", "IN_REPAIR"],
  DELIVERED: [],
  CANCELLED: ["RECEIVED"],
};

/** Qué transiciones puede hacer cada rol (admin y gerente: todas las del flujo). */
const TECH_ALLOWED: ReadonlyArray<[WorkOrderStatus, WorkOrderStatus]> = [
  ["RECEIVED", "INSPECTION"],
  ["RECEIVED", "DIAGNOSIS"],
  ["INSPECTION", "DIAGNOSIS"],
  ["DIAGNOSIS", "AWAITING_QUOTE"],
  ["APPROVED", "IN_REPAIR"],
  ["APPROVED", "WAITING_PARTS"],
  ["IN_REPAIR", "WAITING_PARTS"],
  ["WAITING_PARTS", "IN_REPAIR"],
  ["IN_REPAIR", "QUALITY_CONTROL"],
];
const WAREHOUSE_ALLOWED: ReadonlyArray<[WorkOrderStatus, WorkOrderStatus]> = [
  ["APPROVED", "WAITING_PARTS"],
  ["IN_REPAIR", "WAITING_PARTS"],
  ["WAITING_PARTS", "IN_REPAIR"],
];

export function canTransition(role: Role | null | undefined, from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (!role || from === to) return false;
  if (!TRANSITIONS[from].includes(to)) return false;
  switch (role) {
    case "admin":
    case "manager":
      return true;
    case "reception":
      return !(from === "CANCELLED" && to === "RECEIVED");
    case "technician":
      return TECH_ALLOWED.some(([a, b]) => a === from && b === to);
    case "warehouse":
      return WAREHOUSE_ALLOWED.some(([a, b]) => a === from && b === to);
    default:
      return false;
  }
}

export function allowedTransitions(role: Role | null | undefined, from: WorkOrderStatus): WorkOrderStatus[] {
  return TRANSITIONS[from].filter((to) => canTransition(role, from, to));
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
