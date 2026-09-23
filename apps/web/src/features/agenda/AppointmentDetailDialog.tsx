import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, Car, ClipboardList, KeyRound, MessageCircle, Pencil, Phone, User, Wrench } from "lucide-react";
import {
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUSES, APPOINTMENT_TYPE_LABELS, formatPhone, renderTemplate, templateBody,
  type Appointment, type AppointmentStatus,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatPlate } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useSettings } from "@/features/settings/api";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { setAppointmentStatus, STATUS_TONE } from "./api";
import { fmtLongDay, fmtTime } from "./time";

type MsgKind = "confirm" | "reminder";

export function appointmentMessage(a: Appointment, taller: string, kind: MsgKind): string {
  const start = a.start.toMillis();
  return renderTemplate(templateBody(kind === "confirm" ? "cita_confirmacion" : "cita_recordatorio"), {
    cliente: a.customerName.split(" ")[0] || a.customerName,
    taller,
    fecha: `el ${fmtLongDay(start)} a las ${fmtTime(start)}`,
    vehiculo: a.vehicleLabel,
    placa: a.plate ? formatPlate(a.plate) : "",
  }).replace(/\nVehículo: \*\* \(placa \)/, "").replace(/ \(placa \)/, "");
}

export function AppointmentDetailDialog({
  appointment: a,
  onClose,
  onEdit,
  color,
  initialMsg = null,
}: {
  appointment: Appointment | null;
  onClose: () => void;
  onEdit: (a: Appointment) => void;
  color: string;
  /** Abre directo el mensaje de WhatsApp (ej. confirmación al crear la cita) */
  initialMsg?: MsgKind | null;
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [busy, setBusy] = useState<AppointmentStatus | null>(null);
  const [msg, setMsg] = useState<MsgKind | null>(initialMsg);
  const canManage = can("agenda.manage");
  const taller = settings.name || "RAPIFIX";
  const text = useMemo(() => (a && msg ? appointmentMessage(a, taller, msg) : ""), [a, msg, taller]);

  if (!a) return null;
  const start = a.start.toMillis();
  const end = a.end?.toMillis?.() ?? start + a.durationMin * 60000;

  const changeStatus = async (status: AppointmentStatus) => {
    setBusy(status);
    try {
      await setAppointmentStatus({ appointmentId: a.id, status });
      toast.success(`Cita: ${APPOINTMENT_STATUS_LABELS[status]}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    setMsg(null);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          {APPOINTMENT_TYPE_LABELS[a.type]}
          <Badge tone={STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
        </span>
      }
      description={<span className="capitalize">{fmtLongDay(start)} · {fmtTime(start)} – {fmtTime(end)}</span>}
    >
      <div className="space-y-4">
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-center gap-2.5">
            <User className="h-4 w-4 shrink-0 text-slate-400" />
            {a.customerId ? <Link to={`/clientes/${a.customerId}`} className="font-semibold text-slate-900 hover:text-brand-700">{a.customerName}</Link> : <span className="font-semibold">{a.customerName}</span>}
            {!a.customerId && <Badge>No registrado</Badge>}
          </div>
          {a.phone && (
            <div className="flex items-center gap-2.5">
              <Phone className="h-4 w-4 shrink-0 text-slate-400" />
              <a href={`tel:${a.phone}`} className="text-slate-700 hover:text-brand-700">{formatPhone(a.phone)}</a>
            </div>
          )}
          {a.vehicleId && (
            <div className="flex items-center gap-2.5">
              <Car className="h-4 w-4 shrink-0 text-slate-400" />
              <Link to={`/vehiculos/${a.vehicleId}`} className="flex items-center gap-2 text-slate-800 hover:text-brand-700">{a.plate && <PlateTag plate={a.plate} />} {a.vehicleLabel}</Link>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <Wrench className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-slate-700">{a.technicianName || <span className="text-slate-400">Sin técnico asignado</span>}</span>
          </div>
          {a.workOrderId && (
            <div className="flex items-center gap-2.5">
              <ClipboardList className="h-4 w-4 shrink-0 text-slate-400" />
              <Link to={`/ordenes/${a.workOrderId}`} className="font-semibold text-brand-700">Orden {a.workOrderCode ?? ""}</Link>
            </div>
          )}
          {a.maintenanceId && (
            <div className="flex items-center gap-2.5">
              <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="text-slate-700">Vinculada a un mantenimiento programado</span>
            </div>
          )}
          {a.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-slate-700">{a.notes}</p>}
        </dl>

        {canManage && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</div>
            <div className="flex flex-wrap gap-2">
              {APPOINTMENT_STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={!!busy || s === a.status}
                  onClick={() => void changeStatus(s)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:cursor-default",
                    s === a.status ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 disabled:opacity-50",
                  )}
                >
                  {busy === s ? "..." : APPOINTMENT_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {canManage && <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(a)}>Editar</Button>}
          {canManage && a.phone && (
            <>
              <Button size="sm" variant={msg === "confirm" ? "primary" : "secondary"} icon={<MessageCircle className="h-4 w-4" />} onClick={() => setMsg(msg === "confirm" ? null : "confirm")}>Confirmación</Button>
              <Button size="sm" variant={msg === "reminder" ? "primary" : "secondary"} icon={<MessageCircle className="h-4 w-4" />} onClick={() => setMsg(msg === "reminder" ? null : "reminder")}>Recordatorio</Button>
            </>
          )}
          {a.workOrderId && <Link to={`/ordenes/${a.workOrderId}`}><Button size="sm" variant="secondary" icon={<ClipboardList className="h-4 w-4" />}>Abrir orden</Button></Link>}
          {can("orders.create") && !a.workOrderId && a.status !== "cancelled" && (
            <Button
              size="sm"
              icon={<KeyRound className="h-4 w-4" />}
              onClick={() => navigate(a.vehicleId ? `/ordenes/nueva?vehiculo=${a.vehicleId}` : "/ordenes/nueva")}
            >
              Recibir vehículo
            </Button>
          )}
        </div>

        {msg && a.phone && (
          <WhatsAppComposer
            context="cita"
            to={{ phone: a.phone, name: a.customerName }}
            initial={text}
            onSent={() => void setAppointmentStatus({ appointmentId: a.id, sent: msg === "confirm" ? "confirmation" : "reminder" }).catch(() => undefined)}
          />
        )}
      </div>
    </Dialog>
  );
}
