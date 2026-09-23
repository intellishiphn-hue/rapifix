import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Camera, ChevronLeft, ClipboardList, CreditCard, FileText, History, LayoutGrid, MessageCircle, Package, Phone, Stethoscope, Wrench, 
} from "lucide-react";
import { allowedTransitions, formatMoney, formatPhone, PRIORITY_LABELS, whatsappLink } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useOrderEvents, useWorkOrder } from "./api";
import { ApprovedItems, QuoteEditor } from "@/features/quotes/QuoteEditor";
import { OrderDocuments, PortalLinkButton } from "./OrderDocuments";
import { OrderPayments } from "@/features/payments/OrderPayments";
import { StatusBadge } from "./StatusBadge";
import { StatusPicker } from "./StatusPicker";
import { useStatusChange } from "./useStatusChange";
import { OrderSummary } from "./OrderSummary";
import { OrderDiagnosis } from "./OrderDiagnosis";
import { OrderPhotos } from "./OrderPhotos";
import { EventTimeline } from "./OrderHistory";
import { OrderCommunication } from "./OrderCommunication";
import { daysInShop } from "./OrderCard";

type Tab = "resumen" | "diagnostico" | "cotizacion" | "servicios" | "repuestos" | "fotos" | "historial" | "comunicacion" | "pagos" | "documentos";
const UPCOMING: Partial<Record<Tab, { phase: number; text: string }>> = {};

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: order, loading, error, exists } = useWorkOrder(id);
  const events = useOrderEvents(id);
  const { role } = useAuth();
  const status = useStatusChange();
  const tab = (params.get("tab") as Tab) || "resumen";
  const setTab = (t: Tab) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;
  if (!exists || !order) {
    return <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="Orden no encontrada" description="Puede que no exista o que no esté asignada a usted." action={<Link to="/ordenes" className="font-semibold text-brand-700">Volver a órdenes</Link>} />;
  }

  const days = daysInShop(order);

  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "resumen", label: "Resumen", icon: <LayoutGrid className="h-4 w-4" /> },
    { value: "diagnostico", label: "Diagnóstico", icon: <Stethoscope className="h-4 w-4" /> },
    { value: "cotizacion", label: "Cotización", icon: <FileText className="h-4 w-4" /> },
    { value: "servicios", label: "Servicios", icon: <Wrench className="h-4 w-4" /> },
    { value: "repuestos", label: "Repuestos", icon: <Package className="h-4 w-4" /> },
    { value: "fotos", label: "Fotos", icon: <Camera className="h-4 w-4" />, count: order.photoCount ?? 0 },
    { value: "historial", label: "Historial", icon: <History className="h-4 w-4" /> },
    { value: "comunicacion", label: "Comunicación", icon: <MessageCircle className="h-4 w-4" /> },
    { value: "pagos", label: "Pagos", icon: <CreditCard className="h-4 w-4" /> },
    { value: "documentos", label: "Documentos", icon: <FileText className="h-4 w-4" /> },
  ];

  return (
    <>
      <Link to="/ordenes" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700">
        <ChevronLeft className="h-4 w-4" /> Órdenes
      </Link>
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{order.code}</h1>
              <StatusBadge status={order.status} className="text-sm" />
              {order.priority !== "normal" && <Badge tone={order.priority === "urgent" ? "red" : "amber"}>{PRIORITY_LABELS[order.priority]}</Badge>}
              <span className={days >= 5 && order.isOpen ? "text-sm font-semibold text-red-600" : "text-sm text-slate-500"}>{days === 0 ? "Ingresó hoy" : `${days} días en taller`}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <Link to={`/vehiculos/${order.vehicleId}`} className="flex items-center gap-2 font-semibold text-slate-900 hover:text-brand-700">
                <PlateTag plate={order.vehicle.plate} /> {order.vehicle.make} {order.vehicle.model} {order.vehicle.year}
              </Link>
              <Link to={`/clientes/${order.customerId}`} className="font-medium text-slate-700 hover:text-brand-700">{order.customer.fullName}</Link>
              <span className="flex items-center gap-2">
                <a href={`tel:${order.customer.phone}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Llamar"><Phone className="h-4 w-4" /></a>
                <a href={whatsappLink(order.customer.whatsapp || order.customer.phone)} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a>
                <span className="text-slate-500">{formatPhone(order.customer.phone)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-slate-600"><Wrench className="h-4 w-4 text-slate-400" />{order.technicians?.map((t) => t.name).join(", ") || <span className="text-amber-700">Sin técnico</span>}</span>
              {order.promisedAt && <span className="text-slate-600">Entrega prometida: <b>{formatDate(order.promisedAt, true)}</b></span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
          <PortalLinkButton order={order} />
          <div className="flex shrink-0 gap-6 rounded-xl bg-slate-50 px-5 py-3 lg:text-right">
            <div><div className="text-xs text-slate-500">Total</div><div className="tabular text-lg font-bold">{formatMoney(order.totals?.total ?? 0)}</div></div>
            <div><div className="text-xs text-slate-500">Saldo</div><div className="tabular text-lg font-bold">{formatMoney(order.balance ?? 0)}</div></div>
          </div>
          </div>
        </div>
        {allowedTransitions(role, order.status).length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado · toque para cambiar</div>
            <StatusPicker order={order} onPick={(s) => void status.change(order, s)} busy={status.busyId === order.id} />
          </div>
        )}
      </Card>

      <Card>
        <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
        {tab === "resumen" && <OrderSummary key={order.id} order={order} />}
        {tab === "diagnostico" && <OrderDiagnosis order={order} />}
        {tab === "fotos" && <OrderPhotos order={order} />}
        {tab === "historial" && <EventTimeline events={events.data} loading={events.loading} error={events.error} />}
        {tab === "comunicacion" && <OrderCommunication order={order} events={events} />}
        {tab === "cotizacion" && <QuoteEditor order={order} />}
        {tab === "servicios" && <ApprovedItems order={order} types={["labor", "service", "other"]} empty="Sin servicios aprobados" />}
        {tab === "repuestos" && (
          <>
            <ApprovedItems order={order} types={["part"]} empty="Sin repuestos aprobados" />
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Los repuestos agregados desde el catálogo se pueden descontar del inventario cuando se usan.</p>
          </>
        )}
        {tab === "documentos" && <OrderDocuments order={order} />}
        {tab === "pagos" && <OrderPayments order={order} />}
        {UPCOMING[tab] && (
          <EmptyState icon={<ClipboardList className="h-7 w-7" />} title={`Disponible en la Fase ${UPCOMING[tab]!.phase}`} description={UPCOMING[tab]!.text} />
        )}
      </Card>

      {status.element}
    </>
  );
}
