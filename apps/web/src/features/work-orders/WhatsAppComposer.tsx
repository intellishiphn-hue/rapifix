import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Info, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { formatPhoneIntl, normalizePhone, opsCol, WA_AVAILABILITY_LABELS, whatsappLink, type WorkOrder } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { errorMessage } from "@/lib/errors";
import { enqueueWhatsApp, trackOutbox, useOutboxDoc, useWaAuto } from "@/features/whatsapp/auto";

/**
 * Mensaje de WhatsApp: el sistema lo prepara y el empleado lo revisa.
 * - Con el WhatsApp automático activo y la computadora del taller conectada: "Enviar" lo pone en la
 *   cola y sale solo (docs/WHATSAPP-AUTOMATICO.md).
 * - Si no: se abre WhatsApp con el texto listo (envío manual), que siempre queda como respaldo.
 */
export function WhatsAppComposer({
  order,
  to,
  initial,
  onSent,
  compact,
  context,
}: {
  order?: WorkOrder;
  /** Destinatario directo (cuando no hay orden, ej. cotización directa) */
  to?: { phone: string; name: string };
  initial: string;
  onSent?: () => void;
  compact?: boolean;
  /** De dónde sale el mensaje (para el historial): orden, cotización, mantenimiento, cobro, cita... */
  context?: string;
}) {
  const { user } = useAuth();
  const myName = useDisplayName();
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

  const { settings: wa, availability } = useWaAuto();
  const autoReady = availability === "ready";
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);
  const queued = useOutboxDoc(queuedId).data;
  const ctx = (context ?? (order ? "orden" : "mensaje")).slice(0, 40);

  const openManual = () => {
    window.open(whatsappLink(phone, text.trim()), "_blank", "noopener");
    // Historial de WhatsApp (no bloquea el envío si falla)
    if (user) {
      addDoc(collection(db, opsCol.messages(TENANT_ID)), {
        to: (normalizePhone(phone) || phone).slice(0, 20),
        name: name.slice(0, 120),
        body: text.trim().slice(0, 4000),
        orderId: order?.id ?? null,
        orderCode: order?.code ?? null,
        context: ctx,
        mode: "manual",
        createdBy: user.uid,
        createdByName: myName.slice(0, 120),
        at: serverTimestamp(),
      }).catch(() => undefined);
    }
    onSent?.();
  };

  const sendAuto = async (hold: boolean) => {
    setQueuing(true);
    try {
      const id = await enqueueWhatsApp({ phone, name, body: text, context: ctx, orderId: order?.id, orderCode: order?.code, hold });
      setQueuedId(id);
      if (hold) toast.success(`Mensaje para ${name} en cola. Sale cuando encienda la computadora del taller (vence en 12 horas).`);
      else trackOutbox(id, name);
      onSent?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setQueuing(false);
    }
  };

  const whatsappGreen = "bg-[#1faa53] hover:bg-[#178a43]";
  const disabled = !text.trim() || !phone;

  return (
    <div className="space-y-3">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 3 : 4} />
      <div className="flex flex-wrap gap-2">
        {autoReady ? (
          <>
            <Button className={whatsappGreen} icon={<Send className="h-4 w-4" />} disabled={disabled} loading={queuing} onClick={() => void sendAuto(false)}>Enviar</Button>
            <Button variant="secondary" icon={<MessageCircle className="h-4 w-4" />} disabled={disabled} onClick={openManual}>Abrir WhatsApp</Button>
          </>
        ) : (
          <Button className={whatsappGreen} icon={<MessageCircle className="h-4 w-4" />} disabled={disabled} onClick={openManual}>Enviar por WhatsApp</Button>
        )}
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()} disabled={!text.trim()}>Copiar</Button>
      </div>
      {queued && (
        <p className="flex items-start gap-1.5 text-xs font-medium" aria-live="polite">
          {queued.status === "sent" ? <><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /><span className="text-emerald-700">Enviado</span></>
            : queued.status === "failed" || queued.status === "cancelled" ? <><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" /><span className="text-red-700">{queued.status === "failed" ? "Falló" : "Cancelado"}{queued.error ? `: ${queued.error}` : ""}. Puede usar "Abrir WhatsApp".</span></>
            : queued.status === "sending" ? <><Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" /><span className="text-slate-600">Enviando…</span></>
            : <><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="text-slate-600">En cola{queued.error ? ` (reintentando: ${queued.error})` : ""}</span></>}
        </p>
      )}
      {wa.waAuto && !autoReady && (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">WhatsApp automático no disponible: {availability === "offline" ? "la computadora del taller está apagada" : WA_AVAILABILITY_LABELS[availability].toLowerCase()}. Envíe a mano con el botón verde.</span>
          {phone && !queuedId && (
            <button type="button" disabled={disabled || queuing} onClick={() => void sendAuto(true)} className="font-semibold underline underline-offset-2 disabled:opacity-50">
              Encolar para cuando encienda
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">
        {!phone
          ? <>No hay un número de WhatsApp para {name}.</>
          : autoReady
            ? <>Se envía solo a {name} al <span className="tabular whitespace-nowrap font-medium text-slate-700">{formatPhoneIntl(phone)}</span> desde el número del taller.</>
            : <>Se abre WhatsApp con el mensaje listo para {name} al <span className="tabular whitespace-nowrap font-medium text-slate-700">{formatPhoneIntl(phone)}</span>. Solo toque enviar.</>}
      </p>
    </div>
  );
}
