import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import {
  agingBucket, daysOverdue, deliveredMs, formatMoney, hnDayKey, orderBalance, orderDueKey, orderPaid, orderTotal,
  type Company, type WorkOrder,
} from "@rapifix/shared";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Segmented } from "@/features/finance-analytics/components";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { keyLabel } from "./api";

type Filter = "open" | "balance" | "all";

/** Vencimiento de una orden: badge con días de atraso. */
export function DueBadge({ dueKey, today }: { dueKey: string | null; today: string }) {
  if (!dueKey) return <span className="text-xs text-slate-400">Al entregar</span>;
  const d = daysOverdue(dueKey, today);
  const b = agingBucket(dueKey, today);
  if (b === "current") return <span className="text-xs text-slate-600">{dueKey === today ? "Vence hoy" : `Vence ${keyLabel(dueKey)}`}</span>;
  return <Badge tone="red">Vencida {d} {d === 1 ? "día" : "días"}</Badge>;
}

/** Pestaña Órdenes: abiertas e históricas de la empresa, con total, pagado, saldo y vencimiento. */
export function OrdersTab({ company, orders, loading, error, showMoney }: { company: Company; orders: WorkOrder[]; loading: boolean; error: string | null; showMoney: boolean }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const today = hnDayKey(Date.now());

  const rows = useMemo(() => {
    const list = orders.filter((o) => (filter === "open" ? o.isOpen : filter === "balance" ? o.status !== "CANCELLED" && orderBalance(o) > 0 : true));
    return list.map((o) => {
      const at = o.status === "DELIVERED" ? deliveredMs(o) : null;
      return { o, at, dueKey: orderBalance(o) > 0 && o.status !== "CANCELLED" ? orderDueKey(company, at) : null };
    });
  }, [orders, filter, company]);

  if (error) return <ErrorState message={error} />;
  const open = orders.filter((o) => o.isOpen).length;
  const withBalance = orders.filter((o) => o.status !== "CANCELLED" && orderBalance(o) > 0).length;

  return (
    <div>
      <div className="px-5 py-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[["all", `Todas (${orders.length})`], ["open", `Abiertas (${open})`], ...(showMoney ? ([["balance", `Con saldo (${withBalance})`]] as const) : [])]}
        />
      </div>
      {loading && !orders.length ? (
        <div className="space-y-3 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="Sin órdenes" description={orders.length ? "Ninguna orden con este filtro." : "Cuando un vehículo de la flota entre al taller, su orden aparecerá aquí."} />
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Orden</th><th className="px-3 py-2.5">Vehículo</th><th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">Ingreso</th><th className="px-3 py-2.5">Entrega</th>
                  {showMoney && <><th className="px-3 py-2.5 text-right">Total</th><th className="px-3 py-2.5 text-right">Pagado</th><th className="px-3 py-2.5 text-right">Saldo</th><th className="px-3 py-2.5">Vencimiento</th></>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ o, at, dueKey }) => (
                  <tr key={o.id} onClick={() => navigate(`/ordenes/${o.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                    <td className="whitespace-nowrap px-5 py-2.5 font-bold text-brand-700">{o.code}</td>
                    <td className="px-3 py-2.5"><div className="flex items-center gap-2"><PlateTag plate={o.vehicle.plate} className="text-[10px]" /><span className="truncate text-slate-800">{o.vehicle.make} {o.vehicle.model}</span></div></td>
                    <td className="px-3 py-2.5"><StatusBadge status={o.status} short /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(o.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{at ? formatDate(new Date(at)) : "—"}</td>
                    {showMoney && (
                      <>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{formatMoney(orderTotal(o))}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-slate-600">{formatMoney(orderPaid(o))}</td>
                        <td className={cn("tabular whitespace-nowrap px-3 py-2.5 text-right font-semibold", orderBalance(o) > 0 ? "text-amber-700" : "text-slate-400")}>{formatMoney(orderBalance(o))}</td>
                        <td className="px-3 py-2.5">{orderBalance(o) > 0 && o.status !== "CANCELLED" ? <DueBadge dueKey={dueKey} today={today} /> : <span className="text-xs text-emerald-700">{orderTotal(o) > 0 ? "Pagada" : ""}</span>}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 lg:hidden">
            {rows.map(({ o, at, dueKey }) => (
              <li key={o.id}>
                <Link to={`/ordenes/${o.id}`} className="block px-4 py-3 active:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-brand-700">{o.code}</span>
                    <StatusBadge status={o.status} short />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm"><PlateTag plate={o.vehicle.plate} className="text-[10px]" /><span className="truncate">{o.vehicle.make} {o.vehicle.model}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{at ? `Entregada ${formatDate(new Date(at))}` : `Ingresó ${formatDate(o.createdAt)}`}</span>
                    {showMoney && (orderBalance(o) > 0 && o.status !== "CANCELLED" ? <DueBadge dueKey={dueKey} today={today} /> : null)}
                  </div>
                  {showMoney && (
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-right text-xs">
                      <div><div className="text-slate-400">Total</div><div className="tabular text-slate-800">{formatMoney(orderTotal(o))}</div></div>
                      <div><div className="text-slate-400">Pagado</div><div className="tabular text-slate-600">{formatMoney(orderPaid(o))}</div></div>
                      <div><div className="text-slate-400">Saldo</div><div className={cn("tabular font-semibold", orderBalance(o) > 0 ? "text-amber-700" : "text-slate-400")}>{formatMoney(orderBalance(o))}</div></div>
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
