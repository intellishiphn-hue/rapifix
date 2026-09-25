import { DashboardCustomizer, arrange, useDashboardPrefs, type DashSection } from "./customize";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getCountFromServer, limit, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Car, CheckCircle2, ClipboardList, Clock, FileClock, Plus, SlidersHorizontal, Stethoscope, UserPlus, Users, Wrench } from "lucide-react";
import { catalogCol, col, formatMoney, hnDayKey, KANBAN_COLUMNS, orderCol, type Customer, type Payment, type Vehicle, type WorkOrder } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { formatRelative, toDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Feedback";
import { Avatar } from "@/components/common/Avatar";
import { VehicleCard, PlateTag } from "@/features/vehicles/VehicleCard";
import { useOpenOrders } from "@/features/work-orders/api";
import { usePendingIntakeQuotes } from "@/features/quotes/api";
import { daysInShop } from "@/features/work-orders/OrderCard";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { hnDate, hnParts, hnTodayStart } from "@/features/reports/period";
import { ReminderQueueCard } from "@/features/maintenance/ReminderQueueCard";
import { TomorrowRemindersCard } from "@/features/agenda/TomorrowRemindersCard";
import { CollectedChartCard, MaintenanceCard, MyOrdersCard, OverduePayablesCard, TodayAppointmentsCard } from "./widgets";

const monthStart = (offset = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1);
};

interface Kpis {
  customers: number;
  vehicles: number;
  newCustomers: number;
  newVehicles: number;
  deliveredMonth: number | null;
}

function useKpis(staff: boolean) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const since = Timestamp.fromDate(monthStart());
    const c = collection(db, col.customers(TENANT_ID));
    const v = collection(db, col.vehicles(TENANT_ID));
    Promise.all([
      getCountFromServer(query(c, where("status", "==", "active"))),
      getCountFromServer(query(v, where("archived", "==", false))),
      getCountFromServer(query(c, where("createdAt", ">=", since))),
      getCountFromServer(query(v, where("createdAt", ">=", since))),
      staff
        ? getCountFromServer(query(collection(db, orderCol.workOrders(TENANT_ID)), where("status", "==", "DELIVERED"), where("deliveredAt", ">=", since)))
        : Promise.resolve(null),
    ])
      .then(([a, b, cc, d, e]) =>
        setKpis({ customers: a.data().count, vehicles: b.data().count, newCustomers: cc.data().count, newVehicles: d.data().count, deliveredMonth: e ? e.data().count : null }),
      )
      .catch(() => setError(true));
  }, [staff]);
  return { kpis, error };
}

function Kpi({ label, value, icon, hint, tone }: { label: string; value: number | undefined; icon: React.ReactNode; hint?: string; tone: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-slate-500">{label}</div>
          {value === undefined ? <Skeleton className="mt-2 h-8 w-16" /> : <div className="tabular mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</div>}
          {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
        </div>
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      </div>
    </Card>
  );
}

/** Cobrado hoy / este mes y cuentas por cobrar (solo quien ve finanzas). */
/**
 * Cobrado hoy / este mes y cuentas por cobrar, EN TIEMPO REAL (se actualiza solo al registrar
 * un pago, una venta del POS o un pago en línea). Cuentas por cobrar = órdenes + ventas con saldo.
 */
function useMoney(enabled: boolean) {
  const [pays, setPays] = useState<Payment[] | null>(null);
  const [orderBal, setOrderBal] = useState<number | null>(null);
  const [saleBal, setSaleBal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const monthKey = hnDayKey(Date.now()).slice(0, 7);
  useEffect(() => {
    if (!enabled) return;
    const hp = hnParts();
    const since = Timestamp.fromDate(hnDate(hp.y, hp.m, 1));
    const fail = (err: unknown) => {
      console.error("[Dashboard] cobros", err);
      setError(errorMessage(err));
    };
    const u1 = onSnapshot(query(collection(db, catalogCol.payments(TENANT_ID)), where("at", ">=", since)), (snap) => setPays(snap.docs.map((d) => d.data() as Payment)), fail);
    const u2 = onSnapshot(query(collection(db, orderCol.workOrders(TENANT_ID)), where("balance", ">", 0)), (snap) => setOrderBal(snap.docs.reduce((t, d) => t + (d.get("status") === "CANCELLED" ? 0 : Number(d.get("balance") ?? 0)), 0)), fail);
    const u3 = onSnapshot(query(collection(db, catalogCol.sales(TENANT_ID)), where("balance", ">", 0)), (snap) => setSaleBal(snap.docs.reduce((t, d) => t + (d.get("status") === "voided" ? 0 : Number(d.get("balance") ?? 0)), 0)), fail);
    return () => { u1(); u2(); u3(); };
  }, [enabled, monthKey]);
  if (!enabled) return null;
  if (error) return { today: 0, month: 0, receivable: 0, error };
  if (!pays || orderBal === null || saleBal === null) return null;
  const todayMs = hnTodayStart().getTime();
  const valid = pays.filter((p) => p.status === "valid");
  return {
    today: valid.filter((p) => (p.at?.toMillis?.() ?? Date.now()) >= todayMs).reduce((t, p) => t + p.amount, 0),
    month: valid.reduce((t, p) => t + p.amount, 0),
    receivable: orderBal + saleBal,
    error: null as string | null,
  };
}

function MoneyKpi({ label, value, hint, tone }: { label: string; value: number | undefined; hint?: string; tone: string }) {
  return (
    <Card className="p-5">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      {value === undefined ? <Skeleton className="mt-2 h-8 w-28" /> : <div className={`tabular mt-1 text-2xl font-bold tracking-tight ${tone}`}>{formatMoney(value)}</div>}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

const COL_BAR: Record<string, string> = {
  received: "bg-slate-400", diagnosis: "bg-indigo-500", approval: "bg-amber-500", repair: "bg-brand-600", qc: "bg-cyan-500", ready: "bg-green-500",
};

function OrderStatusCard({ orders }: { orders: WorkOrder[] }) {
  const cols = KANBAN_COLUMNS.filter((c) => c.key !== "delivered").map((c) => ({ ...c, n: orders.filter((o) => (c.statuses as readonly string[]).includes(o.status)).length }));
  const max = Math.max(1, ...cols.map((c) => c.n));
  return (
    <div className="space-y-3 p-5">
      {cols.map((c) => (
        <Link key={c.key} to="/ordenes" className="group grid grid-cols-[130px_1fr_28px] items-center gap-3 text-sm">
          <span className="truncate text-slate-600 group-hover:text-slate-900">{c.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <span className={`block h-full rounded-full ${COL_BAR[c.key]}`} style={{ width: `${(c.n / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-semibold">{c.n}</span>
        </Link>
      ))}
    </div>
  );
}

function AlertsCard({ orders }: { orders: WorkOrder[] }) {
  const alerts = [
    ...orders.filter((o) => o.status === "READY").map((o) => ({ o, tone: "text-green-700 bg-green-50", icon: <CheckCircle2 className="h-4 w-4" />, text: "Listo para entregar" })),
    ...orders.filter((o) => ["QUOTE_SENT", "AWAITING_APPROVAL"].includes(o.status)).map((o) => ({ o, tone: "text-amber-800 bg-amber-50", icon: <FileClock className="h-4 w-4" />, text: "Esperando aprobación del cliente" })),
    ...orders.filter((o) => daysInShop(o) >= 5).map((o) => ({ o, tone: "text-red-700 bg-red-50", icon: <Clock className="h-4 w-4" />, text: `${daysInShop(o)} días en taller` })),
    ...orders.filter((o) => !o.technicianIds?.length).map((o) => ({ o, tone: "text-slate-700 bg-slate-100", icon: <Wrench className="h-4 w-4" />, text: "Sin técnico asignado" })),
  ].slice(0, 8);
  if (!alerts.length) return <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Todo en orden por ahora.</div>;
  return (
    <ul className="divide-y divide-slate-100">
      {alerts.map((a, i) => (
        <li key={`${a.o.id}-${i}`}>
          <Link to={`/ordenes/${a.o.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.tone}`}>{a.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{a.o.code} · {a.o.vehicle.make} {a.o.vehicle.model}</span>
              <span className="block text-xs text-slate-500">{a.text}</span>
            </span>
            <PlateTag plate={a.o.vehicle.plate} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function NewCustomersChart() {
  const since = monthStart(-5);
  const { data, loading } = useQueryData<Customer>(
    query(collection(db, col.customers(TENANT_ID)), where("createdAt", ">=", Timestamp.fromDate(since)), orderBy("createdAt"), limit(2000)),
    `dash-new-customers-${since.getTime()}`,
  );
  const series = useMemo(() => {
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = monthStart(i - 5);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()]!, clientes: 0 };
    });
    for (const c of data) {
      const d = toDate(c.createdAt);
      if (!d) continue;
      const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.clientes++;
    }
    return buckets;
  }, [data]);

  if (loading) return <Skeleton className="h-56" />;
  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="35%">
        <CartesianGrid vertical={false} stroke="#EEF1F6" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#94A3B8", fontSize: 12 }} />
        <Tooltip
          cursor={{ fill: "#EEF3FF" }}
          contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 13, boxShadow: "0 8px 24px -8px rgb(15 23 42 / .2)" }}
          formatter={(v) => [String(v), "Clientes nuevos"]}
        />
        <Bar dataKey="clientes" fill="#1447E6" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardPage() {
  const name = useDisplayName();
  const { can, role, user } = useAuth();
  const staff = role !== "technician";
  const isTech = role === "technician";
  const { kpis } = useKpis(staff);
  const open = useOpenOrders();
  const oc = (statuses: string[]) => (open.loading ? undefined : open.data.filter((o) => statuses.includes(o.status)).length);
  const recentCustomers = useQueryData<Customer>(query(collection(db, col.customers(TENANT_ID)), orderBy("createdAt", "desc"), limit(5)), "dash-recent-customers");
  const recentVehicles = useQueryData<Vehicle>(
    query(collection(db, col.vehicles(TENANT_ID)), where("archived", "==", false), orderBy("createdAt", "desc"), limit(4)),
    "dash-recent-vehicles",
  );
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";
  const isEmpty = kpis && kpis.customers === 0 && kpis.vehicles === 0;
  const recentOrders = open.data.slice(0, 5);
  const pendingIntake = usePendingIntakeQuotes(role !== "technician");
  const money = useMoney(can("dashboard.financials"));
  const { prefs, save: savePrefs } = useDashboardPrefs(user?.uid);
  const [customizing, setCustomizing] = useState(false);

  const sections: DashSection[] = [
    { id: "tech", label: "Mis órdenes y mis citas de hoy", show: isTech && !!user, node: (
        <>
      {isTech && user && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2"><MyOrdersCard orders={open.data} loading={open.loading} /></div>
          <TodayAppointmentsCard technicianId={user.uid} title="Mis citas de hoy" />
        </div>
      )}
        </>
      ) },
    { id: "kpis", label: "Vehículos en taller (resumen)", show: true, node: (
        <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Vehículos en taller" value={open.loading ? undefined : open.data.length} icon={<Car className="h-5 w-5" />} tone="bg-brand-50 text-brand-600" />
        <Kpi label="En diagnóstico" value={oc(["RECEIVED", "INSPECTION", "DIAGNOSIS", "AWAITING_QUOTE"])} icon={<Stethoscope className="h-5 w-5" />} tone="bg-indigo-50 text-indigo-600" />
        <Kpi label="Esperando aprobación" value={oc(["QUOTE_SENT", "AWAITING_APPROVAL"])} icon={<FileClock className="h-5 w-5" />} tone="bg-amber-50 text-amber-600" />
        <Kpi label="Listos para entrega" value={oc(["READY"])} icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-green-50 text-green-600" />
      </div>
        </>
      ) },
    { id: "money", label: "Cobrado hoy, del mes y por cobrar", show: can("dashboard.financials"), node: (
        <>
      {can("dashboard.financials") && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyKpi label="Cobrado hoy" value={money?.today} tone="text-slate-900" />
          <MoneyKpi label="Cobrado este mes" value={money?.month} tone="text-emerald-700" />
          <MoneyKpi label="Cuentas por cobrar" value={money?.receivable} hint="Saldos pendientes en órdenes y ventas" tone="text-amber-700" />
          {money?.error && <p className="flex items-center gap-2 text-sm text-amber-700 sm:col-span-3"><AlertTriangle className="h-4 w-4" />No se pudieron cargar los cobros: {money.error}</p>}
        </div>
      )}
        </>
      ) },
    { id: "cash", label: "Gráfica de cobros y cuentas por pagar", show: can("dashboard.financials"), node: (
        <>
      {can("dashboard.financials") && (
        <div className="grid gap-5 xl:grid-cols-3">
          <div className="xl:col-span-2"><CollectedChartCard /></div>
          <OverduePayablesCard />
        </div>
      )}
        </>
      ) },
    { id: "today", label: "Citas de hoy y mantenimientos", show: staff && (can("agenda.read") || can("maintenance.manage")), node: (
        <div className={`grid gap-5 ${can("agenda.read") && can("maintenance.manage") ? "xl:grid-cols-3" : ""}`}>
          {can("agenda.read") && <div className={can("maintenance.manage") ? "xl:col-span-2" : ""}><TodayAppointmentsCard /></div>}
          {can("maintenance.manage") && <MaintenanceCard />}
        </div>
      ) },
    { id: "tomorrow", label: "Citas de mañana (recordatorios)", show: staff && can("agenda.manage"), node: <TomorrowRemindersCard /> },
    { id: "maintQueue", label: "Toca mantenimiento (avisos por WhatsApp)", show: staff && can("maintenance.manage"), node: <ReminderQueueCard /> },
    { id: "orders", label: "Estado de las órdenes y lo que requiere atención", show: true, node: (
        <>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Estado de las órdenes" action={<Link to="/ordenes" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Tablero <ArrowRight className="h-4 w-4" /></Link>} />
          {open.loading ? <div className="p-5"><Skeleton className="h-40" /></div> : <OrderStatusCard orders={open.data} />}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Requiere atención" description="Vehículos listos, cotizaciones sin respuesta y órdenes demoradas" />
          {open.loading ? <div className="p-5"><Skeleton className="h-40" /></div> : <AlertsCard orders={open.data} />}
        </Card>
      </div>
        </>
      ) },
    { id: "intake", label: "Cotizaciones aprobadas pendientes de ingreso", show: staff, node: (
        <>
      {staff && pendingIntake.data.length > 0 && (
        <Card>
          <CardHeader title="Cotizaciones aprobadas, pendientes de ingreso" description="El cliente aprobó pero el vehículo aún no llega. Al recibirlo, conviértala en orden." />
          <ul className="divide-y divide-slate-100">
            {pendingIntake.data.map((q) => (
              <li key={q.id}>
                <Link to={`/cotizaciones/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <PlateTag plate={q.plate} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{q.code} · {q.vehicleLabel}</span><span className="block text-xs text-slate-500">{q.customerName} · aprobada {formatRelative(q.decision?.at)}</span></span>
                  <span className="tabular text-sm font-semibold">{formatMoney(q.totals.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
        </>
      ) },
    { id: "counts", label: "Clientes y vehículos (números)", show: staff, node: (
        <>
      {staff && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Clientes activos" value={kpis?.customers} icon={<Users className="h-5 w-5" />} tone="bg-slate-100 text-slate-600" />
          <Kpi label="Vehículos registrados" value={kpis?.vehicles} icon={<Car className="h-5 w-5" />} tone="bg-sky-50 text-sky-600" />
          <Kpi label="Entregados" value={kpis?.deliveredMonth ?? undefined} hint="Este mes" icon={<ClipboardList className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" />
          <Kpi label="Clientes nuevos" value={kpis?.newCustomers} hint="Este mes" icon={<UserPlus className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" />
        </div>
      )}
        </>
      ) },
    { id: "activity", label: "Clientes nuevos por mes y movimiento reciente", show: true, node: (
        <>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Clientes nuevos por mes" description="Últimos 6 meses" />
          <div className="p-5"><NewCustomersChart /></div>
        </Card>
        <Card>
          <CardHeader title="Movimiento reciente" action={<Link to="/ordenes" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Ver <ArrowRight className="h-4 w-4" /></Link>} />
          {!recentOrders.length ? (
            <div className="p-8 text-center text-sm text-slate-500">No hay vehículos en taller.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentOrders.map((o) => (
                <li key={o.id}>
                  <Link to={`/ordenes/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{o.code} · {o.vehicle.make} {o.vehicle.model}</div>
                      <div className="text-xs text-slate-500">{formatRelative(o.statusChangedAt)}</div>
                    </div>
                    <StatusBadge status={o.status} short />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
        </>
      ) },
    { id: "recent", label: "Últimos clientes y vehículos", show: true, node: (
        <>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Últimos clientes" action={<Link to="/clientes" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Ver todos <ArrowRight className="h-4 w-4" /></Link>} />
          {recentCustomers.loading ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !recentCustomers.data.length ? (
            <div className="p-8 text-center text-sm text-slate-500">Aún no hay clientes registrados.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentCustomers.data.map((c) => (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Avatar name={c.fullName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{c.fullName}</div>
                      <div className="text-xs text-slate-500">{c.vehicleCount ?? 0} vehículo(s)</div>
                    </div>
                    <span className="text-xs text-slate-400">{formatRelative(c.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Últimos vehículos" action={<Link to="/vehiculos" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Ver todos <ArrowRight className="h-4 w-4" /></Link>} />
          <div className="grid gap-3 p-5">
            {recentVehicles.loading ? (
              [0, 1].map((i) => <Skeleton key={i} className="h-[90px]" />)
            ) : recentVehicles.error ? (
              <div className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{recentVehicles.error}</div>
            ) : !recentVehicles.data.length ? (
              <div className="py-4 text-center text-sm text-slate-500">Aún no hay vehículos registrados.</div>
            ) : (
              recentVehicles.data.map((v) => <VehicleCard key={v.id} vehicle={v} />)
            )}
          </div>
        </Card>
      </div>
        </>
      ) },
  ];
  const ordered = arrange(sections, prefs).filter((sec) => !prefs.hidden.includes(sec.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[26px]">{greeting}, {name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Intl.DateTimeFormat("es-HN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} · Resumen de RAPIFIX
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setCustomizing((c) => !c)}>Personalizar</Button>
          {can("customers.write") && <Link to="/clientes"><Button variant="secondary" icon={<UserPlus className="h-4 w-4" />}>Clientes</Button></Link>}
          {can("orders.create") && <Link to="/ordenes/nueva"><Button icon={<Plus className="h-4 w-4" />}>Nueva orden</Button></Link>}
        </div>
      </div>

      {isEmpty && can("settings.write") && (
        <Card className="flex flex-col gap-3 border-brand-200 bg-brand-50/60 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="font-semibold text-brand-900">Su taller está listo para empezar</div>
            <div className="text-sm text-brand-800/80">Registre clientes y vehículos, o cargue los datos de demostración desde Configuración para probar el sistema.</div>
          </div>
          <Link to="/configuracion"><Button variant="secondary">Ir a Configuración</Button></Link>
        </Card>
      )}

      {customizing ? (
        <DashboardCustomizer sections={sections} prefs={prefs} onSave={savePrefs} onDone={() => setCustomizing(false)} />
      ) : null}
      {ordered.map((sec) => <div key={sec.id} className="empty:hidden">{sec.node}</div>)}

      {open.error && <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" />{open.error}</p>}
    </div>
  );
}
