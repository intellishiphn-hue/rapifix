import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  col, companyCol, formatMoney, historyLinkState, historyPath, renderTemplate, whatsappLink, templateBody, templateForStatus, withHistoryLine,
  type HistoryLink, type WorkOrder, type WorkOrderStatus, type WorkshopSettings,
} from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { formatPlate } from "@/lib/format";

/** Link del portal del cliente (Fase 3). */
export const PORTAL_ENABLED = true;
export const portalUrl = (order: WorkOrder) => `${window.location.origin}/orden/${order.portalToken}`;

/**
 * Link de "Mi historial RAPIFIX" del dueño de la orden (la empresa si el vehículo es de flota; si no, el cliente).
 * Vacío si el historial no está activo o si no se puede leer (por ejemplo, el técnico no lee empresas).
 */
export async function historyUrlForOrder(order: Pick<WorkOrder, "customerId" | "companyId">): Promise<string> {
  try {
    const ref = order.companyId ? doc(db, companyCol.companies(TENANT_ID), order.companyId) : doc(db, col.customers(TENANT_ID), order.customerId);
    const link = (await getDoc(ref)).get("history") as HistoryLink | undefined;
    return historyLinkState(link) === "active" ? `${window.location.origin}${historyPath(link!.token!)}` : "";
  } catch {
    return "";
  }
}

/** Igual que historyUrlForOrder, como hook (para mensajes que se muestran en pantalla). */
export function useOrderHistoryUrl(order: Pick<WorkOrder, "customerId" | "companyId"> | null | undefined): string {
  const [url, setUrl] = useState("");
  const customerId = order?.customerId;
  const companyId = order?.companyId ?? null;
  useEffect(() => {
    let alive = true;
    if (!customerId && !companyId) return;
    void historyUrlForOrder({ customerId: customerId ?? "", companyId }).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [customerId, companyId]);
  return url;
}

export function orderVars(order: WorkOrder, settings: WorkshopSettings, historial = "") {
  return {
    cliente: order.customer.fullName.split(" ")[0] ?? order.customer.fullName,
    vehiculo: `${order.vehicle.make} ${order.vehicle.model} ${order.vehicle.year}`,
    placa: formatPlate(order.vehicle.plate),
    orden: order.code,
    total: formatMoney(order.totals?.total ?? 0),
    taller: settings.name || "RAPIFIX",
    link: PORTAL_ENABLED && order.portalToken ? portalUrl(order) : "",
    historial,
  };
}

/**
 * Mensaje sugerido para el estado. `historial`: link del historial si está activo; en "Vehículo listo" y
 * "Agradecimiento" se agrega al final (si la plantilla del taller no lo trae ya).
 */
export function messageForStatus(order: WorkOrder, status: WorkOrderStatus, settings: WorkshopSettings, historial = ""): string | null {
  const t = templateForStatus(status);
  return t ? withHistoryLine(t.key, t.body, renderTemplate(t.body, orderVars(order, settings, historial)), historial) : null;
}

export function messageFromTemplate(order: WorkOrder, key: string, settings: WorkshopSettings, historial = ""): string {
  const body = templateBody(key);
  return body ? withHistoryLine(key, body, renderTemplate(body, orderVars(order, settings, historial)), historial) : "";
}

/** Fallback manual: abre WhatsApp con el mensaje listo para enviar. */
export function openWhatsApp(order: WorkOrder, text: string) {
  const phone = order.customer.whatsapp || order.customer.phone;
  window.open(whatsappLink(phone, text), "_blank", "noopener");
}
