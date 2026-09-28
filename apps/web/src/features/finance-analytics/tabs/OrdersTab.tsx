import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "@rapifix/shared";
import { formatDate, formatPlate } from "@/lib/format";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { loadCore, orderMargin, pct, type OrderFin } from "../data";
import { fmtPct, KpiCard, marginTone, Note, RichTable, Segmented, toReportTable, type Col } from "../components";
import { finKey, type FinTabProps } from "./common";

type SortBy = "date" | "margin" | "profit" | "revenue";
const SORTS: ReadonlyArray<readonly [SortBy, string]> = [["date", "Más recientes"], ["margin", "Menor margen primero"], ["profit", "Mayor utilidad"], ["revenue", "Mayor ingreso"]];

const vehicleLabel = (o: OrderFin) => {
  const v = o.order.vehicle;
  return [v?.make, v?.model, v?.year || ""].filter(Boolean).join(" ") + (v?.plate ? ` · ${formatPlate(v.plate)}` : "");
};

export function OrdersTab(props: FinTabProps) {
  const { data, loading, error } = useLoader(() => loadCore(props.period.start, props.period.end, props.refresh), finKey("orders", props));
  const [sortBy, setSortBy] = useState<SortBy>("date");

  const rows = useMemo(() => {
    if (!data) return [];
    const by: Record<SortBy, (a: OrderFin, b: OrderFin) => number> = {
      date: (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
      margin: (a, b) => (orderMargin(a) ?? Infinity) - (orderMargin(b) ?? Infinity),
      profit: (a, b) => b.profit - a.profit,
      revenue: (a, b) => b.revenue - a.revenue,
    };
    return [...data.orders].sort(by[sortBy]);
  }, [data, sortBy]);

  if (error) return <TabError message={error} />;
  if (loading || !data) return <TabSkeleton />;

  const cols: Col<OrderFin>[] = [
    {
      label: "Orden",
      value: (o) => (o.missingLines ? `${o.order.code} *` : o.order.code),
      render: (o) => (
        <Link to={`/ordenes/${o.order.id}`} className="font-semibold text-brand-700 hover:underline">
          {o.order.code}
          {o.missingLines ? " *" : ""}
        </Link>
      ),
    },
    { label: "Entregada", value: (o) => formatDate(o.at) },
    { label: "Cliente", value: (o) => o.order.customer?.fullName ?? "" },
    { label: "Vehículo", value: vehicleLabel },
    { label: "Técnico(s)", value: (o) => (o.order.technicians ?? []).map((t) => t.name).join(", ") || "Sin asignar" },
    { label: "Ingresos", kind: "money", value: (o) => o.revenue },
    { label: "Costo", kind: "money", value: (o) => o.cost, tone: (o) => (o.missingLines ? "text-amber-700" : undefined) },
    { label: "Utilidad", kind: "money", value: (o) => o.profit },
    { label: "Margen", kind: "percent", value: orderMargin, tone: (o) => marginTone(orderMargin(o), 15) },
    { label: "Pagado", kind: "money", value: (o) => o.order.paid ?? 0 },
    { label: "Saldo", kind: "money", value: (o) => o.order.balance ?? 0, tone: (o) => ((o.order.balance ?? 0) > 0 ? "text-amber-700 font-semibold" : undefined) },
  ];
  const s = (f: (o: OrderFin) => number) => data.orders.reduce((a, o) => a + f(o), 0);
  const revenue = s((o) => o.revenue);
  const profit = s((o) => o.profit);
  const total: ReportCell[] = [`Total (${data.orders.length})`, "", "", "", "", revenue, s((o) => o.cost), profit, pct(profit, revenue), s((o) => o.order.paid ?? 0), s((o) => o.order.balance ?? 0)];
  const low = data.orders.filter((o) => o.revenue > 0 && (orderMargin(o) ?? 100) < 15);
  const withBalance = data.orders.filter((o) => (o.order.balance ?? 0) > 0);
  const sortLabel = SORTS.find((x) => x[0] === sortBy)?.[1] ?? "";

  const tables = [toReportTable(`Rentabilidad por orden (${sortLabel.toLowerCase()})`, cols, rows, total, "No hay órdenes entregadas en el período.")];
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Órdenes entregadas", data.orders.length, "number"],
    ["Ingresos (sin ISV)", revenue, "money"],
    ["Utilidad bruta", profit, "money"],
    ["Margen promedio", pct(profit, revenue), "percent"],
    ["Órdenes con margen menor a 15 %", low.length, "number"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Rentabilidad por orden"
        subtitle={`${props.period.label} · órdenes entregadas`}
        actions={<TabActions title="Finanzas - Órdenes" periodLabel={props.period.label} fileRange={props.fileRange} tables={tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Órdenes entregadas" value={data.orders.length} sub={`Ingresos ${formatMoney(revenue)}`} />
        <KpiCard label="Utilidad bruta" value={formatMoney(profit)} tone={profit >= 0 ? "text-emerald-700" : "text-red-700"} sub={`Margen ${fmtPct(pct(profit, revenue))}`} />
        <KpiCard label="Margen menor a 15 %" value={low.length} tone={low.length ? "text-amber-700" : "text-slate-900"} hint="Órdenes que casi no dejaron ganancia." />
        <KpiCard label="Entregadas con saldo" value={withBalance.length} tone={withBalance.length ? "text-amber-700" : "text-slate-900"} sub={formatMoney(withBalance.reduce((a, o) => a + (o.order.balance ?? 0), 0))} hint="Se entregaron sin cobrar completo." />
      </div>
      {data.missingLines > 0 && (
        <Note tone="warn">Las órdenes marcadas con * tienen repuestos sin costo registrado (o no tienen cotización aprobada): su utilidad puede verse más alta de lo real.</Note>
      )}
      <Segmented label="Ordenar:" value={sortBy} options={SORTS} onChange={setSortBy} />
      <RichTable
        title="Órdenes entregadas"
        description="Ingresos y costo sin ISV según la cotización aprobada. Pagado y saldo incluyen ISV. Margen menor a 15 % en ámbar."
        cols={cols}
        rows={rows}
        total={total}
        maxRows={40}
        rowKey={(o) => o.order.id}
        empty="No hay órdenes entregadas en el período."
      />
    </div>
  );
}
