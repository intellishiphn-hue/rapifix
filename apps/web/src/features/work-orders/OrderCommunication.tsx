import { useState } from "react";
import { toast } from "sonner";
import { Globe, MessageCircle, Save, Send } from "lucide-react";
import { DEFAULT_TEMPLATES, type OrderEvent, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { cn } from "@/lib/cn";
import { addOrderEvent } from "./api";
import { EventTimeline } from "./OrderHistory";
import { WhatsAppComposer } from "./WhatsAppComposer";
import { messageForStatus, messageFromTemplate, openWhatsApp, PORTAL_ENABLED } from "./whatsapp";

/**
 * Centro de comunicación: una sola actualización que se puede publicar en el
 * portal del cliente, preparar para WhatsApp, o ambas.
 */
export function OrderCommunication({ order, events }: { order: WorkOrder; events: { data: OrderEvent[]; loading: boolean; error: string | null } }) {
  const { can, role, user } = useAuth();
  const { settings } = useSettings();
  const [text, setText] = useState("");
  const [toPortal, setToPortal] = useState(true);
  const [toWhatsApp, setToWhatsApp] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState("");
  const assigned = role !== "technician" || (user && order.technicianIds.includes(user.uid));
  const canPost = can("orders.diagnose") && !!assigned;
  const updates = events.data.filter((e) => e.visibleToCustomer);

  const submit = async (internal: boolean) => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const channels: Array<"portal" | "whatsapp"> = internal ? [] : [...(toPortal ? (["portal"] as const) : []), ...(toWhatsApp ? (["whatsapp"] as const) : [])];
      await addOrderEvent({ orderId: order.id, text: text.trim(), visibleToCustomer: !internal && toPortal, channels });
      if (!internal && toWhatsApp) openWhatsApp(order, `Hola ${order.customer.fullName.split(" ")[0]}, ${text.trim()}`);
      toast.success(internal ? "Nota interna guardada" : "Actualización registrada");
      setText("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const suggested = messageForStatus(order, order.status, settings);

  return (
    <div className="grid gap-5 p-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        {canPost && (
          <Card>
            <CardHeader title="Escribir actualización" description="Escriba una vez y elija por dónde se entera el cliente." />
            <div className="space-y-3 p-5">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="Ej. Se inició el cambio de pastillas de freno delanteras." />
              <div className="flex flex-wrap gap-2">
                <Toggle on={toPortal} onClick={() => setToPortal((v) => !v)} icon={<Globe className="h-4 w-4" />} label="Portal del cliente" />
                <Toggle on={toWhatsApp} onClick={() => setToWhatsApp((v) => !v)} icon={<MessageCircle className="h-4 w-4" />} label="WhatsApp" />
              </div>
              {!PORTAL_ENABLED && toPortal && <p className="text-xs text-slate-500">El portal del cliente se activa en la Fase 3. Las actualizaciones marcadas quedan guardadas y aparecerán ahí automáticamente.</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" icon={<Save className="h-4 w-4" />} disabled={!text.trim()} loading={saving} onClick={() => void submit(true)}>Nota interna</Button>
                <Button icon={<Send className="h-4 w-4" />} disabled={!text.trim() || (!toPortal && !toWhatsApp)} loading={saving} onClick={() => void submit(false)}>Publicar</Button>
              </div>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Actualizaciones al cliente" description="Lo que el cliente verá en su portal." />
          <EventTimeline events={updates} loading={events.loading} error={events.error} empty="Todavía no hay actualizaciones visibles" />
        </Card>
      </div>

      <div className="space-y-5">
        {suggested && canPost && (
          <Card>
            <CardHeader title="Mensaje sugerido" description="Según el estado actual de la orden." />
            <div className="p-5"><WhatsAppComposer order={order} initial={suggested} compact /></div>
          </Card>
        )}
        {canPost && (
          <Card>
            <CardHeader title="Plantillas" />
            <div className="space-y-3 p-5">
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Elegir plantilla...</option>
                {DEFAULT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </Select>
              {template && <WhatsAppComposer order={order} initial={messageFromTemplate(order, template, settings)} compact />}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium", on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500")}>
      {icon} {label}
    </button>
  );
}
