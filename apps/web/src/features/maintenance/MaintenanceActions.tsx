import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, Check, MessageCircle, Pencil, RotateCcw, X } from "lucide-react";
import { formatPhone, type Maintenance } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { combine, msToDayKey } from "@/features/agenda/time";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { AppointmentDialog } from "@/features/agenda/AppointmentDialog";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { maintenanceAction, maintenanceMessage } from "./api";
import { MaintenanceFormDialog } from "./MaintenanceFormDialog";

type Action = "done" | "cancel" | "reminder_sent" | "reopen";

/** Estado de diálogos compartido por la lista de mantenimientos. */
export function useMaintenanceActions() {
  const { settings } = useSettings();
  const [reminder, setReminder] = useState<Maintenance | null>(null);
  const [schedule, setSchedule] = useState<Maintenance | null>(null);
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [cancelling, setCancelling] = useState<Maintenance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (m: Maintenance, action: Action, ok: string) => {
    setBusy(`${m.id}:${action}`);
    try {
      await maintenanceAction({ maintenanceId: m.id, action });
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const element = (
    <>
      <Dialog open={!!reminder} onClose={() => setReminder(null)} title="Recordatorio de mantenimiento" description={reminder ? `Para ${reminder.customerName} · ${formatPhone(reminder.phone)}` : undefined}>
        {reminder && (reminder.phone ? (
          <WhatsAppComposer
            to={{ phone: reminder.phone, name: reminder.customerName }}
            initial={maintenanceMessage(reminder, settings.name || "RAPIFIX")}
            onSent={() => {
              const m = reminder;
              setReminder(null);
              void run(m, "reminder_sent", "Recordatorio registrado");
            }}
          />
        ) : (
          <p className="text-sm text-slate-600">El cliente no tiene teléfono registrado. Agréguelo en su ficha para poder enviarle el recordatorio.</p>
        ))}
      </Dialog>
      <AppointmentDialog
        open={!!schedule}
        onClose={() => setSchedule(null)}
        preset={schedule ? {
          type: "maintenance",
          customerId: schedule.customerId,
          customerName: schedule.customerName,
          phone: schedule.phone,
          vehicleId: schedule.vehicleId,
          vehicleLabel: schedule.vehicleLabel,
          plate: schedule.plate,
          maintenanceId: schedule.id,
          notes: schedule.serviceName,
          ...(schedule.nextDate && schedule.nextDate.toMillis() > Date.now() ? { start: combine(msToDayKey(schedule.nextDate.toMillis()), "08:00") } : {}),
        } : null}
      />
      <MaintenanceFormDialog open={!!editing} onClose={() => setEditing(null)} maintenance={editing} />
      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        loading={!!busy}
        danger
        title="Descartar mantenimiento"
        message="Ya no aparecerá en los pendientes. Puede reabrirlo después desde Realizados / Descartados."
        confirmLabel="Descartar"
        onConfirm={() => {
          const m = cancelling;
          if (m) void run(m, "cancel", "Mantenimiento descartado").then((ok) => ok && setCancelling(null));
        }}
      />
    </>
  );

  return {
    element,
    busy,
    remind: setReminder,
    schedule: setSchedule,
    edit: setEditing,
    cancel: setCancelling,
    done: (m: Maintenance) => void run(m, "done", "Marcado como realizado"),
    reopen: (m: Maintenance) => void run(m, "reopen", "Mantenimiento reabierto"),
  };
}

export type MaintenanceActionsApi = ReturnType<typeof useMaintenanceActions>;

export function MaintenanceButtons({ m, api, compact }: { m: Maintenance; api: MaintenanceActionsApi; compact?: boolean }) {
  const closed = m.status === "done" || m.status === "cancelled";
  const size = "sm" as const;
  if (closed) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Button size={size} variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={api.busy === `${m.id}:reopen`} onClick={() => api.reopen(m)}>Reabrir</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size={size} className="bg-[#1faa53] hover:bg-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} onClick={() => api.remind(m)}>{compact ? "Avisar" : "Recordatorio"}</Button>
      <Button size={size} variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => api.schedule(m)}>{m.appointmentId ? "Reagendar" : "Agendar"}</Button>
      <Button size={size} variant="secondary" icon={<Check className="h-4 w-4" />} loading={api.busy === `${m.id}:done`} onClick={() => api.done(m)} title="Marcar realizado">{compact ? "" : "Realizado"}</Button>
      <Button size={size} variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => api.edit(m)} aria-label="Editar" title="Editar" />
      <Button size={size} variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => api.cancel(m)} aria-label="Descartar" title="Descartar" />
    </div>
  );
}
