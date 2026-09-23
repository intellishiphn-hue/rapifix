import { z } from "zod";
import type { BaseDoc, TimestampLike } from "./types";
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from "./workOrderStatus";

export const WORK_TYPES = ["repair", "maintenance", "warranty", "diagnosis", "other"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  repair: "Reparación",
  maintenance: "Mantenimiento",
  warranty: "Garantía",
  diagnosis: "Diagnóstico",
  other: "Otro",
};

export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { normal: "Normal", high: "Alta", urgent: "Urgente" };

export const RECEPTION_CHECKLIST = [
  { key: "keys", label: "Llaves" },
  { key: "documents", label: "Documentos" },
  { key: "spareTire", label: "Rueda de repuesto" },
  { key: "jack", label: "Gata" },
  { key: "tools", label: "Herramientas" },
  { key: "triangles", label: "Triángulos" },
  { key: "extinguisher", label: "Extintor" },
] as const;
export type ChecklistKey = (typeof RECEPTION_CHECKLIST)[number]["key"];

export const QC_CHECKLIST = [
  { key: "roadTest", label: "Prueba de ruta" },
  { key: "fluids", label: "Niveles de fluidos" },
  { key: "noLeaks", label: "Sin fugas" },
  { key: "torque", label: "Torque de ruedas / tornillería" },
  { key: "noWarnings", label: "Sin luces de advertencia en tablero" },
  { key: "clean", label: "Vehículo limpio" },
  { key: "oldParts", label: "Piezas viejas listas para el cliente" },
] as const;

export const PHOTO_STAGES = ["reception", "diagnosis", "before", "during", "after", "damage"] as const;
export type PhotoStage = (typeof PHOTO_STAGES)[number];
export const PHOTO_STAGE_LABELS: Record<PhotoStage, string> = {
  reception: "Recepción",
  diagnosis: "Diagnóstico",
  before: "Antes",
  during: "Durante",
  after: "Después",
  damage: "Daños existentes",
};

/** Fotos guiadas de recepción */
export const RECEPTION_ANGLES = [
  { key: "front", label: "Frente" },
  { key: "back", label: "Atrás" },
  { key: "left", label: "Lado izquierdo" },
  { key: "right", label: "Lado derecho" },
  { key: "interior", label: "Interior" },
  { key: "dashboard", label: "Tablero" },
] as const;
export type ReceptionAngle = (typeof RECEPTION_ANGLES)[number]["key"];

export interface Reception {
  mileageIn: number;
  fuelLevel: number; // 0 a 8 (octavos)
  exteriorNotes: string;
  interiorNotes: string;
  checklist: Record<ChecklistKey, boolean>;
  accessories: string;
  otherObjects: string;
  receivedAt?: TimestampLike;
  receivedBy?: string;
}

export interface Diagnosis {
  reportedProblem: string;
  technicianDiagnosis: string;
  recommendations: string;
  observations: string;
  testsPerformed: string;
  obdCodes: string[];
  completedAt?: TimestampLike | null;
  completedBy?: string | null;
  updatedAt?: TimestampLike;
  updatedBy?: string;
}

export interface QualityControl {
  checklist: Record<string, boolean>;
  notes: string;
  passedAt?: TimestampLike | null;
  passedBy?: string | null;
}

export interface WorkOrder extends BaseDoc {
  number: number;
  code: string; // OT-1024
  status: WorkOrderStatus;
  isOpen: boolean;
  statusChangedAt: TimestampLike;
  statusChangedBy: string;
  type: WorkType;
  priority: Priority;
  reason: string;
  customerId: string;
  customer: { fullName: string; phone: string; whatsapp: string };
  vehicleId: string;
  vehicle: { make: string; model: string; year: number; color: string; plate: string };
  technicianIds: string[];
  technicians: Array<{ id: string; name: string }>;
  reception: Reception;
  diagnosis: Diagnosis | null;
  qc: QualityControl | null;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  paid: number;
  balance: number;
  portalToken: string;
  portalEnabled: boolean;
  promisedAt: TimestampLike | null;
  deliveredAt: TimestampLike | null;
  mileageOut: number | null;
  cancelReason: string;
  photoCount: number;
  searchKeywords: string[];
}

export type OrderEventType = "created" | "status_change" | "note" | "customer_update" | "photo" | "assignment" | "section";

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  fromStatus?: WorkOrderStatus | null;
  toStatus?: WorkOrderStatus | null;
  text: string;
  visibleToCustomer: boolean;
  channels: Array<"portal" | "whatsapp">;
  actorId: string;
  actorName: string;
  at: TimestampLike;
}

export interface OrderPhoto {
  id: string;
  url: string;
  storagePath: string;
  stage: PhotoStage;
  angle: string;
  caption: string;
  visibleToCustomer: boolean;
  by: string;
  byName: string;
  at: TimestampLike;
}

export interface StaffEntry {
  id: string; // uid
  displayName: string;
  role: string;
  active: boolean;
}

// ---------------- Validaciones ----------------

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);

export const receptionSchema = z.object({
  mileageIn: z.number({ error: "Kilometraje no válido" }).int().min(0, "Kilometraje no válido").max(2_000_000),
  fuelLevel: z.number().int().min(0).max(8),
  exteriorNotes: text(1000),
  interiorNotes: text(1000),
  checklist: z.object({
    keys: z.boolean(), documents: z.boolean(), spareTire: z.boolean(), jack: z.boolean(),
    tools: z.boolean(), triangles: z.boolean(), extinguisher: z.boolean(),
  }),
  accessories: text(500),
  otherObjects: text(500),
});
export type ReceptionInput = z.infer<typeof receptionSchema>;

export const createWorkOrderSchema = z.object({
  vehicleId: z.string().min(1, "Seleccione el vehículo"),
  reason: text(1000).min(3, "Describa el motivo de ingreso"),
  type: z.enum(WORK_TYPES),
  priority: z.enum(PRIORITIES),
  technicianIds: z.array(z.string()).max(5),
  promisedAt: z.string().nullable(), // ISO
  reception: receptionSchema,
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

/** Convertir una cotización directa aprobada en orden de trabajo (al llegar el vehículo). */
export const convertQuoteSchema = z.object({
  quoteId: z.string().min(1),
  reason: text(1000).min(3, "Describa el motivo de ingreso"),
  type: z.enum(WORK_TYPES),
  priority: z.enum(PRIORITIES),
  technicianIds: z.array(z.string()).max(5),
  promisedAt: z.string().nullable(),
  reception: receptionSchema,
});
export type ConvertQuoteInput = z.infer<typeof convertQuoteSchema>;

export const updateWorkOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: text(1000).min(3, "Describa el motivo de ingreso").optional(),
  type: z.enum(WORK_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  technicianIds: z.array(z.string()).max(5).optional(),
  promisedAt: z.string().nullable().optional(),
});
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

export const diagnosisSchema = z.object({
  reportedProblem: text(2000),
  technicianDiagnosis: text(4000),
  recommendations: text(2000),
  observations: text(2000),
  testsPerformed: text(2000),
  obdCodes: z.array(z.string().trim().toUpperCase().regex(/^[PBCU][0-9A-F]{4}$/, "Código OBD no válido (ej. P0300)")).max(30),
});
export type DiagnosisInput = z.infer<typeof diagnosisSchema>;

export const qcSchema = z.object({
  checklist: z.record(z.string(), z.boolean()),
  notes: text(1000),
});

export const saveSectionSchema = z.discriminatedUnion("section", [
  z.object({ orderId: z.string().min(1), section: z.literal("reception"), data: receptionSchema }),
  z.object({ orderId: z.string().min(1), section: z.literal("diagnosis"), data: diagnosisSchema, complete: z.boolean() }),
  z.object({ orderId: z.string().min(1), section: z.literal("qc"), data: qcSchema, pass: z.boolean() }),
]);
export type SaveSectionInput = z.infer<typeof saveSectionSchema>;

export const changeStatusSchema = z.object({
  orderId: z.string().min(1),
  toStatus: z.enum(WORK_ORDER_STATUSES),
  // nullish: Firebase envía como null los campos que el navegador deja en undefined
  note: text(500).nullish(),
  mileageOut: z.number().int().min(0).max(2_000_000).nullish(),
});
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const addOrderEventSchema = z.object({
  orderId: z.string().min(1),
  text: text(1000).min(1, "Escriba el mensaje"),
  visibleToCustomer: z.boolean(),
  channels: z.array(z.enum(["portal", "whatsapp"])).max(2),
});
export type AddOrderEventInput = z.infer<typeof addOrderEventSchema>;

/** Token del portal: 10 caracteres sin letras/números confusos (0/O, 1/I/L). */
export const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateToken(length = 10, random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[random(TOKEN_ALPHABET.length)];
  return out;
}

export const EMPTY_RECEPTION: ReceptionInput = {
  mileageIn: 0,
  fuelLevel: 4,
  exteriorNotes: "",
  interiorNotes: "",
  checklist: { keys: true, documents: false, spareTire: false, jack: false, tools: false, triangles: false, extinguisher: false },
  accessories: "",
  otherObjects: "",
};

export const EMPTY_DIAGNOSIS: DiagnosisInput = {
  reportedProblem: "", technicianDiagnosis: "", recommendations: "", observations: "", testsPerformed: "", obdCodes: [],
};
