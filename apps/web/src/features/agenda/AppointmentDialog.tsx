import { useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { CalendarPlus, UserPlus, X } from "lucide-react";
import {
  APPOINTMENT_TYPE_LABELS, APPOINTMENT_TYPES, formatPhone, isValidPhone, normalizePhone, saveAppointmentSchema,
  type Appointment, type AppointmentType, type Customer, type SaveAppointmentInput, type Vehicle,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { customerRef } from "@/features/customers/api";
import { useCustomerVehicles, vehicleRef } from "@/features/vehicles/api";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useVehicleOrders } from "@/features/work-orders/api";
import { saveAppointment, useAgendaStaff, type AppointmentPreset } from "./api";
import { ClientSearch, type SearchPick } from "./ClientSearch";
import { combine, msToDayKey, timeInput } from "./time";

interface ClientSel {
  customerId: string | null;
  customerName: string;
  phone: string;
  vehicleId: string | null;
  vehicleLabel: string;
  plate: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
const durationLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const vehicleLabelOf = (v: Vehicle) => `${v.make} ${v.model} ${v.year ?? ""}`.trim();

function nextSlot(): number {
  const now = Date.now();
  const hour = 3600 * 1000;
  return Math.ceil(now / hour) * hour;
}

async function customerPhone(customerId: string): Promise<string> {
  const s = await getDoc(customerRef(customerId)).catch(() => null);
  if (!s?.exists()) return "";
  const c = s.data() as Customer;
  return c.whatsapp || c.phone || "";
}

/**
 * Crear o editar una cita. Reutilizable desde Mantenimiento y desde la orden de trabajo
 * con `preset` (tipo, vehículo, orden, mantenimiento...).
 */
export function AppointmentDialog({
  open,
  onClose,
  appointment,
  preset,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  preset?: AppointmentPreset | null;
  onSaved?: (id: string) => void;
}) {
  const staff = useAgendaStaff();
  const [type, setType] = useState<AppointmentType>("appointment");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("08:00");
  const [duration, setDuration] = useState(60);
  const [client, setClient] = useState<ClientSel | null>(null);
  const [manual, setManual] = useState(false);
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [workOrderCode, setWorkOrderCode] = useState<string | null>(null);
  const [maintenanceId, setMaintenanceId] = useState<string | null>(null);
  const [techId, setTechId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Inicializa al abrir
  useEffect(() => {
    if (!open) return;
    const src: AppointmentPreset = appointment
      ? {
          type: appointment.type,
          start: appointment.start.toMillis(),
          durationMin: appointment.durationMin,
          customerId: appointment.customerId,
          customerName: appointment.customerName,
          phone: appointment.phone,
          vehicleId: appointment.vehicleId,
          vehicleLabel: appointment.vehicleLabel,
          plate: appointment.plate,
          workOrderId: appointment.workOrderId,
          workOrderCode: appointment.workOrderCode,
          maintenanceId: appointment.maintenanceId,
          technicianId: appointment.technicianId,
          notes: appointment.notes,
        }
      : preset ?? {};
    const start = src.start ?? nextSlot();
    setType(src.type ?? "appointment");
    setDay(msToDayKey(start));
    setTime(timeInput(start));
    setDuration(src.durationMin ?? 60);
    setWorkOrderId(src.workOrderId ?? null);
    setWorkOrderCode(src.workOrderCode ?? null);
    setMaintenanceId(src.maintenanceId ?? null);
    setTechId(src.technicianId ?? "");
    setNotes(src.notes ?? "");
    const hasClient = !!(src.customerId || src.vehicleId || src.customerName);
    setManual(!!(hasClient && !src.customerId && !src.vehicleId));
    setClient(
      hasClient
        ? {
            customerId: src.customerId ?? null,
            customerName: src.customerName ?? "",
            phone: src.phone ?? "",
            vehicleId: src.vehicleId ?? null,
            vehicleLabel: src.vehicleLabel ?? "",
            plate: src.plate ?? "",
          }
        : null,
    );
    // Si solo llegó el id del vehículo, completa los datos
    if (src.vehicleId && !src.vehicleLabel) {
      void getDoc(vehicleRef(src.vehicleId)).then(async (s) => {
        if (!s.exists()) return;
        const v = { id: s.id, ...s.data() } as Vehicle;
        const phone = src.phone || (await customerPhone(v.customerId)) || v.customer?.phone || "";
        setClient((c) => ({
          customerId: c?.customerId ?? v.customerId,
          customerName: c?.customerName || v.customer?.fullName || "",
          phone: c?.phone || phone,
          vehicleId: v.id,
          vehicleLabel: vehicleLabelOf(v),
          plate: v.plate,
        }));
      });
    }
    // Solo al abrir (o al cambiar de cita): el preset puede ser un objeto nuevo en cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id]);

  const customerVehicles = useCustomerVehicles(open && client?.customerId && !client.vehicleId ? client.customerId : undefined);
  const vehicleOrders = useVehicleOrders(open && client?.vehicleId ? client.vehicleId : undefined);
  const orderOptions = vehicleOrders.data.filter((o) => o.isOpen || o.id === workOrderId);

  const pick = async (p: SearchPick) => {
    if (p.kind === "vehicle") {
      const v = p.vehicle;
      setClient({ customerId: v.customerId, customerName: v.customer?.fullName ?? "", phone: v.customer?.phone ?? "", vehicleId: v.id, vehicleLabel: vehicleLabelOf(v), plate: v.plate });
      const phone = await customerPhone(v.customerId);
      if (phone) setClient((c) => (c && c.vehicleId === v.id ? { ...c, phone } : c));
    } else {
      const c = p.customer;
      setClient({ customerId: c.id, customerName: c.fullName, phone: c.whatsapp || c.phone || "", vehicleId: null, vehicleLabel: "", plate: "" });
    }
    setWorkOrderId(null);
    setWorkOrderCode(null);
  };

  const submit = async () => {
    if (!day || !time) return toast.error("Indique la fecha y la hora");
    if (!client || (!client.customerId && !client.customerName.trim())) return toast.error("Indique el cliente");
    if (manual && client.phone && !isValidPhone(client.phone)) return toast.error("El teléfono no es válido");
    const input: SaveAppointmentInput = {
      type,
      start: combine(day, time),
      durationMin: duration,
      customerName: client.customerName.trim(),
      phone: client.phone ? (manual ? normalizePhone(client.phone) : client.phone) : "",
      notes: notes.trim(),
    };
    // Firebase convierte undefined en null: solo se envían los campos con valor
    if (appointment) input.appointmentId = appointment.id;
    if (client.customerId) input.customerId = client.customerId;
    if (client.vehicleId) input.vehicleId = client.vehicleId;
    if (workOrderId) input.workOrderId = workOrderId;
    if (maintenanceId) input.maintenanceId = maintenanceId;
    if (techId) input.technicianId = techId;
    const parsed = saveAppointmentSchema.safeParse(input);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
    setSaving(true);
    try {
      const { appointmentId } = await saveAppointment(input);
      toast.success(appointment ? "Cita actualizada" : "Cita agendada");
      onSaved?.(appointmentId);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={appointment ? "Editar cita" : "Nueva cita"}
      description={maintenanceId ? "Cita para un mantenimiento programado." : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button icon={<CalendarPlus className="h-4 w-4" />} loading={saving} onClick={() => void submit()}>{appointment ? "Guardar cambios" : "Agendar"}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" className="sm:col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value as AppointmentType)}>
            {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{APPOINTMENT_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Fecha" required>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hora" required>
            <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Duración">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[...new Set([...DURATIONS, duration])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </Select>
          </Field>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-slate-700">Cliente y vehículo<span className="ml-0.5 text-red-500">*</span></span>
            {!client && !manual && (
              <button type="button" onClick={() => { setManual(true); setClient({ customerId: null, customerName: "", phone: "", vehicleId: null, vehicleLabel: "", plate: "" }); }} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                <UserPlus className="h-3.5 w-3.5" /> Cliente no registrado
              </button>
            )}
          </div>
          {manual && client ? (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                Cliente no registrado
                <button type="button" onClick={() => { setManual(false); setClient(null); }} className="font-semibold text-brand-700">Buscar registrado</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Nombre" value={client.customerName} onChange={(e) => setClient({ ...client, customerName: e.target.value })} />
                <Input placeholder="Teléfono (WhatsApp)" inputMode="tel" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
              </div>
            </div>
          ) : client ? (
            <div className="rounded-xl border-2 border-brand-500 bg-brand-50/40 p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{client.customerName || "Cliente"}</div>
                  <div className="text-sm text-slate-600">{formatPhone(client.phone) || "Sin teléfono"}</div>
                  {client.vehicleId && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      {client.plate && <PlateTag plate={client.plate} />} {client.vehicleLabel}
                      <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => { setClient({ ...client, vehicleId: null, vehicleLabel: "", plate: "" }); setWorkOrderId(null); setWorkOrderCode(null); }}>Cambiar vehículo</button>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => { setClient(null); setWorkOrderId(null); setWorkOrderCode(null); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-white" aria-label="Quitar cliente">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {client.customerId && !client.vehicleId && (
                <Select
                  className="mt-2"
                  value=""
                  onChange={(e) => {
                    const v = customerVehicles.data.find((x) => x.id === e.target.value);
                    if (v) setClient({ ...client, vehicleId: v.id, vehicleLabel: vehicleLabelOf(v), plate: v.plate });
                  }}
                >
                  <option value="">{customerVehicles.loading ? "Cargando vehículos..." : customerVehicles.data.length ? "Elegir vehículo (opcional)" : "El cliente no tiene vehículos"}</option>
                  {customerVehicles.data.filter((v) => !v.archived).map((v) => <option key={v.id} value={v.id}>{v.plate} · {vehicleLabelOf(v)}</option>)}
                </Select>
              )}
            </div>
          ) : (
            <ClientSearch onPick={(p) => void pick(p)} />
          )}
        </div>

        {client?.vehicleId && (
          <Field label="Orden relacionada" hint="Opcional">
            <Select
              value={workOrderId ?? ""}
              onChange={(e) => {
                const o = orderOptions.find((x) => x.id === e.target.value);
                setWorkOrderId(o?.id ?? null);
                setWorkOrderCode(o?.code ?? null);
              }}
            >
              <option value="">Sin orden</option>
              {workOrderId && !orderOptions.some((o) => o.id === workOrderId) && <option value={workOrderId}>{workOrderCode ?? "Orden actual"}</option>}
              {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Técnico" hint="Opcional" className={client?.vehicleId ? "" : "sm:col-span-2"}>
          <Select value={techId} onChange={(e) => setTechId(e.target.value)}>
            <option value="">Sin asignar</option>
            {staff.assignable.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            {techId && !staff.assignable.some((s) => s.id === techId) && <option value={techId}>{appointment?.technicianName || "Técnico actual"}</option>}
          </Select>
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ej. cambio de aceite, revisar frenos..." maxLength={1000} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Botón autocontenido "Agendar" con el diálogo precargado. */
export function ScheduleButton({ preset, label = "Agendar", size = "sm", variant = "secondary" }: { preset: AppointmentPreset; label?: string; size?: "sm" | "md"; variant?: "secondary" | "primary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>{label}</Button>
      <AppointmentDialog open={open} onClose={() => setOpen(false)} preset={open ? preset : null} />
    </>
  );
}
