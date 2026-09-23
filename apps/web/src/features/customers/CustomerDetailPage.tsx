import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Car, ClipboardList, CreditCard, FileText, History, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, User } from "lucide-react";
import { formatMoney, formatPhone, whatsappLink } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState, ErrorState, PageLoader, Skeleton } from "@/components/ui/Feedback";
import { AuditTrail } from "@/features/audit/AuditTrail";
import { useCustomerOrders } from "@/features/work-orders/api";
import { OrdersMiniList } from "@/features/work-orders/OrdersMiniList";
import { useCustomerVehicles } from "@/features/vehicles/api";
import { VehicleCard } from "@/features/vehicles/VehicleCard";
import { VehicleFormDialog } from "@/features/vehicles/VehicleFormDialog";
import { useCustomer } from "./api";
import { CustomerFormDialog } from "./CustomerFormDialog";

type Tab = "vehicles" | "orders" | "quotes" | "payments" | "changes";

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="break-words text-sm font-medium text-slate-900">{value || <span className="font-normal text-slate-400">Sin registrar</span>}</div>
      </div>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { data: customer, loading, error, exists } = useCustomer(id);
  const vehicles = useCustomerVehicles(id);
  const orders = useCustomerOrders(id);
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("vehicles");
  const [editing, setEditing] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;
  if (!exists || !customer) {
    return <EmptyState icon={<User className="h-7 w-7" />} title="Cliente no encontrado" action={<Link to="/clientes" className="font-semibold text-brand-700">Volver a clientes</Link>} />;
  }

  const activeVehicles = vehicles.data.filter((v) => !v.archived);
  const archivedVehicles = vehicles.data.filter((v) => v.archived);
  const canAudit = can("audit.read");
  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number; disabled?: boolean }> = [
    { value: "vehicles", label: "Vehículos", icon: <Car className="h-4 w-4" />, count: activeVehicles.length },
    { value: "orders", label: "Órdenes", icon: <ClipboardList className="h-4 w-4" />, count: orders.data.length },
    { value: "quotes", label: "Cotizaciones", icon: <FileText className="h-4 w-4" /> },
    { value: "payments", label: "Pagos", icon: <CreditCard className="h-4 w-4" /> },
    ...(canAudit ? [{ value: "changes" as Tab, label: "Cambios", icon: <History className="h-4 w-4" /> }] : []),
  ];
  const upcoming: Record<string, string> = { quotes: "Fase 3", payments: "Fase 4" };

  return (
    <>
      <PageHeader
        back={{ to: "/clientes", label: "Clientes" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={customer.fullName} className="h-11 w-11 text-sm" />
            <span>{customer.fullName}</span>
            <Badge tone={customer.status === "active" ? "green" : "gray"}>{customer.status === "active" ? "Activo" : "Inactivo"}</Badge>
          </span>
        }
        description={`Cliente desde ${formatDate(customer.createdAt)}`}
        actions={
          <>
            <a href={`tel:${customer.phone}`}><Button variant="secondary" icon={<Phone className="h-4 w-4" />}>Llamar</Button></a>
            <a href={whatsappLink(customer.whatsapp || customer.phone)} target="_blank" rel="noreferrer">
              <Button variant="secondary" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>WhatsApp</Button>
            </a>
            {can("customers.write") && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Información de contacto" />
            <div className="space-y-4 p-5">
              <InfoRow icon={<Phone className="h-4 w-4" />} label="Teléfono" value={formatPhone(customer.phone)} />
              <InfoRow icon={<MessageCircle className="h-4 w-4" />} label="WhatsApp" value={formatPhone(customer.whatsapp)} />
              <InfoRow icon={<Mail className="h-4 w-4" />} label="Correo" value={customer.email} />
              <InfoRow icon={<User className="h-4 w-4" />} label="Identidad / RTN" value={[customer.idNumber, customer.rtn].filter(Boolean).join(" · ")} />
              <InfoRow icon={<MapPin className="h-4 w-4" />} label="Dirección" value={[customer.address, customer.city].filter(Boolean).join(", ")} />
            </div>
            {customer.notes && <div className="border-t border-slate-100 px-5 py-4 text-sm whitespace-pre-line text-slate-600">{customer.notes}</div>}
          </Card>
          <Card className="grid grid-cols-2 divide-x divide-slate-100">
            <div className="p-4">
              <div className="text-xs text-slate-500">Vehículos</div>
              <div className="tabular text-2xl font-bold">{customer.vehicleCount ?? 0}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">Saldo pendiente</div>
              <div className="tabular text-2xl font-bold">{formatMoney(customer.balanceDue ?? 0)}</div>
            </div>
          </Card>
        </div>

        <Card className="min-w-0">
          <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
          {tab === "vehicles" && (
            <div className="p-5">
              {can("vehicles.write") && (
                <div className="mb-4 flex justify-end">
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAddingVehicle(true)}>Agregar vehículo</Button>
                </div>
              )}
              {vehicles.error ? (
                <ErrorState message={vehicles.error} />
              ) : vehicles.loading ? (
                <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-[90px]" />)}</div>
              ) : !activeVehicles.length ? (
                <EmptyState icon={<Car className="h-7 w-7" />} title="Sin vehículos" description="Este cliente todavía no tiene vehículos registrados." />
              ) : (
                <div className="grid gap-3 xl:grid-cols-2">{activeVehicles.map((v) => <VehicleCard key={v.id} vehicle={v} showOwner={false} />)}</div>
              )}
              {archivedVehicles.length > 0 && (
                <details className="mt-5">
                  <summary className="cursor-pointer text-sm font-medium text-slate-500">Archivados ({archivedVehicles.length})</summary>
                  <div className="mt-3 grid gap-3 opacity-70 xl:grid-cols-2">{archivedVehicles.map((v) => <VehicleCard key={v.id} vehicle={v} showOwner={false} />)}</div>
                </details>
              )}
            </div>
          )}
          {upcoming[tab] && (
            <EmptyState
              icon={tab === "orders" ? <ClipboardList className="h-7 w-7" /> : tab === "quotes" ? <FileText className="h-7 w-7" /> : <CreditCard className="h-7 w-7" />}
              title={`Disponible en la ${upcoming[tab]}`}
              description="Cuando se active este módulo, aquí verá el historial completo de este cliente."
            />
          )}
          {tab === "orders" && <OrdersMiniList orders={orders.data} loading={orders.loading} error={orders.error} showVehicle />}
          {tab === "changes" && canAudit && <AuditTrail entityId={customer.id} />}
        </Card>
      </div>

      <CustomerFormDialog open={editing} onClose={() => setEditing(false)} customer={customer} />
      <VehicleFormDialog open={addingVehicle} onClose={() => setAddingVehicle(false)} defaultCustomer={customer} />
    </>
  );
}
