import { useState } from "react";
import { toast } from "sonner";
import { STATUS_META, type WorkOrder, type WorkOrderStatus } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useSettings } from "@/features/settings/api";
import { changeWorkOrderStatus } from "./api";
import { StatusChangeDialog } from "./StatusChangeDialog";
import { WhatsAppComposer } from "./WhatsAppComposer";
import { messageForStatus } from "./whatsapp";

const NEEDS_FORM: WorkOrderStatus[] = ["DELIVERED", "CANCELLED"];

/**
 * Cambio de estado en un toque. Solo Entregado y Cancelado abren un formulario
 * (kilometraje de salida / motivo). Recepción y administración ven después el
 * mensaje de WhatsApp sugerido; el técnico no, para no interrumpirlo.
 */
export function useStatusChange() {
  const { role } = useAuth();
  const { settings } = useSettings();
  const [form, setForm] = useState<{ order: WorkOrder; to: WorkOrderStatus } | null>(null);
  const [message, setMessage] = useState<{ order: WorkOrder; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const desk = role === "admin" || role === "manager" || role === "reception";

  const change = async (order: WorkOrder, to: WorkOrderStatus) => {
    if (to === order.status || busyId) return;
    if (NEEDS_FORM.includes(to)) {
      setForm({ order, to });
      return;
    }
    setBusyId(order.id);
    try {
      await changeWorkOrderStatus({ orderId: order.id, toStatus: to });
      toast.success(`${order.code}: ${STATUS_META[to].label}`);
      const text = desk ? messageForStatus(order, to, settings) : null;
      if (text) setMessage({ order, text });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const element = (
    <>
      {form && <StatusChangeDialog order={form.order} to={form.to} onClose={() => setForm(null)} />}
      {message && (
        <Dialog
          open
          onClose={() => setMessage(null)}
          title="¿Avisar al cliente?"
          description={`${message.order.customer.fullName} · ${message.order.code}`}
          footer={<Button variant="ghost" onClick={() => setMessage(null)}>Ahora no</Button>}
        >
          <WhatsAppComposer order={message.order} initial={message.text} onSent={() => setMessage(null)} />
        </Dialog>
      )}
    </>
  );

  return { change, element, busyId };
}
