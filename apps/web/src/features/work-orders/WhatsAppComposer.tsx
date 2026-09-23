import { useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import type { WorkOrder } from "@rapifix/shared";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { openWhatsApp } from "./whatsapp";

/**
 * Mensaje semiautomático: el sistema lo prepara, el empleado lo revisa y lo envía.
 * (WhatsApp Web automático llega en la Fase 6; esto es el respaldo manual que siempre existirá.)
 */
export function WhatsAppComposer({ order, initial, onSent, compact }: { order: WorkOrder; initial: string; onSent?: () => void; compact?: boolean }) {
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
          disabled={!text.trim()}
          onClick={() => {
            openWhatsApp(order, text.trim());
            onSent?.();
          }}
        >
          Enviar por WhatsApp
        </Button>
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()} disabled={!text.trim()}>Copiar</Button>
      </div>
      <p className="text-xs text-slate-500">Se abre WhatsApp con el mensaje listo para {order.customer.fullName}. Solo toque enviar.</p>
    </div>
  );
}
