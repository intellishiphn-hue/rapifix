import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, MessageCircle } from "lucide-react";
import { formatPhoneIntl, hnDayKey, WA_AVAILABILITY_LABELS, type WaAvailability } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatRelative, toDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { createWaWorkerToken, revokeWaWorkerToken, saveWaAutoSettings, useOutbox, useWaAuto, WA_DOC_URL } from "@/features/whatsapp/auto";

const TONE: Record<WaAvailability, "green" | "gray" | "amber" | "red"> = {
  ready: "green", off: "gray", offline: "red", unlinked: "amber", starting: "amber", gateway_down: "red",
};

/** WhatsApp automático: estado de la computadora del taller, interruptores y clave de conexión. */
export function WaAutoCard({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const { settings, status, availability, loading } = useWaAuto();
  const outbox = useOutbox(100);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"create" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; url: string } | null>(null);
  const [limit, setLimit] = useState<string | null>(null);

  // Estado de la computadora aunque el interruptor esté apagado
  const machine = availability === "off" ? (status?.lastSeenAt ? "Apagado (la computadora está configurada)" : "Apagado") : WA_AVAILABILITY_LABELS[availability];
  const today = useMemo(() => {
    const day = hnDayKey(Date.now());
    const rows = outbox.data.filter((m) => { const d = toDate(m.createdAt); return d ? hnDayKey(d) === day : true; });
    return {
      queued: outbox.data.filter((m) => m.status === "queued" || m.status === "sending").length,
      sent: rows.filter((m) => m.status === "sent").length,
      failed: rows.filter((m) => m.status === "failed").length,
    };
  }, [outbox.data]);

  const save = async (patch: Parameters<typeof saveWaAutoSettings>[0], ok: string) => {
    if (!user) return;
    setSaving(true);
    try {
      await saveWaAutoSettings(patch, user.uid);
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveLimit = () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      toast.error("El límite debe ser un número entre 1 y 1000");
      return;
    }
    void save({ dailyLimit: n }, "Límite guardado").then(() => setLimit(null));
  };

  const runToken = async () => {
    setBusy(true);
    try {
      if (confirm === "create") setCreated(await createWaWorkerToken({}));
      else {
        await revokeWaWorkerToken({});
        toast.success("Clave anulada. La computadora del taller ya no puede enviar.");
      }
      setConfirm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success("Copiado"), () => toast.error("No se pudo copiar"));

  return (
    <Card>
      <CardHeader title="WhatsApp automático" description="Los avisos a clientes salen solos desde la computadora del taller." />
      <div className="space-y-4 p-5 text-sm">
        {loading ? <p className="text-slate-500">Cargando…</p> : (
          <>
            <div className="flex items-start gap-2">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#1faa53]" />
              <Badge tone={TONE[availability]} className="whitespace-normal text-left">{machine}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-slate-500">Número vinculado</dt><dd className="tabular font-semibold text-slate-800">{status?.phone ? formatPhoneIntl(status.phone) : "Sin vincular"}</dd></div>
              <div><dt className="text-slate-500">Última conexión</dt><dd className="font-semibold text-slate-800" title={formatDate(status?.lastSeenAt, true)}>{status?.lastSeenAt ? formatRelative(status.lastSeenAt) : "Nunca"}</dd></div>
              <div><dt className="text-slate-500">En cola</dt><dd className="tabular font-semibold text-slate-800">{today.queued}</dd></div>
              <div><dt className="text-slate-500">Hoy: enviados / fallidos</dt><dd className="tabular font-semibold text-slate-800">{today.sent} / <span className={today.failed ? "text-red-600" : undefined}>{today.failed}</span></dd></div>
            </dl>

            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={settings.waAuto} disabled={saving}
                onChange={(e) => void save({ waAuto: e.target.checked }, e.target.checked ? "WhatsApp automático encendido" : "WhatsApp automático apagado")} />
              <span><span className="font-medium text-slate-800">Enviar mensajes automáticamente</span><span className="block text-xs text-slate-500">Apagado: todo se envía a mano, como siempre.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={settings.waAutoSilent} disabled={saving || !settings.waAuto}
                onChange={(e) => void save({ waAutoSilent: e.target.checked }, "Guardado")} />
              <span><span className="font-medium text-slate-800">Enviar sin preguntar</span><span className="block text-xs text-slate-500">Al cambiar el estado de una orden, el aviso al cliente sale directo, sin mostrar el mensaje antes.</span></span>
            </label>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>Máximo de mensajes por día:</span>
              {limit === null ? (
                <><b className="tabular text-slate-800">{settings.dailyLimit}</b><button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setLimit(String(settings.dailyLimit))}>Cambiar</button></>
              ) : (
                <><Input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} className="h-9 w-24" /><Button size="sm" loading={saving} onClick={saveLimit}>Guardar</Button><Button size="sm" variant="ghost" onClick={() => setLimit(null)}>Cancelar</Button></>
              )}
            </div>
            <p className="text-xs text-slate-500">Solo se envía de 7:00 a.m. a 8:00 p.m. Si la computadora está apagada o WhatsApp se desconecta, el panel vuelve solo al envío manual.</p>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">
                Clave de conexión: {status?.hasToken ? <b className="text-slate-700">creada {formatRelative(status.tokenCreatedAt)}</b> : "sin crear"}.
                {" "}Se pone en la computadora del taller para que pueda enviar.
              </p>
              {isAdmin ? (
                <>
                  <Button variant="secondary" className="w-full" icon={<KeyRound className="h-4 w-4" />} onClick={() => setConfirm("create")}>{status?.hasToken ? "Generar una clave nueva" : "Generar clave de conexión"}</Button>
                  {status?.hasToken && <Button variant="ghost" className="w-full text-red-600 hover:text-red-700" onClick={() => setConfirm("revoke")}>Anular la clave</Button>}
                </>
              ) : <p className="text-xs text-slate-500">Solo el administrador puede generar la clave.</p>}
              <a href={WA_DOC_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                Guía de instalación paso a paso <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => void runToken()}
        loading={busy}
        title={confirm === "revoke" ? "Anular la clave de conexión" : "Generar clave de conexión"}
        message={confirm === "revoke"
          ? "La computadora del taller dejará de enviar mensajes hasta que le ponga una clave nueva."
          : status?.hasToken ? "La clave anterior deja de funcionar. Tendrá que poner la nueva en la computadora del taller." : "La clave se muestra una sola vez. Téngala a mano para copiarla en la computadora del taller."}
        confirmLabel={confirm === "revoke" ? "Anular" : "Generar"}
      />

      <Dialog open={!!created} onClose={() => setCreated(null)} title="Clave de conexión" description="Cópiela ahora: no se vuelve a mostrar." footer={<Button onClick={() => setCreated(null)}>Ya la copié</Button>}>
        {created && (
          <div className="space-y-4 text-sm">
            <div className="flex gap-2">
              <Input readOnly value={created.token} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copy(created.token)} aria-label="Copiar clave" />
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
              <li>En la computadora del taller abra la carpeta <b>wa-worker</b> y el archivo <b>.env</b>.</li>
              <li>Pegue la clave después de <span className="font-mono text-xs">RAPIFIX_WORKER_TOKEN=</span></li>
              <li>Revise que la dirección sea <span className="break-all font-mono text-xs">{created.url}</span></li>
              <li>Guarde el archivo y arranque el programa (<span className="font-mono text-xs">npm start</span>).</li>
            </ol>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Esta clave es como una contraseña. No la pegue en chats, correos ni capturas de pantalla. Si se filtra, genere una nueva.</p>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
