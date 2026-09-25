import { useMemo } from "react";
import { Link } from "react-router-dom";
import { collection, getCountFromServer, limit, query, Timestamp, where } from "firebase/firestore";
import { AlertTriangle, ArrowRight, BellRing, CalendarDays, CalendarClock, CheckCircle2, Truck } from "lucide-react";
import {
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS, catalogCol, financeCol, formatMoney, hnDayKey, opsCol,
  type Appointment, type Payment, type Purchase, type WorkOrder,
} from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { formatDate, toDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { fetchAll, useLoader } from "@/features/reports/data";
import { DailyAmountChart, paymentsByDay } from "@/features/reports/charts";
import { dayKeys, hnTodayStart, keyToDate } from "@/features/reports/period";

const seeAll = (to: string, label = "Ver") => (
  <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700">{label} <ArrowRight className="h-4 w-4" /></Link>
);

/** Cobrado por día, últimos 30 días (una sola consulta, sin tiempo real). */
export function CollectedChartCard() {
  const day = hnDayKey(Date.now());
  const range = useMemo(() => {
    const today = keyToDate(day);
    return { start: new Date(today.getTime() - 29 * 86400000), end: new Date(today.getTime() + 86400000) };
  }, [day]);
  // En tiempo real: un pago o venta nueva aparece sin recargar la página
  const live = useQueryData<Payment>(
    query(collection(db, catalogCol.payments(TENANT_ID)), where("at", ">=", Timestamp.fromDate(range.start)), limit(3000)),
    `dash-collected-30|${day}`,
  );
  const data = live.loading ? null : live.data;
  const { loading, error } = live;
  const series = useMemo(() => (data ? paymentsByDay(data, dayKeys(range.start, range.end)) : []), [data, range]);
  const total = series.reduce((a, d) => a + d.amount, 0);
  return (
    <Card>
      <CardHeader title="Cobrado por día" description={data ? `Últimos 30 días · ${formatMoney(total)}` : "Últimos 30 días"} action={seeAll("/reportes", "Reportes")} />
      <div className="p-4">
        {error ? <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{error}</p> : loading ? <Skeleton className="h-56" /> : <DailyAmountChart data={series} height={224} />}
      </div>
    </Card>
  );
}

/** Citas de hoy (hora de Honduras). Con `technicianId` muestra solo las de ese técnico. */
export function TodayAppointmentsCard({ technicianId, title = "Citas de hoy" }: { technicianId?: string; title?: string }) {
  const day = hnDayKey(Date.now());
  const { data, loading, error } = useQueryData<Appointment>(
    query(collection(db, opsCol.appointments(TENANT_ID)), where("dayKey", "==", day), limit(100)),
    `dash-appointments-${day}`,
  );
  const list = useMemo(
    () =>
      data
        .filter((a) => a.status !== "cancelled" && (!technicianId || a.technicianId === technicianId))
        .sort((a, b) => (toDate(a.start)?.getTime() ?? 0) - (toDate(b.start)?.getTime() ?? 0)),
    [data, technicianId],
  );
  const time = (a: Appointment) => {
    const d = toDate(a.start);
    return d ? new Intl.DateTimeFormat("es-HN", { hour: "numeric", minute: "2-digit", timeZone: "America/Tegucigalpa" }).format(d) : "";
  };
  return (
    <Card>
      <CardHeader title={title} description={loading ? undefined : `${list.length} programada(s)`} action={seeAll("/agenda", "Agenda")} />
      {error ? (
        <p className="flex items-center gap-2 p-5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{error}</p>
      ) : loading ? (
        <div className="space-y-2 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !list.length ? (
        <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><CalendarDays className="h-4 w-4" /> No hay citas para hoy.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.slice(0, 8).map((a) => (
            <li key={a.id}>
              <Link to="/agenda" className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className="tabular w-16 shrink-0 text-sm font-semibold text-slate-900">{time(a)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.customerName || "Sin cliente"}{a.vehicleLabel ? ` · ${a.vehicleLabel}` : ""}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {APPOINTMENT_TYPE_LABELS[a.type]}{a.technicianName ? ` · ${a.technicianName}` : ""}
                  </span>
                </span>
                {a.status === "done" ? <Badge tone="green">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge> : a.status === "confirmed" ? <Badge tone="blue">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge> : a.status === "no_show" ? <Badge tone="red">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge> : null}
              </Link>
            </li>
          ))}
          {list.length > 8 && <li className="px-5 py-2 text-xs text-slate-500">y {list.length - 8} más en la agenda</li>}
        </ul>
      )}
    </Card>
  );
}

/** Conteo de mantenimientos vencidos y próximos. */
export function MaintenanceCard() {
  const { data, loading } = useLoader(async () => {
    const c = collection(db, opsCol.maintenance(TENANT_ID));
    const [overdue, due] = await Promise.all([
      getCountFromServer(query(c, where("status", "==", "overdue"))),
      getCountFromServer(query(c, where("status", "==", "due"))),
    ]);
    return { overdue: overdue.data().count, due: due.data().count };
  }, "dash-maintenance");
  return (
    <Card>
      <CardHeader title="Mantenimientos" description="Recordatorios para clientes" action={seeAll("/mantenimiento")} />
      <div className="grid grid-cols-2 divide-x divide-slate-100">
        <Link to="/mantenimiento" className="flex items-center gap-3 p-5 hover:bg-slate-50">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600"><BellRing className="h-5 w-5" /></span>
          <span>
            {loading ? <Skeleton className="h-7 w-10" /> : <span className="tabular block text-2xl font-bold text-slate-900">{data?.overdue ?? 0}</span>}
            <span className="text-xs text-slate-500">Vencidos</span>
          </span>
        </Link>
        <Link to="/mantenimiento" className="flex items-center gap-3 p-5 hover:bg-slate-50">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><CalendarClock className="h-5 w-5" /></span>
          <span>
            {loading ? <Skeleton className="h-7 w-10" /> : <span className="tabular block text-2xl font-bold text-slate-900">{data?.due ?? 0}</span>}
            <span className="text-xs text-slate-500">Próximos</span>
          </span>
        </Link>
      </div>
    </Card>
  );
}

/** Compras a proveedores pendientes con fecha de vencimiento pasada. */
export function OverduePayablesCard() {
  const { data, loading, error } = useLoader(
    () => fetchAll<Purchase>(financeCol.purchases(TENANT_ID), where("status", "in", ["pending", "partial"]), limit(500)),
    "dash-payables",
  );
  const today = hnTodayStart().getTime();
  const overdue = (data ?? []).filter((p) => p.dueDate && p.dueDate.toMillis() < today).sort((a, b) => (a.dueDate?.toMillis() ?? 0) - (b.dueDate?.toMillis() ?? 0));
  const total = overdue.reduce((a, p) => a + p.balance, 0);
  return (
    <Card>
      <CardHeader title="Cuentas por pagar vencidas" description={loading ? undefined : overdue.length ? `${overdue.length} compra(s) · ${formatMoney(total)}` : undefined} action={seeAll("/compras")} />
      {error ? (
        <p className="flex items-center gap-2 p-5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{error}</p>
      ) : loading ? (
        <div className="space-y-2 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !overdue.length ? (
        <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No hay pagos a proveedores vencidos.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {overdue.slice(0, 5).map((p) => (
            <li key={p.id}>
              <Link to={`/proveedores/${p.supplierId}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><Truck className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.supplierName}</span>
                  <span className="block text-xs text-red-600">{p.code} · venció {formatDate(p.dueDate)}</span>
                </span>
                <span className="tabular text-sm font-semibold">{formatMoney(p.balance)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Órdenes abiertas asignadas al técnico (la lista ya viene filtrada por useOpenOrders). */
export function MyOrdersCard({ orders, loading }: { orders: WorkOrder[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Mis órdenes abiertas" description={loading ? undefined : `${orders.length} asignada(s)`} action={seeAll("/ordenes", "Tablero")} />
      {loading ? (
        <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !orders.length ? (
        <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No tiene órdenes asignadas.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.slice(0, 10).map((o) => (
            <li key={o.id}>
              <Link to={`/ordenes/${o.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{o.code} · {o.vehicle.make} {o.vehicle.model}</span>
                  <span className="block truncate text-xs text-slate-500">{o.reason || o.customer.fullName}</span>
                </span>
                <PlateTag plate={o.vehicle.plate} />
                <StatusBadge status={o.status} short />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
