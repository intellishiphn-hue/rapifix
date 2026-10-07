import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarDays, Car, Clock, Eye, FileSpreadsheet, History, MessageCircle, Printer, RefreshCw, Search, User, Wrench, X,
} from "lucide-react";
import {
  filterHistory, formatMoney, formatPhone, groupHistory, historyTechnicians, hnDayKey, isOrderPaid, orderBalance, orderPaid, orderTotal,
  shopDays, summarizeHistory, whatsappLink, WORK_TYPE_LABELS, WORK_TYPES,
  type HistoryGroup, type HistoryGroupBy, type HistoryPayment, type WorkOrder, type WorkType,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { useDebounced } from "@/lib/firestore/hooks";
import { errorMessage } from "@/lib/errors";
import { formatPlate, toDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { computePeriod, hnTodayStart, type Period, type PeriodKey } from "@/features/reports/period";
import { exportToExcel, type ColKind, type ReportCell, type ReportTable } from "@/features/reports/table";
import { HISTORY_PAGE, useDeliveredHistory } from "./historyApi";

// ---------------- Período ----------------
type HistoryPeriod = PeriodKey | "last90";
const PERIODS: Array<[HistoryPeriod, string]> = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["prevMonth", "Mes anterior"],
  ["last90", "Últimos 90 días"],
  ["year", "Este año"],
  ["custom", "Personalizado"],
];
const DEFAULT_PERIOD: HistoryPeriod = "month";
const isPeriod = (v: string | null): v is HistoryPeriod => PERIODS.some(([k]) => k === v);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function historyPeriod(key: HistoryPeriod, custom: { from: string; to: string }): Period {
  if (key !== "last90") return computePeriod(key, custom);
  const today = hnTodayStart().getTime();
  return { start: new Date(today - 89 * 86400000), end: new Date(today + 86400000), label: "Últimos 90 días" };
}

const GROUPS: Array<[HistoryGroupBy, string]> = [["day", "Día"], ["customer", "Cliente"], ["vehicle", "Vehículo"]];
const isGroup = (v: string | null): v is HistoryGroupBy => GROUPS.some(([k]) => k === v);

// ---------------- Formatos (hora de Honduras) ----------------
const TZ = "America/Tegucigalpa";
const timeFmt = new Intl.DateTimeFormat("es-HN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const fmtTime = (o: WorkOrder) => { const d = toDate(o.deliveredAt); return d ? timeFmt.format(d) : ""; };
const fmtDate = (o: WorkOrder) => { const d = toDate(o.deliveredAt); return d ? dateFmt.format(d) : ""; };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const daysLabel = (n: number) => (n === 0 ? "Mismo día" : n === 1 ? "1 día en taller" : `${n} días en taller`);
const daysShort = (n: number) => (n === 0 ? "mismo día" : n === 1 ? "1 día" : `${n} días`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const techNames = (o: WorkOrder) => o.technicians?.map((t) => t.name).join(", ") ?? "";
const vehicleName = (o: WorkOrder) => [o.vehicle.make, o.vehicle.model, o.vehicle.year || ""].filter(Boolean).join(" ");

/** Historial de órdenes entregadas: por fecha, cliente o vehículo, con resumen y exportación. */
export function OrderHistoryPage() {
  const { can, role } = useAuth();
  // Los montos solo los ve quien maneja cobros (administración, gerencia, recepción); el técnico no.
  const showMoney = can("payments.read");
  const canContact = role !== "technician";

  // Los filtros viven en la URL para poder compartir el enlace o volver con "atrás"
  const [params, setParams] = useSearchParams();
  const today = hnDayKey(hnTodayStart());
  const periodKey = isPeriod(params.get("p")) ? (params.get("p") as HistoryPeriod) : DEFAULT_PERIOD;
  const from = DAY_KEY.test(params.get("desde") ?? "") ? params.get("desde")! : today;
  const to = DAY_KEY.test(params.get("hasta") ?? "") ? params.get("hasta")! : from;
  const technicianId = params.get("tec") ?? "";
  const type = (WORK_TYPES as readonly string[]).includes(params.get("tipo") ?? "") ? (params.get("tipo") as WorkType) : "";
  const payment: HistoryPayment = showMoney && (params.get("pago") === "paid" || params.get("pago") === "balance") ? (params.get("pago") as HistoryPayment) : "all";
  const groupBy = isGroup(params.get("grupo")) ? (params.get("grupo") as HistoryGroupBy) : "day";
  const urlSearch = params.get("q") ?? "";

  const setParam = (changes: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    }, { replace: true });

  // Buscador: se escribe libre y pasa a la URL con un pequeño retraso
  const [search, setSearch] = useState(urlSearch);
  const debounced = useDebounced(search, 250);
  useEffect(() => {
    if (debounced.trim() !== urlSearch) setParam({ q: debounced.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const period = useMemo(() => historyPeriod(periodKey, { from, to }), [periodKey, from, to, today]);
  const history = useDeliveredHistory(period.start, period.end);

  const technicians = useMemo(() => historyTechnicians(history.orders), [history.orders]);
  const rows = useMemo(
    () => filterHistory(history.orders, { search: debounced, technicianId, type, payment }),
    [history.orders, debounced, technicianId, type, payment],
  );
  const summary = useMemo(() => summarizeHistory(rows), [rows]);
  const groups = useMemo(() => groupHistory(rows, groupBy), [rows, groupBy]);

  const filtersOn = !!(debounced.trim() || technicianId || type || payment !== "all");
  const clearFilters = () => {
    setSearch("");
    setParam({ q: null, tec: null, tipo: null, pago: null });
  };

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      await exportToExcel({
        title: "Historial de entregas",
        periodLabel: period.label,
        fileRange: `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`,
        tables: [exportTable(rows, showMoney)],
        summary: exportSummary(summary, showMoney),
      });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const firstLoad = history.loading && !history.orders.length;

  return (
    <>
      <PageHeader
        back={{ to: "/ordenes", label: "Órdenes de trabajo" }}
        title="Historial de entregas"
        description="Todas las órdenes ya entregadas. Búsquelas por fecha, cliente o vehículo."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={history.reload} loading={history.loading && !firstLoad}>Actualizar</Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={onExport} loading={exporting} disabled={!rows.length}>Exportar a Excel</Button>
          </>
        }
      />

      {/* Filtros */}
      <Card className="mb-4 space-y-3 p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <div className="flex w-max rounded-[10px] bg-slate-200/70 p-1">
              {PERIODS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setParam({ p: k === DEFAULT_PERIOD ? null : k, ...(k === "custom" ? { desde: from, hasta: to } : { desde: null, hasta: null }) })}
                  className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", periodKey === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {periodKey === "custom" && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Input type="date" aria-label="Desde" value={from} max={today} onChange={(e) => e.target.value && setParam({ desde: e.target.value, hasta: to < e.target.value ? e.target.value : to })} className="h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none" />
              <span>al</span>
              <Input type="date" aria-label="Hasta" value={to} min={from} max={today} onChange={(e) => e.target.value && setParam({ desde: from, hasta: e.target.value })} className="h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, placa, vehículo u orden" className="pl-9 pr-9" aria-label="Buscar" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Borrar búsqueda">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className={cn("grid gap-2 sm:grid-cols-3 lg:flex", !showMoney && "sm:grid-cols-2")}>
            <Select value={technicianId} onChange={(e) => setParam({ tec: e.target.value || null })} className="lg:w-48" aria-label="Técnico">
              <option value="">Todos los técnicos</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {technicianId && technicianId !== "none" && !technicians.some((t) => t.id === technicianId) && <option value={technicianId}>Técnico seleccionado</option>}
              <option value="none">Sin técnico</option>
            </Select>
            <Select value={type} onChange={(e) => setParam({ tipo: e.target.value || null })} className="lg:w-48" aria-label="Tipo de trabajo">
              <option value="">Todos los trabajos</option>
              {WORK_TYPES.map((t) => <option key={t} value={t}>{WORK_TYPE_LABELS[t]}</option>)}
            </Select>
            {showMoney && (
              <Select value={payment} onChange={(e) => setParam({ pago: e.target.value === "all" ? null : e.target.value })} className="lg:w-44" aria-label="Estado de pago">
                <option value="all">Todos los pagos</option>
                <option value="paid">Pagadas</option>
                <option value="balance">Con saldo</option>
              </Select>
            )}
          </div>
        </div>
      </Card>

      {history.error && !history.orders.length ? (
        <Card><ErrorState message={history.error} onRetry={history.reload} /></Card>
      ) : firstLoad ? (
        <HistorySkeleton money={showMoney} />
      ) : (
        <div className={cn("transition-opacity", history.loading && "opacity-60")}>
          {/* Resumen */}
          <div className={cn("mb-4 grid grid-cols-2 gap-3", showMoney ? "md:grid-cols-3 2xl:grid-cols-6" : "max-w-xl")}>
            <Stat label="Órdenes entregadas" value={summary.count} hint={period.label} />
            {showMoney && (
              <>
                <Stat label="Total facturado" value={formatMoney(summary.billed)} />
                <Stat label="Cobrado" value={formatMoney(summary.collected)} tone="text-emerald-700" />
                <Stat
                  label="Saldo pendiente"
                  value={formatMoney(summary.balance)}
                  tone={summary.balance > 0 ? "text-amber-700" : "text-slate-900"}
                  hint={summary.withBalance ? plural(summary.withBalance, "orden con saldo", "órdenes con saldo") : "Todo cobrado"}
                />
                <Stat label="Ticket promedio" value={formatMoney(summary.avgTicket)} />
              </>
            )}
            <Stat
              label="Días promedio en taller"
              value={summary.avgDays === null ? "-" : new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(summary.avgDays)}
              hint="Del ingreso a la entrega"
            />
          </div>

          {history.hasMore && (
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>Este período tiene muchas entregas: se muestran las {history.orders.length} más recientes. El resumen solo cuenta las que están cargadas.</span>
              <Button variant="secondary" size="sm" onClick={history.loadMore} loading={history.loadingMore}>Cargar {HISTORY_PAGE} más</Button>
            </div>
          )}
          {history.error && <Card className="mb-4"><ErrorState message={history.error} onRetry={history.reload} /></Card>}

          {/* Barra de la lista */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{plural(rows.length, "orden", "órdenes")}</span>
              {filtersOn && history.orders.length !== rows.length && <span> de {history.orders.length}</span>}
              <span className="text-slate-400"> · </span>{period.label}
              {filtersOn && <button onClick={clearFilters} className="ml-2 font-semibold text-brand-700 hover:underline">Limpiar filtros</button>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Agrupar por</span>
              <div className="flex rounded-[10px] bg-slate-200/70 p-1">
                {GROUPS.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setParam({ grupo: k === "day" ? null : k })}
                    className={cn("rounded-lg px-3 py-1 text-sm font-medium", groupBy === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!rows.length ? (
            <Card>
              <EmptyState
                icon={<History className="h-7 w-7" />}
                title={history.orders.length ? "Ninguna orden coincide" : "Sin entregas en este período"}
                description={history.orders.length ? "Pruebe con otra búsqueda o quite algún filtro." : "Cuando se entregue un vehículo, la orden quedará guardada aquí. Pruebe con un período más amplio."}
                action={
                  history.orders.length
                    ? <Button variant="secondary" onClick={clearFilters}>Limpiar filtros</Button>
                    : periodKey !== "year" ? <Button variant="secondary" onClick={() => setParam({ p: "year", desde: null, hasta: null })}>Ver todo el año</Button> : undefined
                }
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => <GroupCard key={g.key} group={g} by={groupBy} showMoney={showMoney} canContact={canContact} />)}
              {history.hasMore && (
                <div className="text-center"><Button variant="ghost" onClick={history.loadMore} loading={history.loadingMore}>Cargar más entregas</Button></div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------- Piezas ----------------

function Stat({ label, value, hint, tone = "text-slate-900", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; icon?: ReactNode }) {
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}<span className="truncate">{label}</span></div>
      <div className={cn("tabular mt-1 truncate text-lg font-bold tracking-tight sm:text-xl", tone)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

function HistorySkeleton({ money }: { money: boolean }) {
  return (
    <div aria-busy="true" aria-label="Cargando historial">
      <div className={cn("mb-4 grid grid-cols-2 gap-3", money ? "md:grid-cols-3 2xl:grid-cols-6" : "max-w-xl")}>
        {Array.from({ length: money ? 6 : 2 }, (_, i) => <Skeleton key={i} className="h-[86px]" />)}
      </div>
      <div className="space-y-4">
        {[5, 3].map((n, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3"><Skeleton className="h-5 w-40" /></div>
            <div className="space-y-3 p-4">{Array.from({ length: n }, (_, j) => <Skeleton key={j} className="h-11" />)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PayBadge({ order }: { order: WorkOrder }) {
  if (orderTotal(order) <= 0 && isOrderPaid(order)) return <Badge tone="gray">Sin cobro</Badge>;
  if (isOrderPaid(order)) return <Badge tone="green">Pagada</Badge>;
  return <Badge tone="amber">Saldo {formatMoney(orderBalance(order))}</Badge>;
}

const actionBase = "inline-flex h-8 w-8 lg:h-7 lg:w-7 items-center justify-center rounded-lg transition";
const actionCls = `${actionBase} text-slate-500 hover:bg-slate-100 hover:text-slate-900`;

function RowActions({ order, canContact }: { order: WorkOrder; canContact: boolean }) {
  const phone = order.customer.whatsapp || order.customer.phone;
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Link to={`/ordenes/${order.id}`} className={actionCls} title="Ver orden" aria-label={`Ver orden ${order.code}`}><Eye className="h-4 w-4" /></Link>
      <a href={`/imprimir/orden/${order.id}`} target="_blank" rel="noreferrer" className={actionCls} title="Imprimir" aria-label={`Imprimir orden ${order.code}`}><Printer className="h-4 w-4" /></a>
      {canContact && phone && (
        <a href={whatsappLink(phone)} target="_blank" rel="noreferrer" className={`${actionBase} text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700`} title="WhatsApp al cliente" aria-label={`WhatsApp a ${order.customer.fullName}`}>
          <MessageCircle className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

function GroupCard({ group, by, showMoney, canContact }: { group: HistoryGroup<WorkOrder>; by: HistoryGroupBy; showMoney: boolean; canContact: boolean }) {
  const navigate = useNavigate();
  const Icon = by === "day" ? CalendarDays : by === "customer" ? User : Car;
  const countLabel = by === "day" ? plural(group.count, "entrega", "entregas") : plural(group.count, "visita", "visitas");
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-inset ring-slate-200"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-[15px] font-semibold text-slate-900">{by === "day" ? capital(group.label) : group.label}</h2>
            {group.plate && <PlateTag plate={group.plate} />}
          </div>
          <div className="truncate text-xs text-slate-500">
            {countLabel}
            {by === "customer" && group.sublabel && ` · ${formatPhone(group.sublabel)}`}
            {by === "vehicle" && group.sublabel && ` · ${group.sublabel}`}
          </div>
        </div>
        {showMoney && (
          <div className="shrink-0 text-right">
            <div className="tabular text-sm font-bold text-slate-900">{formatMoney(group.total)}</div>
            <div className={cn("text-xs", group.balance > 0 ? "font-medium text-amber-700" : "text-slate-500")}>
              {group.balance > 0 ? `Saldo ${formatMoney(group.balance)}` : by === "day" ? "Facturado" : "Total gastado"}
            </div>
          </div>
        )}
      </div>

      {/* Escritorio: filas alineadas entre grupos */}
      <div className="hidden lg:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[13%]" /><col /><col className={by === "vehicle" ? "w-[22%]" : "w-[17%]"} />
            <col className="w-[13%]" /><col className="w-[15%]" />{showMoney && <col className="w-[15%]" />}<col className="w-[112px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2 font-semibold">Orden</th>
              <th className="px-3 py-2 font-semibold">{by === "customer" ? "Teléfono" : "Cliente"}</th>
              <th className="px-3 py-2 font-semibold">{by === "vehicle" ? "Trabajo" : "Vehículo"}</th>
              <th className="px-3 py-2 font-semibold">Técnico</th>
              <th className="px-3 py-2 font-semibold">Entregada</th>
              {showMoney && <th className="px-3 py-2 text-right font-semibold">Total</th>}
              <th className="px-4 py-2 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {group.orders.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/ordenes/${o.id}`)} className="cursor-pointer align-middle hover:bg-brand-50/40">
                <td className="px-4 py-2.5">
                  <div className="font-bold text-brand-700">{o.code}</div>
                  <div className="truncate text-xs text-slate-500">{WORK_TYPE_LABELS[o.type] ?? "Otro"}</div>
                </td>
                <td className="px-3 py-2.5">
                  {by === "customer" ? (
                    <div className="tabular truncate text-slate-700">{formatPhone(o.customer.phone) || "-"}</div>
                  ) : (
                    <>
                      <div className="line-clamp-2 font-medium leading-snug text-slate-900" title={o.customer.fullName}>{o.customer.fullName}</div>
                      <div className="tabular truncate text-xs text-slate-500">{formatPhone(o.customer.phone)}</div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {by === "vehicle" ? (
                    <div className="line-clamp-2 text-slate-700" title={o.reason}>{o.reason || WORK_TYPE_LABELS[o.type] || "Otro"}</div>
                  ) : (
                    <>
                      <div className="truncate text-slate-900" title={vehicleName(o)}>{vehicleName(o)}</div>
                      <PlateTag plate={o.vehicle.plate} className="mt-0.5 text-[10px]" />
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="line-clamp-2 text-slate-700" title={techNames(o)}>{techNames(o) || <span className="text-slate-400">Sin técnico</span>}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="truncate text-slate-900">{by === "day" ? fmtTime(o) : fmtDate(o)}</div>
                  <div className="truncate text-xs text-slate-500">{by === "day" ? daysLabel(shopDays(o)) : `${fmtTime(o)} · ${daysShort(shopDays(o))}`}</div>
                </td>
                {showMoney && (
                  <td className="px-3 py-2.5 text-right">
                    <div className="tabular font-semibold text-slate-900">{formatMoney(orderTotal(o))}</div>
                    <div className="mt-0.5"><PayBadge order={o} /></div>
                  </td>
                )}
                <td className="px-3 py-2.5"><RowActions order={o} canContact={canContact} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular y tableta: tarjetas */}
      <ul className="divide-y divide-slate-100 lg:hidden">
        {group.orders.map((o) => (
          <li key={o.id} onClick={() => navigate(`/ordenes/${o.id}`)} className="cursor-pointer px-4 py-3 active:bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate">
                <span className="text-sm font-bold text-brand-700">{o.code}</span>
                <span className="ml-2 text-xs text-slate-500">{WORK_TYPE_LABELS[o.type] ?? "Otro"}</span>
              </div>
              {showMoney && <PayBadge order={o} />}
            </div>
            {by !== "vehicle" && (
              <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-900">
                <span className="min-w-0 truncate font-medium">{vehicleName(o)}</span>
                <PlateTag plate={o.vehicle.plate} className="shrink-0 text-[10px]" />
              </div>
            )}
            {by !== "customer" && <div className="mt-0.5 truncate text-sm text-slate-600">{o.customer.fullName}</div>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{by === "day" ? fmtTime(o) : `${fmtDate(o)}, ${fmtTime(o)}`}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{daysLabel(shopDays(o))}</span>
              <span className="inline-flex min-w-0 items-center gap-1"><Wrench className="h-3 w-3 shrink-0" /><span className="truncate">{techNames(o) || "Sin técnico"}</span></span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {showMoney ? <span className="tabular text-sm font-bold text-slate-900">{formatMoney(orderTotal(o))}</span> : <span />}
              <RowActions order={o} canContact={canContact} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------- Excel ----------------

function exportTable(rows: WorkOrder[], money: boolean): ReportTable {
  const columns: ReportTable["columns"] = [
    { label: "Orden" }, { label: "Entregada" }, { label: "Hora" }, { label: "Cliente" }, { label: "Teléfono" }, { label: "Vehículo" }, { label: "Placa" },
    { label: "Tipo de trabajo" }, { label: "Técnico" }, { label: "Días en taller", kind: "number" },
    ...(money ? [{ label: "Total", kind: "money" as const }, { label: "Cobrado", kind: "money" as const }, { label: "Saldo", kind: "money" as const }, { label: "Pago" }] : []),
  ];
  const body: ReportCell[][] = rows.map((o) => [
    o.code, fmtDate(o), fmtTime(o), o.customer.fullName, formatPhone(o.customer.phone), vehicleName(o), formatPlate(o.vehicle.plate),
    WORK_TYPE_LABELS[o.type] ?? "Otro", techNames(o) || "Sin técnico", shopDays(o),
    ...(money ? [orderTotal(o), orderPaid(o), orderBalance(o), isOrderPaid(o) ? "Pagada" : "Con saldo"] : []),
  ]);
  const s = summarizeHistory(rows);
  return {
    title: "Órdenes entregadas",
    columns,
    rows: body,
    total: money ? ["Total", "", "", "", "", "", "", "", "", null, s.billed, s.collected, s.balance, ""] : undefined,
    empty: "Sin entregas con estos filtros",
  };
}

function exportSummary(s: ReturnType<typeof summarizeHistory>, money: boolean): Array<[string, ReportCell, ColKind?]> {
  return [
    ["Órdenes entregadas", s.count, "number"],
    ...(money
      ? ([["Total facturado", s.billed, "money"], ["Cobrado", s.collected, "money"], ["Saldo pendiente", s.balance, "money"], ["Ticket promedio", s.avgTicket, "money"]] as Array<[string, ReportCell, ColKind]>)
      : []),
    ["Días promedio en taller", s.avgDays, "number"],
  ];
}
