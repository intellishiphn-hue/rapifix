import { useRef, useState } from "react";
import { CheckCircle2, History } from "lucide-react";
import { toast } from "sonner";
import type { HistoryBulkInput, HistoryBulkResult, HistoryKind } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

const enableHistoryLinksBulk = callable<HistoryBulkInput, HistoryBulkResult>("enableHistoryLinksBulk");

type Progress = { scanned: number; total: number | null; activated: number; upgraded: number; skippedDisabled: number; noActivity: number };
const ZERO: Progress = { scanned: 0, total: null, activated: 0, upgraded: 0, skippedDisabled: 0, noActivity: 0 };

/**
 * "Activar historial a todos" (Clientes y Empresas). Solo administración y gerencia.
 * Llama a enableHistoryLinksBulk por partes (cursor) hasta terminar y muestra el avance.
 * Activa solo a quienes nunca lo tuvieron y tienen órdenes o lavados. No envía mensajes.
 */
export function BulkHistoryButton({ kind }: { kind: HistoryKind }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [p, setP] = useState<Progress>(ZERO);
  const stop = useRef(false);
  if (role !== "admin" && role !== "manager") return null;
  const who = kind === "company" ? "empresas" : "clientes";

  const run = async () => {
    setPhase("running");
    stop.current = false;
    let cursor: string | null = null;
    let acc: Progress = { ...ZERO };
    try {
      do {
        const r: HistoryBulkResult = await enableHistoryLinksBulk({ kind, cursor });
        acc = {
          scanned: acc.scanned + r.scanned, total: r.total ?? acc.total, activated: acc.activated + r.activated, upgraded: acc.upgraded + r.upgraded,
          skippedDisabled: acc.skippedDisabled + r.skippedDisabled, noActivity: acc.noActivity + r.noActivity,
        };
        setP(acc);
        cursor = r.done ? null : r.cursor;
      } while (cursor && !stop.current);
      setPhase("done");
      toast.success(acc.activated === 1 ? "Se activó 1 historial" : `Se activaron ${acc.activated} historiales`);
    } catch (err) {
      toast.error(errorMessage(err));
      setPhase("done");
    }
  };

  const close = () => {
    if (phase === "running") {
      stop.current = true;
      return;
    }
    setOpen(false);
    setPhase("confirm");
    setP(ZERO);
  };
  const pct = p.total ? Math.min(100, Math.round((p.scanned / p.total) * 100)) : phase === "done" ? 100 : 0;

  return (
    <>
      <Button variant="secondary" icon={<History className="h-4 w-4 text-brand-600" />} onClick={() => setOpen(true)}>Activar historial a todos</Button>
      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title="Activar el historial a todos"
        description={kind === "company" ? "Empresas con flota" : "Clientes del taller"}
        footer={
          phase === "confirm" ? (
            <>
              <Button variant="secondary" onClick={close}>Cancelar</Button>
              <Button onClick={() => void run()}>Sí, activar</Button>
            </>
          ) : phase === "running" ? (
            <Button variant="secondary" onClick={close}>Detener</Button>
          ) : (
            <Button onClick={close}>Listo</Button>
          )
        }
      >
        {phase === "confirm" ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Se activa el link privado del historial a todos los {who} que nunca lo han tenido y que tienen al menos una orden o un lavado.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>No se toca a los que el taller desactivó a propósito.</li>
              <li>No se envía ningún mensaje. Cada link se puede enviar después desde la ficha o al avisar que el vehículo está listo.</li>
              <li>Con muchos {who} puede tardar unos minutos. No cierre esta ventana mientras avanza.</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <div className="flex items-center justify-between font-medium text-slate-700">
                <span>{phase === "running" ? "Activando..." : "Terminado"}</span>
                <span className="tabular-nums text-slate-500">{p.total ? `${p.scanned} de ${p.total}` : `${p.scanned} revisados`}</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Stat label="Activados" value={p.activated} strong />
              <Stat label="Ya activos (completados)" value={p.upgraded} />
              <Stat label="Desactivados a propósito" value={p.skippedDisabled} />
              <Stat label="Sin órdenes ni lavados" value={p.noActivity} />
            </dl>
            {phase === "done" && (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" /> {p.activated === 1 ? "Se activó 1 historial." : `Se activaron ${p.activated} historiales.`} No se envió ningún mensaje.</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={strong ? "text-xl font-bold tabular-nums text-brand-700" : "text-lg font-semibold tabular-nums text-slate-800"}>{value}</dd>
    </div>
  );
}
