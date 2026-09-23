import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import type { WorkOrder } from "@rapifix/shared";
import { formatDate } from "@/lib/format";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "./StatusBadge";

/** Historial de órdenes (en el detalle de vehículo y de cliente). */
export function OrdersMiniList({ orders, loading, error, showVehicle, action }: { orders: WorkOrder[]; loading: boolean; error: string | null; showVehicle?: boolean; action?: React.ReactNode }) {
  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="space-y-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  return (
    <div>
      {action && <div className="flex justify-end px-5 pt-4">{action}</div>}
      {!orders.length ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="Sin órdenes todavía" description="Cuando este vehículo entre al taller, aquí quedará todo su historial." />
      ) : (
        <ol className="relative space-y-4 p-5 before:absolute before:bottom-8 before:left-[27px] before:top-8 before:w-px before:bg-slate-200">
          {orders.map((o) => (
            <li key={o.id} className="relative flex gap-4">
              <span className="z-10 mt-4 h-3 w-3 shrink-0 rounded-full bg-brand-600 ring-4 ring-white" />
              <Link to={`/ordenes/${o.id}`} className="flex-1 rounded-xl border border-slate-200 p-3 transition hover:border-brand-300 hover:shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-bold text-brand-700">{o.code}{showVehicle && <PlateTag plate={o.vehicle.plate} />}</span>
                  <StatusBadge status={o.status} short />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-700">{o.diagnosis?.technicianDiagnosis || o.reason}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(o.createdAt)}
                  {showVehicle && ` · ${o.vehicle.make} ${o.vehicle.model}`}
                  {o.reception?.mileageIn ? ` · ${new Intl.NumberFormat("es-HN").format(o.reception.mileageIn)} km` : ""}
                  {o.technicians?.length ? ` · ${o.technicians.map((t) => t.name).join(", ")}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
