import { useEffect, useState } from "react";
import { getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { Wrench, X } from "lucide-react";
import { saveMaintenanceSchema, type Maintenance, type SaveMaintenanceInput, type Vehicle } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatKm } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { CatalogPicker } from "@/features/catalog/CatalogPicker";
import { vehicleRef } from "@/features/vehicles/api";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { ClientSearch } from "@/features/agenda/ClientSearch";
import { msToDayKey, todayKey, dayStartMs } from "@/features/agenda/time";
import { saveMaintenance } from "./api";

const num = (s: string) => (s.trim() === "" ? 0 : Math.round(Number(s.replace(/[^\d]/g, ""))));

export function MaintenanceFormDialog({ open, onClose, maintenance }: { open: boolean; onClose: () => void; maintenance?: Maintenance | null }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [lastDate, setLastDate] = useState(todayKey());
  const [lastKm, setLastKm] = useState("");
  const [days, setDays] = useState("");
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const m = maintenance;
    setVehicle(null);
    setServiceId(m?.serviceId ?? null);
    setServiceName(m?.serviceName ?? "");
    setLastDate(m?.lastDate ? msToDayKey(m.lastDate.toMillis()) : todayKey());
    setLastKm(m ? String(m.lastMileage) : "");
    setDays(m?.intervalDays ? String(m.intervalDays) : "");
    setKm(m?.intervalKm ? String(m.intervalKm) : "");
    setNotes(m?.notes ?? "");
    if (m) {
      void getDoc(vehicleRef(m.vehicleId)).then((s) => s.exists() && setVehicle({ id: s.id, ...s.data() } as Vehicle));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, maintenance?.id]);

  const pickVehicle = (v: Vehicle) => {
    setVehicle(v);
    if (!lastKm) setLastKm(String(v.mileage ?? 0));
  };

  const submit = async () => {
    if (!vehicle) return toast.error("Elija el vehículo");
    const input: SaveMaintenanceInput = {
      vehicleId: vehicle.id,
      serviceName: serviceName.trim(),
      lastDate: lastDate ? dayStartMs(lastDate) + 12 * 3600000 : Date.now(),
      lastMileage: num(lastKm),
      intervalDays: num(days),
      intervalKm: num(km),
      notes: notes.trim(),
    };
    if (maintenance) input.maintenanceId = maintenance.id;
    if (serviceId) input.serviceId = serviceId;
    const parsed = saveMaintenanceSchema.safeParse(input);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
    setSaving(true);
    try {
      await saveMaintenance(input);
      toast.success(maintenance ? "Mantenimiento actualizado" : "Mantenimiento programado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={maintenance ? "Editar mantenimiento" : "Nuevo mantenimiento"}
        description="El sistema calcula la próxima fecha y kilometraje con el intervalo."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button loading={saving} onClick={() => void submit()}>Guardar</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <span className="text-[13px] font-medium text-slate-700">Vehículo<span className="ml-0.5 text-red-500">*</span></span>
            {vehicle ? (
              <div className="flex items-center gap-3 rounded-xl border-2 border-brand-500 bg-brand-50/40 p-3">
                <PlateTag plate={vehicle.plate} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{vehicle.make} {vehicle.model} {vehicle.year}</div>
                  <div className="truncate text-xs text-slate-500">{vehicle.customer?.fullName} · {formatKm(vehicle.mileage ?? 0)}</div>
                </div>
                {!maintenance && (
                  <button type="button" onClick={() => setVehicle(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white" aria-label="Cambiar vehículo"><X className="h-4 w-4" /></button>
                )}
              </div>
            ) : maintenance ? (
              <div className="text-sm text-slate-500">Cargando vehículo...</div>
            ) : (
              <ClientSearch vehiclesOnly onPick={(p) => p.kind === "vehicle" && pickVehicle(p.vehicle)} />
            )}
          </div>

          <Field label="Servicio" required className="sm:col-span-2" hint={serviceId ? "Del catálogo de servicios" : "Elija del catálogo o escriba el nombre"}>
            <div className="flex gap-2">
              <Input value={serviceName} onChange={(e) => { setServiceName(e.target.value); setServiceId(null); }} placeholder="Ej. Cambio de aceite y filtro" />
              <Button variant="secondary" icon={<Wrench className="h-4 w-4" />} onClick={() => setPicker(true)}>Catálogo</Button>
            </div>
          </Field>
          <Field label="Fecha del último servicio">
            <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
          </Field>
          <Field label="Kilometraje del último servicio">
            <Input inputMode="numeric" value={lastKm} onChange={(e) => setLastKm(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Repetir cada (días)" hint="0 o vacío si no aplica">
            <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Ej. 90" />
          </Field>
          <Field label="Repetir cada (km)" hint="0 o vacío si no aplica">
            <Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Ej. 5000" />
          </Field>
          <Field label="Notas" className="sm:col-span-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </Field>
        </div>
      </Dialog>
      <CatalogPicker
        open={picker}
        onClose={() => setPicker(false)}
        only="service"
        onPick={(p) => {
          if (p.kind !== "service") return;
          setServiceId(p.item.id);
          setServiceName(p.item.name);
          if (p.item.intervalDays) setDays(String(p.item.intervalDays));
          if (p.item.intervalKm) setKm(String(p.item.intervalKm));
        }}
      />
    </>
  );
}
