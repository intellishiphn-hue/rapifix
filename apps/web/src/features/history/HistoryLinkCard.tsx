import { useState } from "react";
import { Copy, ExternalLink, History, Link2, MessageCircle, PowerOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { historyPath, historyWhatsAppMessage, type HistoryKind, type HistoryLink, type TimestampLike } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";

type LinkResult = { token: string | null; path: string | null; enabled: boolean };
const enableHistoryLink = callable<{ kind: HistoryKind; id: string }, LinkResult>("enableHistoryLink");
const regenerateHistoryLink = callable<{ kind: HistoryKind; id: string }, LinkResult>("regenerateHistoryLink");
const disableHistoryLink = callable<{ kind: HistoryKind; id: string }, LinkResult>("disableHistoryLink");

/** Quién puede activar, enviar y desactivar el link (igual que las funciones). */
const MANAGERS = new Set(["admin", "manager", "reception"]);

/**
 * Tarjeta "Historial para el cliente" en la ficha del cliente o de la empresa: activa el link
 * privado /historial/:token, lo copia, lo envía por WhatsApp, lo cambia o lo apaga.
 */
export function HistoryLinkCard({
  kind, id, name, history, phone, recipientName,
}: {
  kind: HistoryKind;
  id: string;
  name: string;
  history: HistoryLink | null | undefined;
  /** WhatsApp del cliente o del contacto de la empresa */
  phone: string;
  recipientName: string;
}) {
  const { role } = useAuth();
  const [busy, setBusy] = useState<"enable" | "regenerate" | "disable" | null>(null);
  const [confirm, setConfirm] = useState<"regenerate" | "disable" | null>(null);
  const [sending, setSending] = useState(false);
  // Respuesta de la función: se muestra al instante, antes de que llegue el cambio del documento
  const [local, setLocal] = useState<LinkResult | null>(null);
  if (!role || !MANAGERS.has(role)) return null;

  const token = local ? local.token : history?.enabled ? history.token : null;
  const url = token ? `${window.location.origin}${historyPath(token)}` : "";
  const since = history?.enabled && history.createdAt && !local ? formatDate(history.createdAt as TimestampLike) : "";
  const who = kind === "company" ? "la empresa" : "el cliente";

  const run = async (action: "enable" | "regenerate" | "disable") => {
    setBusy(action);
    try {
      const fn = action === "enable" ? enableHistoryLink : action === "regenerate" ? regenerateHistoryLink : disableHistoryLink;
      const r = await fn({ kind, id });
      setLocal(r);
      toast.success(action === "enable" ? "Link del historial activado" : action === "regenerate" ? "Link nuevo listo. El anterior ya no funciona." : "Link desactivado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-brand-600" /> Historial para {kind === "company" ? "la empresa" : "el cliente"}</span>}
        action={token ? <Badge tone="green">Activo</Badge> : <Badge tone="gray">Apagado</Badge>}
      />
      <div className="space-y-3 px-5 py-4 text-sm">
        {!token ? (
          <>
            <p className="text-slate-600">
              Un link privado donde {who} ve sus visitas, trabajos, pagos con recibo, lavados y próximos mantenimientos. No vence; lo puede apagar cuando quiera.
            </p>
            <p className="text-xs text-slate-500">
              {history && history.enabled === false
                ? "Lo desactivó el taller: no se vuelve a activar solo. Si lo activa de nuevo, tendrá un link nuevo."
                : "Se activa solo con la próxima orden de trabajo."}
            </p>
            <Button icon={<Link2 className="h-4 w-4" />} loading={busy === "enable"} onClick={() => void run("enable")}>Activar link</Button>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={url}>{url}</span>
              <button type="button" onClick={() => void copy()} className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Copiar link"><Copy className="h-4 w-4" /></button>
              <a href={url} target="_blank" rel="noreferrer" className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-900" aria-label="Abrir el historial"><ExternalLink className="h-4 w-4" /></a>
            </div>
            {since && <p className="text-xs text-slate-500">Activo desde {since}{history?.source === "order" ? " (se activó solo con una orden)" : history?.source === "bulk" ? " (activado con \"Activar a todos\")" : ""}. Se actualiza solo con cada orden, pago, lavado y mantenimiento.</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />} onClick={() => setSending(true)}>Enviar por WhatsApp</Button>
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()}>Copiar</Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setConfirm("regenerate")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"><RefreshCw className="h-3.5 w-3.5" /> Cambiar link</button>
              <button type="button" onClick={() => setConfirm("disable")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700"><PowerOff className="h-3.5 w-3.5" /> Desactivar</button>
            </div>
          </>
        )}
      </div>

      {sending && token && (
        <Dialog open onClose={() => setSending(false)} title="Enviar el historial por WhatsApp" description="El mensaje lleva el link privado. Puede editarlo antes de enviarlo." footer={<Button variant="ghost" onClick={() => setSending(false)}>Cerrar</Button>}>
          <WhatsAppComposer context="historial" to={{ phone, name: recipientName }} initial={historyWhatsAppMessage(kind, kind === "company" ? recipientName || name : name, url)} onSent={() => setSending(false)} />
        </Dialog>
      )}
      <ConfirmDialog
        open={confirm === "regenerate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void run("regenerate")}
        loading={busy === "regenerate"}
        title="¿Cambiar el link del historial?"
        message={`El link actual deja de funcionar de inmediato y se crea uno nuevo. Use esto si ${who} compartió el link con alguien más. Tendrá que enviarle el nuevo.`}
        confirmLabel="Cambiar link"
      />
      <ConfirmDialog
        open={confirm === "disable"}
        onClose={() => setConfirm(null)}
        onConfirm={() => void run("disable")}
        loading={busy === "disable"}
        danger
        title="¿Desactivar el historial?"
        message={`El link deja de funcionar y ${who} verá un aviso para escribirnos por WhatsApp. Puede activarlo de nuevo cuando quiera (con un link nuevo).`}
        confirmLabel="Desactivar"
      />
    </Card>
  );
}
