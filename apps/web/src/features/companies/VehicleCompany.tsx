import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Pencil, Plus } from "lucide-react";
import { paymentTermsLabel, type Vehicle } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { assignVehicleToCompany, useCompanies } from "./api";

/** Bloque "Empresa" de la ficha del vehículo: ver, asignar o quitar la empresa (flota). */
export function VehicleCompany({ vehicle }: { vehicle: Vehicle }) {
  const { can } = useAuth();
  const canRead = can("companies.read");
  const canWrite = can("vehicles.write") && canRead;
  const [open, setOpen] = useState(false);
  if (!vehicle.companyId && !canWrite) return null;
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Empresa (flota)</span>
        {canWrite && !vehicle.archived && (
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
            {vehicle.companyId ? <><Pencil className="h-3 w-3" /> Cambiar</> : <><Plus className="h-3 w-3" /> Asignar</>}
          </button>
        )}
      </div>
      {vehicle.companyId ? (
        canRead ? (
          <Link to={`/empresas/${vehicle.companyId}`} className="-m-2 flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 className="h-5 w-5" /></span>
            <span className="font-semibold text-slate-900">{vehicle.companyName}</span>
          </Link>
        ) : <span className="font-semibold text-slate-900">{vehicle.companyName}</span>
      ) : <p className="text-sm text-slate-500">No pertenece a ninguna empresa.</p>}
      {open && <AssignCompanyDialog vehicle={vehicle} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AssignCompanyDialog({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState(vehicle.companyId ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await assignVehicleToCompany({ vehicleId: vehicle.id, companyId: companyId || null });
      toast.success(companyId ? `Vehículo asignado${r.openOrdersUpdated ? ". Su orden abierta también quedó con la empresa." : ""}` : "Vehículo quitado de la empresa");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const list = companies.data.filter((c) => c.active !== false || c.id === vehicle.companyId);
  return (
    <Dialog open onClose={onClose} size="sm" title="Empresa del vehículo" description="El dueño del vehículo no cambia; la empresa queda además, para su reporte y estado de cuenta." footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <Field label="Empresa" hint="Las órdenes cerradas se quedan como estaban; la orden abierta pasa a la empresa nueva.">
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">{companies.loading ? "Cargando…" : "Ninguna"}</option>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name} · {paymentTermsLabel(c)}</option>)}
        </Select>
      </Field>
    </Dialog>
  );
}
