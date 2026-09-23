import { formatMoney, renderTemplate, whatsappLink, templateBody, templateForStatus, type WorkOrder, type WorkOrderStatus, type WorkshopSettings } from "@rapifix/shared";
import { formatPlate } from "@/lib/format";

/** Link del portal del cliente (Fase 3). */
export const PORTAL_ENABLED = true;
export const portalUrl = (order: WorkOrder) => `${window.location.origin}/orden/${order.portalToken}`;

export function orderVars(order: WorkOrder, settings: WorkshopSettings) {
  return {
    cliente: order.customer.fullName.split(" ")[0] ?? order.customer.fullName,
    vehiculo: `${order.vehicle.make} ${order.vehicle.model} ${order.vehicle.year}`,
    placa: formatPlate(order.vehicle.plate),
    orden: order.code,
    total: formatMoney(order.totals?.total ?? 0),
    taller: settings.name || "RAPIFIX",
    link: PORTAL_ENABLED && order.portalToken ? portalUrl(order) : "",
  };
}

export function messageForStatus(order: WorkOrder, status: WorkOrderStatus, settings: WorkshopSettings): string | null {
  const t = templateForStatus(status);
  return t ? renderTemplate(t.body, orderVars(order, settings)) : null;
}

export function messageFromTemplate(order: WorkOrder, key: string, settings: WorkshopSettings): string {
  const body = templateBody(key);
  return body ? renderTemplate(body, orderVars(order, settings)) : "";
}

/** Fallback manual: abre WhatsApp con el mensaje listo para enviar. */
export function openWhatsApp(order: WorkOrder, text: string) {
  const phone = order.customer.whatsapp || order.customer.phone;
  window.open(whatsappLink(phone, text), "_blank", "noopener");
}
