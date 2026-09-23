import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, ChevronRight, MessageCircle, SkipForward } from "lucide-react";
import { formatPhone, type Maintenance } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatPlate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { estimateLabel, maintenanceAction, maintenanceMessage, needsReminder, useMaintenanceByStatus } from "./api";

/**
 * Dashboard: clientes a los que probablemente ya les toca (ej. cambio de aceite) y no se les ha avisado.
 * "Avisar a todos" los va mostrando uno por uno: se abre WhatsApp con el mensaje listo y se pasa al siguiente.
 */
export function ReminderQueueCard() {
  const overdue = useMaintenanceByStatus("overdue", 100);
  const due = useMaintenanceByStatus("due", 100);
  const { settings } = useSettings();
  const pending = useMemo(
    () => [...overdue.data, ...due.data].filter((m) => needsReminder(m)).sort((a, b) => (a.dueDate?.toMillis?.() ?? 0) - (b.dueDate?.toMillis?.() ?? 0)),
    [overdue.data, due.data],
  );
  const [queue, setQueue] = useState<Maintenance[] | null>(null);
  const [index, setIndex] = useState(0);
  const current = queue?.[index] ?? null;
  const loading = overdue.loading || due.loading;

  const start = (list: Maintenance[]) => {
    setQueue(list);
    setIndex(0);
  };
  const advance = () => {
    if (!queue) return;
    if (index + 1 >= queue.length) {
      toast.success("Listo, se avisó a todos");
      setQueue(null);
    } else setIndex(index + 1);
  };
  const markSent = (m: Maintenance) => {
    maintenanceAction({ maintenanceId: m.id, action: "reminder_sent" }).catch((err) => toast.error(errorMessage(err)));
    advance();
  };

  return (
    <Card>
      <CardHeader
        title="Toca mantenimiento"
        description="Clientes a los que ya les toca o está por tocarles (ej. cambio de aceite)"
        action={<Link to="/mantenimiento" className="flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline">Ver todo<ChevronRight className="h-4 w-4" /></Link>}
      />
      <div className="p-5 pt-2">
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : !pending.length ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay clientes pendientes de aviso.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {pending.slice(0, 6).map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{m.customerName}</span>
                      {m.status === "overdue" ? <Badge tone="red">Ya le toca</Badge> : <Badge tone="amber">Pronto</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">{m.serviceName} · {m.vehicleLabel} · {formatPlate(m.plate)}</div>
                    {estimateLabel(m) && <div className="truncate text-xs text-slate-400">{estimateLabel(m)}</div>}
                  </div>
                  <Button size="sm" className="bg-[#1faa53] hover:bg-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} onClick={() => start([m])}>Avisar</Button>
                </li>
              ))}
            </ul>
            <Button className="mt-3 w-full bg-[#1faa53] hover:bg-[#178a43]" icon={<BellRing className="h-4 w-4" />} onClick={() => start(pending)}>
              Avisar a todos uno por uno ({pending.length})
            </Button>
          </>
        )}
      </div>

      <Dialog
        open={!!current}
        onClose={() => setQueue(null)}
        title={queue && queue.length > 1 ? `Recordatorio ${index + 1} de ${queue.length}` : "Recordatorio de mantenimiento"}
        description={current ? `${current.customerName} · ${formatPhone(current.phone)} · ${current.serviceName}` : undefined}
        footer={queue && queue.length > 1 ? <Button variant="ghost" icon={<SkipForward className="h-4 w-4" />} onClick={advance}>Saltar este</Button> : undefined}
      >
        {current && (
          <WhatsAppComposer
            key={current.id}
            to={{ phone: current.phone, name: current.customerName }}
            initial={maintenanceMessage(current, settings.name || "RAPIFIX")}
            onSent={() => markSent(current)}
          />
        )}
      </Dialog>
    </Card>
  );
}
