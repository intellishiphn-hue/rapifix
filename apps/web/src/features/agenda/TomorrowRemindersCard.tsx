import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, CalendarPlus, Check, ChevronRight, MessageCircle, SkipForward } from "lucide-react";
import { collection, limit, query, where } from "firebase/firestore";
import { formatPhone, hnDayKey, opsCol, type Appointment } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { setAppointmentStatus } from "./api";
import { AppointmentDialog } from "./AppointmentDialog";
import { appointmentMessage } from "./AppointmentDetailDialog";
import { fmtTime } from "./time";
import { JustCreatedConfirm } from "./JustCreatedConfirm";

/**
 * Dashboard: citas de mañana para recordarle al cliente por WhatsApp, una por una.
 * También deja crear una cita nueva sin ir a la Agenda.
 */
export function TomorrowRemindersCard() {
  const tomorrow = hnDayKey(Date.now() + 86400000);
  const { data, loading } = useQueryData<Appointment>(
    query(collection(db, opsCol.appointments(TENANT_ID)), where("dayKey", "==", tomorrow), limit(100)),
    `dash-appointments-${tomorrow}`,
  );
  const { settings } = useSettings();
  const list = useMemo(
    () => data.filter((a) => a.status === "scheduled" || a.status === "confirmed").sort((a, b) => a.start.toMillis() - b.start.toMillis()),
    [data],
  );
  const pending = list.filter((a) => a.phone && !a.reminderSentAt);
  const [queue, setQueue] = useState<Appointment[] | null>(null);
  const [index, setIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const current = queue?.[index] ?? null;

  const advance = () => {
    if (!queue) return;
    if (index + 1 >= queue.length) {
      toast.success("Listo, se recordó a todos");
      setQueue(null);
    } else setIndex(index + 1);
  };

  return (
    <Card>
      <CardHeader
        title="Citas de mañana"
        description={loading ? undefined : `${list.length} cita(s) · recuérdele al cliente por WhatsApp`}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nueva cita</Button>
            <Link to="/agenda" className="hidden items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline sm:flex">Agenda<ChevronRight className="h-4 w-4" /></Link>
          </div>
        }
      />
      <div className="p-5 pt-2">
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : !list.length ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay citas para mañana.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {list.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <span className="tabular w-16 shrink-0 text-sm font-semibold text-slate-900">{fmtTime(a.start.toMillis())}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{a.customerName}</div>
                    <div className="truncate text-xs text-slate-500">{[a.vehicleLabel, a.plate].filter(Boolean).join(" · ") || "Sin vehículo"}</div>
                  </div>
                  {a.status === "confirmed" && <Badge tone="blue">Confirmada</Badge>}
                  {a.reminderSentAt ? (
                    <Badge tone="green"><Check className="h-3 w-3" />Recordada</Badge>
                  ) : a.phone ? (
                    <Button size="sm" className="bg-[#1faa53] hover:bg-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} onClick={() => { setQueue([a]); setIndex(0); }}>Recordar</Button>
                  ) : (
                    <Badge tone="gray">Sin teléfono</Badge>
                  )}
                </li>
              ))}
            </ul>
            {pending.length > 1 && (
              <Button className="mt-3 w-full bg-[#1faa53] hover:bg-[#178a43]" icon={<BellRing className="h-4 w-4" />} onClick={() => { setQueue(pending); setIndex(0); }}>
                Recordar a todos uno por uno ({pending.length})
              </Button>
            )}
          </>
        )}
      </div>

      <Dialog
        open={!!current}
        onClose={() => setQueue(null)}
        title={queue && queue.length > 1 ? `Recordatorio ${index + 1} de ${queue.length}` : "Recordatorio de cita"}
        description={current ? `${current.customerName} · ${formatPhone(current.phone)}` : undefined}
        footer={queue && queue.length > 1 ? <Button variant="ghost" icon={<SkipForward className="h-4 w-4" />} onClick={advance}>Saltar esta</Button> : undefined}
      >
        {current && (
          <WhatsAppComposer
            key={current.id}
            context="cita"
            to={{ phone: current.phone, name: current.customerName }}
            initial={appointmentMessage(current, settings.name || "RAPIFIX", "reminder")}
            onSent={() => {
              void setAppointmentStatus({ appointmentId: current.id, sent: "reminder" }).catch(() => undefined);
              advance();
            }}
          />
        )}
      </Dialog>
      <AppointmentDialog open={creating} onClose={() => setCreating(false)} onSaved={setJustCreated} />
      {justCreated && <JustCreatedConfirm id={justCreated} onClose={() => setJustCreated(null)} />}
    </Card>
  );
}
