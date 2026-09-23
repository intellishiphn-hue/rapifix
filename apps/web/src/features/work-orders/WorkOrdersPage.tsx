import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, Columns3, List, Plus, Search } from "lucide-react";
import { STATUS_META, WORK_ORDER_STATUSES } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { useDebounced } from "@/lib/firestore/hooks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useOpenOrders, useOrdersList, useRecentDelivered, type ListStatus } from "./api";
import { KanbanBoard } from "./KanbanBoard";
import { StatusBadge } from "./StatusBadge";
import { daysInShop } from "./OrderCard";

type View = "kanban" | "list";
const VIEW_KEY = "rapifix.ordersView";
const PAGE = 30;

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "kanban";
  } catch {
    return "kanban";
  }
}

function OrdersList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ListStatus>("open");
  const [pageSize, setPageSize] = useState(PAGE);
  const debounced = useDebounced(search, 300);
  const { data, loading, error, hasMore } = useOrdersList({ search: debounced, status, pageSize });

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por OT, placa, cliente, marca..." className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value as ListStatus); setPageSize(PAGE); }} className="sm:w-56">
          <option value="open">Abiertas</option>
          <option value="all">Todas</option>
          {WORK_ORDER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : loading && !data.length ? (
        <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : !data.length ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="Sin órdenes" description={debounced ? "Pruebe con otra búsqueda." : "No hay órdenes con este filtro."} />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Orden</th><th className="px-5 py-3">Vehículo</th><th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Estado</th><th className="px-5 py-3">Técnico</th><th className="px-5 py-3">Ingreso</th><th className="px-5 py-3 text-right">Días</th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/ordenes/${o.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3 font-bold text-brand-700">{o.code}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2"><PlateTag plate={o.vehicle.plate} /><span className="truncate">{o.vehicle.make} {o.vehicle.model}</span></div>
                    </td>
                    <td className="px-5 py-3">{o.customer.fullName}</td>
                    <td className="px-5 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-5 py-3 text-slate-600">{o.technicians?.map((t) => t.name).join(", ") || <span className="text-amber-700">Sin asignar</span>}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(o.createdAt)}</td>
                    <td className="tabular px-5 py-3 text-right">{daysInShop(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 md:hidden">
            {data.map((o) => (
              <li key={o.id}>
                <Link to={`/ordenes/${o.id}`} className="block px-4 py-3 active:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-brand-700">{o.code}</span>
                    <StatusBadge status={o.status} short />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm"><PlateTag plate={o.vehicle.plate} /> {o.vehicle.make} {o.vehicle.model}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{o.customer.fullName} · {daysInShop(o)} días</div>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && <div className="border-t border-slate-100 p-3 text-center"><Button variant="ghost" loading={loading} onClick={() => setPageSize((p) => p + PAGE)}>Cargar más</Button></div>}
        </>
      )}
    </Card>
  );
}

function Board() {
  const open = useOpenOrders();
  const delivered = useRecentDelivered();
  if (open.error) return <ErrorState message={open.error} />;
  if (open.loading) {
    return <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96 w-[272px] shrink-0" />)}</div>;
  }
  return <KanbanBoard open={open.data} delivered={delivered.data} />;
}

export function WorkOrdersPage() {
  const { can, role } = useAuth();
  const [view, setView] = useState<View>(readView);
  const change = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  return (
    <>
      <PageHeader
        title={role === "technician" ? "Mis órdenes" : "Órdenes de trabajo"}
        description="Cada vehículo en el taller, desde la recepción hasta la entrega."
        actions={
          <>
            <div className="flex rounded-[10px] bg-slate-200/70 p-1">
              {([["kanban", "Tablero", Columns3], ["list", "Lista", List]] as const).map(([v, label, Icon]) => (
                <button key={v} onClick={() => change(v)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {can("orders.create") && <Link to="/ordenes/nueva"><Button icon={<Plus className="h-4 w-4" />}>Nueva orden</Button></Link>}
          </>
        }
      />
      {view === "kanban" ? <Board /> : <OrdersList />}
    </>
  );
}

