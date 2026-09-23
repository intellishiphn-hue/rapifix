import type { WorkOrderStatus } from "./workOrderStatus";

export const TEMPLATE_VARIABLES = ["cliente", "vehiculo", "placa", "orden", "total", "link", "taller"] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** Reemplaza {{variable}} por su valor. Variables vacías se quitan limpiamente. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  // Si no hay link, se quita también la frase que lo introduce ("...aquí: {{link}}")
  const src = vars.link ? body : body.replace(/[^.!?\n]*:\s*\{\{\s*link\s*\}\}/g, "");
  return src
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
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
const FIRMA = "Gracias por su preferencia en *{{taller}}* 👨‍🔧";

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  { key: "recibido", name: "Vehículo recibido", status: "RECEIVED", body: `¡Hola {{cliente}}! 👋\n\nRecibimos su vehículo: *{{vehiculo}}* (placa {{placa}})\n(Orden {{orden}})\n\nLe mantendremos informado del avance.\nPuede seguirlo aquí: {{link}}\n\n${FIRMA}` },
  { key: "inspeccion", name: "Inspección completada", status: "INSPECTION", body: `¡Hola {{cliente}}! 🔎\n\nYa realizamos la inspección inicial de su *{{vehiculo}}*.\n(Orden {{orden}})\n\nSeguimos con el diagnóstico.\nAvance: {{link}}\n\n${FIRMA}` },
  { key: "diagnostico", name: "Diagnóstico listo", status: "AWAITING_QUOTE", body: `¡Hola {{cliente}}! 🧰\n\nEl diagnóstico de su *{{vehiculo}}* está listo.\n(Orden {{orden}})\n\nEn breve le enviamos la cotización.\nDetalles: {{link}}\n\n${FIRMA}` },
  { key: "cotizacion_enviada", name: "Cotización enviada", status: "QUOTE_SENT", body: `¡Hola {{cliente}}! 🏁\n\nLe enviamos la cotización de su vehículo: *{{vehiculo}}*\n(Orden {{orden}})\n\n*El total es de {{total}}*\n\nPuede revisarla y aprobarla aquí: {{link}}\n\n${FIRMA}` },
  { key: "cotizacion_directa", name: "Cotización (sin orden)", body: `¡Hola {{cliente}}! 🏁\n\nLe enviamos la cotización para su vehículo: *{{vehiculo}}*\n(Cotización {{orden}})\n\n*El total es de {{total}}*\n\nPuede revisarla y aprobarla aquí: {{link}}\n\n${FIRMA}` },
  { key: "cotizacion_aprobada", name: "Cotización aprobada", status: "APPROVED", body: `¡Hola {{cliente}}! ✅\n\nGracias por aprobar la cotización de su *{{vehiculo}}*.\n(Orden {{orden}})\n\nYa programamos el trabajo.\nAvance: {{link}}\n\n${FIRMA}` },
  { key: "reparacion", name: "Reparación iniciada", status: "IN_REPAIR", body: `¡Hola {{cliente}}! 🔧\n\nIniciamos la reparación de su *{{vehiculo}}*.\n(Orden {{orden}})\n\nPuede seguir el avance aquí: {{link}}\n\n${FIRMA}` },
  { key: "repuesto", name: "Esperando repuesto", status: "WAITING_PARTS", body: `¡Hola {{cliente}}! 📦\n\nEstamos esperando un repuesto para continuar con su *{{vehiculo}}*.\n(Orden {{orden}})\n\nLe avisamos apenas llegue.\nAvance: {{link}}\n\n${FIRMA}` },
  { key: "calidad", name: "Control de calidad", status: "QUALITY_CONTROL", body: `¡Hola {{cliente}}! 🔍\n\nSu *{{vehiculo}}* está en control de calidad, el último paso antes de la entrega.\n(Orden {{orden}})\n\nAvance: {{link}}\n\n${FIRMA}` },
  { key: "listo", name: "Vehículo listo", status: "READY", body: `¡Hola {{cliente}}! 🎉\n\n¡Su *{{vehiculo}}* ya está listo para ser retirado!\n(Orden {{orden}})\n\n*Total: {{total}}*\n\nPuede consultar los detalles aquí: {{link}}\n\n${FIRMA}` },
  { key: "entregado", name: "Agradecimiento", status: "DELIVERED", body: `¡Muchas gracias {{cliente}}! 🙌\n\nFue un gusto atender su *{{vehiculo}}*.\n(Orden {{orden}})\n\nCualquier cosa, estamos para servirle.\n\n${FIRMA}` },
  { key: "recordatorio_entrega", name: "Recordatorio de entrega", body: `¡Hola {{cliente}}! 🚗\n\nLe recordamos que su *{{vehiculo}}* está listo para retirar.\n(Orden {{orden}})\n\n${FIRMA}` },
  { key: "pendiente_retiro", name: "Vehículo pendiente de retiro", body: `¡Hola {{cliente}}! 🚗\n\nSu *{{vehiculo}}* sigue en nuestras instalaciones esperando ser retirado.\n(Orden {{orden}})\n\n¿Cuándo nos visita?\n\n${FIRMA}` },
  { key: "mantenimiento", name: "Mantenimiento próximo", body: `¡Hola {{cliente}}! 🛠️\n\nSe acerca el mantenimiento de su *{{vehiculo}}* (placa {{placa}}).\n\n¿Le agendamos una cita?\n\n${FIRMA}` },
  { key: "pago_pendiente", name: "Pago pendiente", body: `¡Hola {{cliente}}! 🧾\n\nLe recordamos que la orden *{{orden}}* de su *{{vehiculo}}* tiene un saldo pendiente de *{{total}}*.\n\n${FIRMA}` },
];

export function templateForStatus(status: WorkOrderStatus): DefaultTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => t.status === status);
}
