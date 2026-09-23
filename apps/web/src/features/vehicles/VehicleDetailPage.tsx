import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, Camera, Car, ClipboardList, Gauge, History, MessageCircle, Pencil, Phone, Plus, User } from "lucide-react";
import { toast } from "sonner";
import { FUEL_LABELS, TRANSMISSION_LABELS, formatPhone, whatsappLink } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatKm, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { AuditTrail } from "@/features/audit/AuditTrail";
import { useVehicleOrders } from "@/features/work-orders/api";
import { OrdersMiniList } from "@/features/work-orders/OrdersMiniList";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { VehicleMaintenanceCard } from "@/features/maintenance/VehicleMaintenanceCard";
import { setVehicleArchived, useMileageLog, useVehicle } from "./api";
import { PlateTag } from "./VehicleCard";
import { VehicleFormDialog } from "./VehicleFormDialog";
import { VehiclePhotos } from "./VehiclePhotos";
import { MileageDialog } from "./MileageDialog";

type Tab = "photos" | "mileage" | "timeline" | "changes";

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

export function VehicleDetailPage() {
  const { id } = useParams();
  const { data: vehicle, loading, error, exists } = useVehicle(id);
  const mileage = useMileageLog(id);
  const orders = useVehicleOrders(id);
  const { can, role, user } = useAuth();
  const [tab, setTab] = useState<Tab>("timeline");
  const [editing, setEditing] = useState(false);
  const [km, setKm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;
  if (!exists || !vehicle) {
    return <EmptyState icon={<Car className="h-7 w-7" />} title="Vehículo no encontrado" action={<Link to="/vehiculos" className="font-semibold text-brand-700">Volver a vehículos</Link>} />;
  }

  const canWrite = can("vehicles.write");
  const canAudit = can("audit.read");

  const toggleArchive = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await setVehicleArchived(vehicle.id, !vehicle.archived, user.uid);
      toast.success(vehicle.archived ? "Vehículo restaurado" : "Vehículo archivado");
      setArchiving(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "timeline", label: "Órdenes e historial", icon: <ClipboardList className="h-4 w-4" />, count: orders.data.length },
    { value: "photos", label: "Fotos", icon: <Camera className="h-4 w-4" />, count: vehicle.photoCount ?? 0 },
    { value: "mileage", label: "Kilometraje", icon: <Gauge className="h-4 w-4" /> },
    ...(canAudit ? [{ value: "changes" as Tab, label: "Cambios", icon: <History className="h-4 w-4" /> }] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/vehiculos", label: "Vehículos" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {vehicle.make} {vehicle.model} <span className="font-medium text-slate-400">{vehicle.year}</span>
            <PlateTag plate={vehicle.plate} className="text-sm" />
            {vehicle.archived && <Badge tone="gray">Archivado</Badge>}
          </span>
        }
        description={`Registrado ${formatDate(vehicle.createdAt)}`}
        actions={
          canWrite && (
            <>
              <Button variant="secondary" icon={<Gauge className="h-4 w-4" />} onClick={() => setKm(true)}>Kilometraje</Button>
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>
              <Button variant="ghost" icon={vehicle.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} onClick={() => setArchiving(true)}>
                {vehicle.archived ? "Restaurar" : "Archivar"}
              </Button>
            </>
          )
        }
      />

      {orders.data.filter((o) => o.isOpen).map((o) => (
        <Link key={o.id} to={`/ordenes/${o.id}`} className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm hover:bg-brand-100/60">
          <ClipboardList className="h-4 w-4 text-brand-700" />
          <span className="font-semibold text-brand-900">En taller: {o.code}</span>
          <StatusBadge status={o.status} />
          <span className="ml-auto font-semibold text-brand-700">Ver orden</span>
        </Link>
      ))}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="grid sm:grid-cols-[240px_1fr]">
            <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-slate-300 sm:aspect-auto">
              {vehicle.coverPhotoUrl ? <img src={vehicle.coverPhotoUrl} alt="" className="h-full w-full object-cover" /> : <Car className="h-16 w-16" />}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-3">
              <Spec label="Kilometraje" value={<span className="tabular">{formatKm(vehicle.mileage)}</span>} />
              <Spec label="Color" value={vehicle.color} />
              <Spec label="Combustible" value={FUEL_LABELS[vehicle.fuelType]} />
              <Spec label="Transmisión" value={TRANSMISSION_LABELS[vehicle.transmission]} />
              <Spec label="Motor" value={vehicle.engine} />
              <Spec label="Km actualizado" value={formatRelative(vehicle.mileageUpdatedAt)} />
              <Spec label="VIN / chasis" value={<span className="break-all font-mono text-xs">{vehicle.vin}</span>} />
              {vehicle.notes && <div className="col-span-2 sm:col-span-3"><Spec label="Notas" value={<span className="whitespace-pre-line font-normal text-slate-700">{vehicle.notes}</span>} /></div>}
            </dl>
          </div>
        </Card>

        <Card>
          <CardHeader title="Propietario" />
          <div className="p-5">
            <Link to={`/clientes/${vehicle.customerId}`} className="flex items-center gap-3 rounded-xl p-2 -m-2 hover:bg-slate-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700"><User className="h-5 w-5" /></span>
              <span>
                <span className="block font-semibold text-slate-900">{vehicle.customer?.fullName}</span>
                <span className="block text-sm text-slate-500">{formatPhone(vehicle.customer?.phone)}</span>
              </span>
            </Link>
            {vehicle.customer?.phone && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a href={`tel:${vehicle.customer.phone}`}><Button variant="secondary" className="w-full" icon={<Phone className="h-4 w-4" />}>Llamar</Button></a>
                <a href={whatsappLink(vehicle.customer.phone)} target="_blank" rel="noreferrer"><Button variant="secondary" className="w-full" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>WhatsApp</Button></a>
              </div>
            )}
          </div>
        </Card>
      </div>

      {role && ["admin", "manager", "reception", "seller"].includes(role) && <VehicleMaintenanceCard vehicleId={vehicle.id} />}

      <Card className="mt-5">
        <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
        {tab === "photos" && <VehiclePhotos vehicle={vehicle} />}
        {tab === "mileage" && (
          mileage.error ? <ErrorState message={mileage.error} /> : !mileage.data.length ? (
            <EmptyState icon={<Gauge className="h-7 w-7" />} title="Sin registros de kilometraje" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {mileage.data.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <div className="tabular font-semibold">{formatKm(m.mileage)}</div>
                    <div className="text-xs text-slate-500">{m.note || "Sin nota"} · {m.byName}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">{formatDate(m.at, true)}</div>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === "timeline" && (
          <OrdersMiniList
            orders={orders.data}
            loading={orders.loading}
            error={orders.error}
            action={can("orders.create") && !vehicle.archived && !orders.data.some((o) => o.isOpen) && (
              <Link to={`/ordenes/nueva?vehiculo=${vehicle.id}`}><Button size="sm" icon={<Plus className="h-4 w-4" />}>Nueva orden</Button></Link>
            )}
          />
        )}
        {tab === "changes" && canAudit && <AuditTrail entityId={vehicle.id} />}
      </Card>

      <VehicleFormDialog open={editing} onClose={() => setEditing(false)} vehicle={vehicle} />
      <MileageDialog open={km} onClose={() => setKm(false)} vehicle={vehicle} />
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={() => void toggleArchive()}
        loading={busy}
        title={vehicle.archived ? "Restaurar vehículo" : "Archivar vehículo"}
        message={vehicle.archived ? "El vehículo volverá a aparecer en las listas activas." : "El vehículo dejará de aparecer en las listas activas. Su historial se conserva y puede restaurarlo cuando quiera."}
        confirmLabel={vehicle.archived ? "Restaurar" : "Archivar"}
      />
    </>
  );
}
