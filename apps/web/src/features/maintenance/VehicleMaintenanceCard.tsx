import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { MAINTENANCE_STATUS_LABELS } from "@rapifix/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { MAINT_TONE, nextLabel, useVehicleMaintenance } from "./api";

/** Tarjeta de mantenimientos en el detalle del vehículo. */
export function VehicleMaintenanceCard({ vehicleId }: { vehicleId: string }) {
  const { data, loading, error } = useVehicleMaintenance(vehicleId);
  const open = data.filter((m) => m.status !== "done" && m.status !== "cancelled");
  const closed = data.length - open.length;

  return (
    <Card className="mt-5">
      <CardHeader
        title="Mantenimientos"
        description={open.length ? `${open.length} pendiente${open.length === 1 ? "" : "s"}` : "Mantenimiento preventivo del vehículo"}
        action={<Link to="/mantenimiento"><Button size="sm" variant="secondary" icon={<CalendarClock className="h-4 w-4" />}>Ver todos</Button></Link>}
      />
      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <div className="p-5"><Skeleton className="h-10" /></div>
      ) : !open.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">
          Sin mantenimientos pendientes.{closed > 0 ? ` ${closed} realizado${closed === 1 ? "" : "s"} o descartado${closed === 1 ? "" : "s"}.` : " Se crean al entregar órdenes con servicios que tengan intervalo."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {open.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{m.serviceName}</div>
                <div className="text-xs text-slate-500">Próximo: {nextLabel(m) || "—"}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {m.appointmentId && <Badge tone="blue">Cita agendada</Badge>}
                <Badge tone={MAINT_TONE[m.status]}>{MAINTENANCE_STATUS_LABELS[m.status]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
