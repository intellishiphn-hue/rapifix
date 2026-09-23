import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, ExternalLink, Globe } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { useOpenOrders } from "@/features/work-orders/api";
import { ensurePortal } from "@/features/quotes/api";
import { errorMessage } from "@/lib/errors";

/** Links del portal de los vehículos que están en el taller. */
export function PortalLinksPage() {
  const { data, loading, error } = useOpenOrders();
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (orderId: string, copy: boolean) => {
    setBusy(orderId);
    try {
      const { token } = await ensurePortal({ orderId });
      const url = `${window.location.origin}/orden/${token}`;
      if (copy) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado");
      } else window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Portal del cliente" description="Cada orden tiene un link único donde el cliente ve el avance, las fotos y aprueba la cotización, sin crear cuenta." />
      <Card>
        {error ? <ErrorState message={error} /> : loading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<Globe className="h-7 w-7" />} title="No hay vehículos en taller" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <Link to={`/ordenes/${o.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <PlateTag plate={o.vehicle.plate} />
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{o.code} · {o.vehicle.make} {o.vehicle.model}</span><span className="block text-xs text-slate-500">{o.customer.fullName}</span></span>
                </Link>
                <StatusBadge status={o.status} short />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} loading={busy === o.id} onClick={() => void open(o.id, true)}>Copiar</Button>
                  <Button size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" />} onClick={() => void open(o.id, false)}>Ver</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
