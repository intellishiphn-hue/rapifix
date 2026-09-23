import type { WorkOrderStatus } from "./workOrderStatus";

export const TEMPLATE_VARIABLES = ["cliente", "vehiculo", "placa", "orden", "total", "link", "taller"] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** Reemplaza {{variable}} por su valor. Variables vacías se quitan limpiamente. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface DefaultTemplate {
  key: string;
  name: string;
  body: string;
  status?: WorkOrderStatus;
}

/** Plantillas iniciales (editables desde Configuración en la Fase 6). */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  { key: "recibido", name: "Vehículo recibido", status: "RECEIVED", body: "Hola {{cliente}}, recibimos su {{vehiculo}} (placa {{placa}}) en {{taller}}. Su número de orden es {{orden}}. Le mantendremos informado. {{link}}" },
  { key: "inspeccion", name: "Inspección completada", status: "INSPECTION", body: "Hola {{cliente}}, ya realizamos la inspección inicial de su {{vehiculo}}. Seguimos con el diagnóstico. {{link}}" },
  { key: "diagnostico", name: "Diagnóstico listo", status: "AWAITING_QUOTE", body: "Hola {{cliente}}, el diagnóstico de su {{vehiculo}} está listo. En breve le enviamos la cotización. {{link}}" },
  { key: "cotizacion_enviada", name: "Cotización enviada", status: "QUOTE_SENT", body: "Hola {{cliente}}, le enviamos la cotización de su {{vehiculo}} (orden {{orden}}) por un total de {{total}}. Puede revisarla y aprobarla aquí: {{link}}" },
  { key: "cotizacion_aprobada", name: "Cotización aprobada", status: "APPROVED", body: "Hola {{cliente}}, gracias por aprobar la cotización. Ya programamos la reparación de su {{vehiculo}}. {{link}}" },
  { key: "reparacion", name: "Reparación iniciada", status: "IN_REPAIR", body: "Hola {{cliente}}, iniciamos la reparación de su {{vehiculo}}. {{link}}" },
  { key: "repuesto", name: "Esperando repuesto", status: "WAITING_PARTS", body: "Hola {{cliente}}, estamos esperando un repuesto para continuar con su {{vehiculo}}. Le avisamos apenas llegue. {{link}}" },
  { key: "calidad", name: "Control de calidad", status: "QUALITY_CONTROL", body: "Hola {{cliente}}, su {{vehiculo}} está en control de calidad, el último paso antes de la entrega. {{link}}" },
  { key: "listo", name: "Vehículo listo", status: "READY", body: "Hola {{cliente}}, ¡su {{vehiculo}} ya está listo para ser retirado en {{taller}}! {{link}}" },
  { key: "entregado", name: "Agradecimiento", status: "DELIVERED", body: "Gracias por confiar en {{taller}}, {{cliente}}. Fue un gusto atender su {{vehiculo}}. Estamos para servirle." },
  { key: "recordatorio_entrega", name: "Recordatorio de entrega", body: "Hola {{cliente}}, le recordamos que su {{vehiculo}} está listo para retirar en {{taller}}." },
  { key: "pendiente_retiro", name: "Vehículo pendiente de retiro", body: "Hola {{cliente}}, su {{vehiculo}} sigue en nuestras instalaciones esperando ser retirado. ¿Cuándo nos visita?" },
  { key: "mantenimiento", name: "Mantenimiento próximo", body: "Hola {{cliente}}, se acerca el mantenimiento de su {{vehiculo}} (placa {{placa}}). ¿Le agendamos una cita?" },
  { key: "pago_pendiente", name: "Pago pendiente", body: "Hola {{cliente}}, le recordamos que la orden {{orden}} tiene un saldo pendiente de {{total}}." },
];

export function templateForStatus(status: WorkOrderStatus): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.status === status);
}
