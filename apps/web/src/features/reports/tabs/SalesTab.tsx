import { useMemo } from "react";
import { catalogCol, formatMoney, normalizeText, type Sale } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { formatDate, toDate } from "@/lib/format";
import { fetchRange, sumBy, useLoader } from "../data";
import type { ColKind, ReportCell, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

export function SalesTab(props: TabProps) {
  const { data, loading, error } = useLoader(
    () => fetchRange<Sale>(catalogCol.sales(TENANT_ID), "at", props.period.start, props.period.end),
    loaderKey("sales", props),
  );

  const r = useMemo(() => {
    if (!data) return null;
    const total = sumBy(data, (s) => s.totals.total);
    const paid = sumBy(data, (s) => s.paid);
    const balance = sumBy(data, (s) => s.balance);

    const items = new Map<string, { name: string; qty: number; revenue: number }>();
    const sellers = new Map<string, { name: string; count: number; total: number }>();
    for (const s of data) {
      for (const it of s.items) {
        const key = it.refId || normalizeText(it.description);
        const a = items.get(key) ?? { name: it.description, qty: 0, revenue: 0 };
        a.qty += it.qty;
        a.revenue += it.lineTotal;
        items.set(key, a);
      }
      const v = sellers.get(s.by) ?? { name: s.byName || "Sin nombre", count: 0, total: 0 };
      v.count++;
      v.total += s.totals.total;
      sellers.set(s.by, v);
    }
    const itemList = [...items.values()].sort((a, b) => b.revenue - a.revenue);
    const tItems: ReportTable = {
      title: "Productos y servicios vendidos",
      columns: [{ label: "Descripción" }, { label: "Cantidad", kind: "number" }, { label: "Ingreso (sin ISV)", kind: "money" }],
      rows: itemList.map((a) => [a.name, a.qty, a.revenue]),
      total: ["Total", sumBy(itemList, (a) => a.qty), sumBy(itemList, (a) => a.revenue)],
      empty: "No hay ventas en este período.",
    };
    const tSellers: ReportTable = {
      title: "Ventas por vendedor",
      columns: [{ label: "Vendedor" }, { label: "Ventas", kind: "number" }, { label: "Total", kind: "money" }],
      rows: [...sellers.values()].sort((a, b) => b.total - a.total).map((v) => [v.name, v.count, v.total]),
      total: ["Total", data.length, total],
      empty: "No hay ventas en este período.",
    };
    const tList: ReportTable = {
      title: "Detalle de ventas",
      columns: [{ label: "Venta" }, { label: "Fecha" }, { label: "Cliente" }, { label: "Vendedor" }, { label: "Total", kind: "money" }, { label: "Pagado", kind: "money" }, { label: "Saldo", kind: "money" }],
      rows: [...data]
        .sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0))
        .map((s) => [s.code, formatDate(s.at, true), s.customerName || "Consumidor final", s.byName, s.totals.total, s.paid, s.balance]),
      total: ["Total", "", "", "", total, paid, balance],
      empty: "No hay ventas en este período.",
    };
    return { total, paid, balance, tables: [tItems, tSellers, tList] };
  }, [data]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [tItems, tSellers, tList] = r.tables as [ReportTable, ReportTable, ReportTable];
  const avg = data.length ? Math.round(r.total / data.length) : 0;
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Número de ventas", data.length, "number"],
    ["Total vendido", r.total, "money"],
    ["Cobrado en esas ventas", r.paid, "money"],
    ["Saldo pendiente", r.balance, "money"],
    ["Ticket promedio", avg, "money"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Ventas del punto de venta"
        subtitle={props.period.label}
        actions={<TabActions title="Ventas POS" periodLabel={props.period.label} fileRange={props.fileRange} tables={r.tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total vendido" value={formatMoney(r.total)} hint={`${data.length} ventas`} tone="text-emerald-700" />
        <StatCard label="Cobrado" value={formatMoney(r.paid)} />
        <StatCard label="Saldo pendiente" value={formatMoney(r.balance)} tone={r.balance > 0 ? "text-amber-700" : "text-slate-900"} />
        <StatCard label="Ticket promedio" value={formatMoney(avg)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <DataTable table={tItems} maxRows={12} />
        <DataTable table={tSellers} />
      </div>
      <DataTable table={tList} maxRows={15} />
    </div>
  );
}
