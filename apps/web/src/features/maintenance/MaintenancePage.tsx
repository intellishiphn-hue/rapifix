import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, CalendarClock, Info, MessageCircle, Plus, Search } from "lucide-react";
import { MAINTENANCE_STATUS_LABELS, normalizeText, type Maintenance, type MaintenanceStatus } from "@rapifix/shared";
import { formatDate, formatKm, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { MAINT_TONE, nextLabel, useMaintenanceByStatus } from "./api";
import { MaintenanceButtons, useMaintenanceActions, type MaintenanceActionsApi } from "./MaintenanceActions";
import { MaintenanceFormDialog } from "./MaintenanceFormDialog";

type Tab = "overdue" | "due" | "upcoming" | "closed";
const EMPTY: Record<Tab, { title: string; description: string }> = {
  overdue: { title: "Sin mantenimientos vencidos", description: "Muy bien: ningún cliente tiene un mantenimiento atrasado." },
  due: { title: "Sin mantenimientos próximos", description: "Aquí aparecen los que tocan en los próximos 15 días o 500 km." },
  upcoming: { title: "Sin mantenimientos programados", description: "Se crean solos al entregar órdenes con servicios que tengan intervalo, o puede agregarlos manualmente." },
  closed: { title: "Sin registros", description: "Los mantenimientos realizados o descartados aparecerán aquí." },
};

export function MaintenancePage() {
  const [tab, setTab] = useState<Tab>("overdue");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const api = useMaintenanceActions();

  const overdue = useMaintenanceByStatus("overdue");
  const due = useMaintenanceByStatus("due");
  const upcoming = useMaintenanceByStatus("upcoming");
  const done = useMaintenanceByStatus(tab === "closed" ? "done" : null, 100);
  const cancelled = useMaintenanceByStatus(tab === "closed" ? "cancelled" : null, 100);

  const current = tab === "overdue" ? overdue : tab === "due" ? due : tab === "upcoming" ? upcoming : null;
  const loading = current ? current.loading : done.loading || cancelled.loading;
  const error = current ? current.error : done.error || cancelled.error;
  const rows = useMemo(() => {
    const list = current
      ? current.data
      : [...done.data, ...cancelled.data].sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
    const q = normalizeText(search.trim());
    if (!q) return list;
    const qPlate = q.replace(/[^a-z0-9]/g, "");
    return list.filter((m) =>
      normalizeText(`${m.customerName} ${m.serviceName} ${m.vehicleLabel}`).includes(q) ||
      (qPlate.length > 0 && m.plate.toLowerCase().includes(qPlate)) ||
      m.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "#"),
    );
  }, [current, done.data, cancelled.data, search]);

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "overdue", label: "Vencidos", count: overdue.data.length },
    { value: "due", label: "Próximos", count: due.data.length },
    { value: "upcoming", label: "Programados", count: upcoming.data.length },
    { value: "closed", label: "Realizados / Descartados" },
  ];

  return (
    <>
      <PageHeader
        title="Mantenimiento preventivo"
        description="Clientes a los que les toca volver al taller."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo mantenimiento</Button>}
      />

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <p>
          Los mantenimientos se crean solos al entregar una orden con servicios que tengan intervalo (se configura en{" "}
          <Link to="/servicios" className="font-semibold text-brand-700">Servicios</Link>). El estado se actualiza cada mañana:
          pasa a <b>Próximo</b> 15 días o 500 km antes, y a <b>Vencido</b> cuando se cumple la fecha o el kilometraje.
        </p>
      </div>

      <Card>
        <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
        <div className="border-b border-slate-100 p-3 sm:px-5">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar placa, cliente o servicio..."
              className="h-10 w-full rounded-[10px] border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </div>
        </div>

        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : !rows.length ? (
          <EmptyState
            icon={<CalendarClock className="h-7 w-7" />}
            title={search ? "Sin resultados" : EMPTY[tab].title}
            description={search ? "Pruebe con otra placa o nombre." : EMPTY[tab].description}
          />
        ) : (
          <>
            <DesktopTable rows={rows} api={api} />
            <MobileList rows={rows} api={api} />
          </>
        )}
      </Card>

      {api.element}
      <MaintenanceFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function StatusCell({ m }: { m: Maintenance }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={MAINT_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status as MaintenanceStatus]}</Badge>
      {m.reminderSentAt && <Badge tone="green"><MessageCircle className="h-3 w-3" />Avisado {formatRelative(m.reminderSentAt)}</Badge>}
      {m.appointmentId && <Badge tone="blue"><CalendarCheck className="h-3 w-3" />Cita agendada</Badge>}
    </div>
  );
}

function lastLabel(m: Maintenance) {
  return [m.lastDate ? formatDate(m.lastDate) : "", m.lastMileage ? formatKm(m.lastMileage) : ""].filter(Boolean).join(" · ") || "—";
}

function DesktopTable({ rows, api }: { rows: Maintenance[]; api: MaintenanceActionsApi }) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-5 py-3">Vehículo</th>
            <th className="px-3 py-3">Servicio</th>
            <th className="px-3 py-3">Último</th>
            <th className="px-3 py-3">Próximo</th>
            <th className="px-3 py-3">Estado</th>
            <th className="px-5 py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((m) => (
            <tr key={m.id} className="align-top hover:bg-slate-50/60">
              <td className="px-5 py-3">
                <Link to={`/vehiculos/${m.vehicleId}`} className="flex items-center gap-2 font-semibold text-slate-900 hover:text-brand-700">
                  <PlateTag plate={m.plate} /> <span className="truncate">{m.vehicleLabel}</span>
                </Link>
                <Link to={`/clientes/${m.customerId}`} className="mt-1 block text-xs text-slate-500 hover:text-brand-700">{m.customerName}</Link>
              </td>
              <td className="px-3 py-3">
                <div className="font-medium text-slate-800">{m.serviceName}</div>
                <div className="text-xs text-slate-500">
                  {[m.intervalDays ? `cada ${m.intervalDays} días` : "", m.intervalKm ? `cada ${formatKm(m.intervalKm)}` : ""].filter(Boolean).join(" o ")}
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600">
                {lastLabel(m)}
                {m.workOrderCode && <Link to={`/ordenes/${m.workOrderId}`} className="block text-xs font-semibold text-brand-700">{m.workOrderCode}</Link>}
              </td>
              <td className={m.status === "overdue" ? "px-3 py-3 font-semibold text-red-700" : "px-3 py-3 font-medium text-slate-800"}>{nextLabel(m) || "—"}</td>
              <td className="px-3 py-3"><StatusCell m={m} /></td>
              <td className="px-5 py-3"><div className="flex justify-end"><MaintenanceButtons m={m} api={api} compact /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileList({ rows, api }: { rows: Maintenance[]; api: MaintenanceActionsApi }) {
  return (
    <ul className="divide-y divide-slate-100 lg:hidden">
      {rows.map((m) => (
        <li key={m.id} className="space-y-2 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <Link to={`/vehiculos/${m.vehicleId}`} className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-slate-900"><PlateTag plate={m.plate} /> <span className="truncate">{m.vehicleLabel}</span></div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{m.customerName}</div>
            </Link>
            <Badge tone={MAINT_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>
          </div>
          <div className="text-sm font-medium text-slate-800">{m.serviceName}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><div className="text-slate-500">Último</div><div className="text-slate-700">{lastLabel(m)}</div></div>
            <div><div className="text-slate-500">Próximo</div><div className={m.status === "overdue" ? "font-semibold text-red-700" : "font-medium text-slate-800"}>{nextLabel(m) || "—"}</div></div>
          </div>
          {(m.reminderSentAt || m.appointmentId) && (
            <div className="flex flex-wrap gap-1.5">
              {m.reminderSentAt && <Badge tone="green"><MessageCircle className="h-3 w-3" />Avisado {formatRelative(m.reminderSentAt)}</Badge>}
              {m.appointmentId && <Badge tone="blue"><CalendarCheck className="h-3 w-3" />Cita agendada</Badge>}
            </div>
          )}
          <MaintenanceButtons m={m} api={api} />
        </li>
      ))}
    </ul>
  );
}

