import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { toast } from "sonner";
import { CalendarClock, Car, Loader2, Plus, Search, Wrench, X } from "lucide-react";
import {
  col, deliveredMs, formatOdometer, MAINTENANCE_STATUS_LABELS, searchToken,
  type Company, type Maintenance, type Vehicle, type WorkOrder,
} from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { MAINT_TONE } from "@/features/maintenance/api";
import { assignVehicleToCompany, useFleetMaintenance } from "./api";

const ACTIVE_MAINT = new Set(["upcoming", "due", "overdue"]);
const mms = (t: { toMillis?: () => number } | null | undefined) => t?.toMillis?.() ?? null;

interface FleetRow {
  v: Vehicle;
  lastService: number | null;
  open: WorkOrder | null;
  visits: number;
  next: Maintenance | null;
}

/** Pestaña Flota: vehículos de la empresa, último servicio, próximo mantenimiento y órdenes abiertas. */
export function FleetTab({ company, vehicles, orders, loading, error }: { company: Company; vehicles: Vehicle[]; orders: WorkOrder[]; loading: boolean; error: string | null }) {
  const { can } = useAuth();
  const canWrite = can("vehicles.write");
  const active = useMemo(() => vehicles.filter((v) => !v.archived), [vehicles]);
  const maint = useFleetMaintenance(active.map((v) => v.id));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: FleetRow[] = useMemo(() => {
    const byVehicle = new Map<string, WorkOrder[]>();
    for (const o of orders) {
      const l = byVehicle.get(o.vehicleId) ?? [];
      l.push(o);
      byVehicle.set(o.vehicleId, l);
    }
    const nextBy = new Map<string, Maintenance>();
    for (const m of maint.data) {
      if (!ACTIVE_MAINT.has(m.status)) continue;
      const prev = nextBy.get(m.vehicleId);
      const at = mms(m.dueDate) ?? mms(m.nextDate) ?? Infinity;
      if (!prev || at < (mms(prev.dueDate) ?? mms(prev.nextDate) ?? Infinity)) nextBy.set(m.vehicleId, m);
    }
    return active
      .map((v) => {
        const list = byVehicle.get(v.id) ?? [];
        const delivered = list.filter((o) => o.status === "DELIVERED").map((o) => deliveredMs(o) ?? 0);
        return {
          v,
          lastService: delivered.length ? Math.max(...delivered) : null,
          open: list.find((o) => o.isOpen) ?? null,
          visits: list.filter((o) => o.status !== "CANCELLED").length,
          next: nextBy.get(v.id) ?? null,
        };
      })
      .sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || a.v.plate.localeCompare(b.v.plate));
  }, [active, orders, maint.data]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await assignVehicleToCompany({ vehicleId: removing.id, companyId: null });
      toast.success(`${removing.plate} ya no es de ${company.name}`);
      setRemoving(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <p className="text-sm text-slate-600"><b className="text-slate-900">{active.length}</b> {active.length === 1 ? "vehículo" : "vehículos"} · {rows.filter((r) => r.open).length} en el taller</p>
        {canWrite && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Agregar vehículo</Button>}
      </div>
      {loading && !vehicles.length ? (
        <div className="space-y-3 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<Car className="h-7 w-7" />} title="Sin vehículos en la flota" description="Agregue los vehículos de la empresa buscándolos por placa." action={canWrite ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Agregar vehículo</Button> : undefined} />
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Vehículo</th><th className="px-3 py-2.5 text-right">Kilometraje</th>
                  <th className="px-3 py-2.5">Último servicio</th><th className="px-3 py-2.5">Próximo mantenimiento</th><th className="px-3 py-2.5">En taller</th>{canWrite && <th className="w-12" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.v.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link to={`/vehiculos/${r.v.id}`} className="group flex items-center gap-2.5">
                        <PlateTag plate={r.v.plate} />
                        <span className="min-w-0"><span className="block whitespace-nowrap font-medium text-slate-900 group-hover:text-brand-700">{r.v.make} {r.v.model} {r.v.year}</span><span className="block truncate text-xs text-slate-500">{r.v.customer?.fullName} · {r.visits} {r.visits === 1 ? "visita" : "visitas"}</span></span>
                      </Link>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-3 text-right text-slate-700">{formatOdometer(r.v.mileage, r.v.odometerUnit)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700">{r.lastService ? formatDate(new Date(r.lastService)) : <span className="text-slate-400">Sin servicios</span>}</td>
                    <td className="px-3 py-3"><NextMaint m={r.next} loading={maint.loading} /></td>
                    <td className="px-3 py-3">{r.open ? <Link to={`/ordenes/${r.open.id}`} className="flex flex-col items-start gap-1"><span className="whitespace-nowrap font-semibold text-brand-700">{r.open.code}</span><StatusBadge status={r.open.status} short /></Link> : <span className="text-slate-400">—</span>}</td>
                    {canWrite && <td className="pr-4 text-right"><button onClick={() => setRemoving(r.v)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar de la flota" aria-label={`Quitar ${r.v.plate} de la flota`}><X className="h-4 w-4" /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 lg:hidden">
            {rows.map((r) => (
              <li key={r.v.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <Link to={`/vehiculos/${r.v.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><PlateTag plate={r.v.plate} /><span className="truncate font-medium text-slate-900">{r.v.make} {r.v.model} {r.v.year}</span></div>
                    <div className="mt-1 truncate text-xs text-slate-500">{r.v.customer?.fullName} · {formatOdometer(r.v.mileage, r.v.odometerUnit)}</div>
                  </Link>
                  {canWrite && <button onClick={() => setRemoving(r.v)} className="-mr-1 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Quitar ${r.v.plate} de la flota`}><X className="h-4 w-4" /></button>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3 text-slate-400" />{r.lastService ? `Último ${formatDate(new Date(r.lastService))}` : "Sin servicios"}</span>
                  <NextMaint m={r.next} loading={maint.loading} compact />
                  {r.open && <Link to={`/ordenes/${r.open.id}`} className="inline-flex items-center gap-1.5"><span className="font-semibold text-brand-700">{r.open.code}</span><StatusBadge status={r.open.status} short /></Link>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {adding && <AddVehicleDialog company={company} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        loading={busy}
        danger
        title="Quitar de la flota"
        message={removing ? `${removing.plate} (${removing.make} ${removing.model}) dejará de ser de ${company.name}. Su historial no se borra; las órdenes cerradas siguen en el reporte de la empresa.` : ""}
        confirmLabel="Quitar"
      />
    </div>
  );
}

function NextMaint({ m, loading, compact }: { m: Maintenance | null; loading: boolean; compact?: boolean }) {
  if (loading) return <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />;
  if (!m) return compact ? null : <span className="text-slate-400">—</span>;
  const when = m.dueDate ? formatDate(m.dueDate) : m.nextDate ? formatDate(m.nextDate) : m.nextMileage ? formatOdometer(m.nextMileage, m.odometerUnit) : "";
  if (!compact) {
    return (
      <div className="min-w-0 text-sm">
        <div className="truncate text-slate-800">{m.serviceName}</div>
        <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">{when}{m.status !== "upcoming" && <Badge tone={MAINT_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>}</div>
      </div>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <CalendarClock className="h-3 w-3 text-slate-400" />
      <span className="truncate text-slate-700">{m.serviceName}{when ? ` · ${when}` : ""}</span>
      {m.status !== "upcoming" && <Badge tone={MAINT_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>}
    </span>
  );
}

/** Buscar un vehículo por placa (o marca/modelo/dueño) y agregarlo a la flota. */
function AddVehicleDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const token = searchToken(text);
    if (token.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      getDocs(query(collection(db, col.vehicles(TENANT_ID)), where("searchKeywords", "array-contains", token), limit(12)))
        .then((s) => alive && setResults(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle).filter((v) => !v.archived)))
        .catch((err) => alive && toast.error(errorMessage(err)))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);

  const add = async (v: Vehicle) => {
    setBusyId(v.id);
    try {
      const r = await assignVehicleToCompany({ vehicleId: v.id, companyId: company.id });
      toast.success(`${v.plate} agregado a ${company.name}${r.openOrdersUpdated ? ". Su orden abierta también quedó con la empresa." : ""}`);
      setResults((list) => list.map((x) => (x.id === v.id ? { ...x, companyId: company.id, companyName: company.name } : x)));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Agregar vehículo a ${company.name}`} description="Busque por placa. El dueño del vehículo no cambia; la empresa queda además." footer={<Button variant="secondary" onClick={onClose}>Listo</Button>}>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Placa, marca, modelo o dueño" className="pl-9" />
        </div>
        {loading && <p className="text-sm text-slate-500">Buscando…</p>}
        {!loading && searchToken(text).length >= 2 && !results.length && <p className="text-sm text-slate-500">Ningún vehículo coincide. Regístrelo primero en Vehículos.</p>}
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {results.map((v) => {
            const mine = v.companyId === company.id;
            const other = !!v.companyId && !mine;
            return (
              <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                <PlateTag plate={v.plate} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{v.make} {v.model} {v.year}</div>
                  <div className="truncate text-xs text-slate-500">{v.customer?.fullName}{other ? ` · ahora en ${v.companyName}` : ""}</div>
                </div>
                {mine ? <Badge tone="green">En la flota</Badge> : (
                  <Button size="sm" variant={other ? "secondary" : "primary"} loading={busyId === v.id} onClick={() => void add(v)}>{other ? "Mover aquí" : "Agregar"}</Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
