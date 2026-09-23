import { useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { whatsappLink, type WorkOrder } from "@rapifix/shared";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";

/**
 * Mensaje semiautomático: el sistema lo prepara, el empleado lo revisa y lo envía.
 * (WhatsApp Web automático llega en la Fase 6; esto es el respaldo manual que siempre existirá.)
 */
export function WhatsAppComposer({
  order,
  to,
  initial,
  onSent,
  compact,
}: {
  order?: WorkOrder;
  /** Destinatario directo (cuando no hay orden, ej. cotización directa) */
  to?: { phone: string; name: string };
  initial: string;
  onSent?: () => void;
  compact?: boolean;
}) {
  const phone = to?.phone ?? order?.customer.whatsapp ?? order?.customer.phone ?? "";
  const name = to?.name ?? order?.customer.fullName ?? "el cliente";
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Mensaje copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className="space-y-3">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 3 : 4} />
      <div className="flex flex-wrap gap-2">
        <Button
          className="bg-[#1faa53] hover:bg-[#178a43]"
          icon={<MessageCircle className="h-4 w-4" />}
          disabled={!text.trim() || !phone}
          onClick={() => {
            window.open(whatsappLink(phone, text.trim()), "_blank", "noopener");
            onSent?.();
          }}
        >
          Enviar por WhatsApp
        </Button>
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()} disabled={!text.trim()}>Copiar</Button>
      </div>
      <p className="text-xs text-slate-500">Se abre WhatsApp con el mensaje listo para {name}. Solo toque enviar.</p>
    </div>
  );
}
