import { useMemo } from "react";
import { formatMoney, orderCol, STATUS_META, WORK_ORDER_STATUSES, WORK_TYPE_LABELS, WORK_TYPES, type WorkOrder } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { formatDate, formatPlate, toDate } from "@/lib/format";
import { useAuth } from "@/lib/auth/useAuth";
import { fetchRange, sumBy, useLoader } from "../data";
import type { ColKind, ReportCell, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

async function load(p: TabProps) {
  const { start, end } = p.period;
  const path = orderCol.workOrders(TENANT_ID);
  const [created, delivered] = await Promise.all([
    fetchRange<WorkOrder>(path, "createdAt", start, end),
    fetchRange<WorkOrder>(path, "deliveredAt", start, end),
  ]);
  return { created, delivered: delivered.filter((o) => o.status === "DELIVERED") };
}

const daysBetween = (o: WorkOrder) => {
  const a = toDate(o.createdAt)?.getTime();
  const b = toDate(o.deliveredAt)?.getTime();
  return a && b && b >= a ? (b - a) / 86400000 : null;
};

export function OrdersTab(props: TabProps) {
  const { can } = useAuth();
  const showMoney = can("reports.financial") || can("payments.read");
  const { data, loading, error } = useLoader(() => load(props), loaderKey("orders", props));

  const r = useMemo(() => {
    if (!data) return null;
    const { created, delivered } = data;
    const durations = delivered.map(daysBetween).filter((d): d is number => d !== null);
    const avgDays = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const deliveredTotal = sumBy(delivered, (o) => o.totals?.total ?? 0);
    const avgTicket = delivered.length ? Math.round(deliveredTotal / delivered.length) : 0;
    const cancelled = created.filter((o) => o.status === "CANCELLED").length;

    const byStatus: ReportTable = {
      title: "Órdenes creadas en el período, por estado actual",
      columns: [{ label: "Estado" }, { label: "Órdenes", kind: "number" }],
      rows: WORK_ORDER_STATUSES.map((s) => [STATUS_META[s].label, created.filter((o) => o.status === s).length] as [string, number]).filter((x) => x[1] > 0),
      total: ["Total", created.length],
      empty: "No se crearon órdenes en este período.",
    };
    const byType: ReportTable = {
      title: "Por tipo de trabajo",
      columns: [
        { label: "Tipo" },
        { label: "Creadas", kind: "number" },
        { label: "Entregadas", kind: "number" },
        ...(showMoney ? [{ label: "Facturado (entregadas)", kind: "money" as const }] : []),
      ],
      rows: WORK_TYPES.map((t) => {
        const d = delivered.filter((o) => o.type === t);
        return [WORK_TYPE_LABELS[t], created.filter((o) => o.type === t).length, d.length, ...(showMoney ? [sumBy(d, (o) => o.totals?.total ?? 0)] : [])];
      }).filter((x) => (x[1] as number) > 0 || (x[2] as number) > 0),
      total: ["Total", created.length, delivered.length, ...(showMoney ? [deliveredTotal] : [])],
      empty: "Sin órdenes en este período.",
    };
    const list: ReportTable = {
      title: "Órdenes entregadas",
      columns: [
        { label: "Orden" }, { label: "Cliente" }, { label: "Vehículo" }, { label: "Placa" }, { label: "Ingreso" }, { label: "Entrega" },
        { label: "Días en taller", kind: "number" },
        ...(showMoney ? [{ label: "Total", kind: "money" as const }, { label: "Saldo", kind: "money" as const }] : []),
      ],
      rows: [...delivered]
        .sort((a, b) => (toDate(b.deliveredAt)?.getTime() ?? 0) - (toDate(a.deliveredAt)?.getTime() ?? 0))
        .map((o) => [
          o.code, o.customer.fullName, `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year || ""}`.trim(), formatPlate(o.vehicle.plate),
          formatDate(o.createdAt), formatDate(o.deliveredAt), Math.round((daysBetween(o) ?? 0) * 10) / 10,
          ...(showMoney ? [o.totals?.total ?? 0, o.balance ?? 0] : []),
        ]),
      empty: "No se entregaron órdenes en este período.",
    };
    return { avgDays, avgTicket, cancelled, deliveredTotal, tables: [byStatus, byType, list] };
  }, [data, showMoney]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [byStatus, byType, list] = r.tables as [ReportTable, ReportTable, ReportTable];
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Órdenes creadas", data.created.length, "number"],
    ["Órdenes entregadas", data.delivered.length, "number"],
    ["Canceladas (de las creadas)", r.cancelled, "number"],
    ["Tiempo promedio en taller (días)", r.avgDays, "number"],
  ];
  if (showMoney) summary.push(["Ticket promedio (entregadas)", r.avgTicket, "money"]);
  const fmtDays = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(r.avgDays);

  return (
    <div className="space-y-5">
      <TabHeader
        title="Órdenes de trabajo"
        subtitle={props.period.label}
        actions={
          <TabActions
            title="Órdenes"
            periodLabel={props.period.label}
            fileRange={props.fileRange}
            tables={r.tables}
            summary={summary}
          />
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Órdenes creadas" value={data.created.length} hint={r.cancelled ? `${r.cancelled} canceladas` : undefined} />
        <StatCard label="Órdenes entregadas" value={data.delivered.length} tone="text-emerald-700" />
        <StatCard label="Tiempo promedio en taller" value={`${fmtDays} días`} hint="Del ingreso a la entrega" />
        {showMoney ? (
          <StatCard label="Ticket promedio" value={formatMoney(r.avgTicket)} hint={`Facturado: ${formatMoney(r.deliveredTotal)}`} />
        ) : (
          <StatCard label="Abiertas (de las creadas)" value={data.created.filter((o) => o.isOpen).length} />
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <DataTable table={byStatus} />
        <DataTable table={byType} />
      </div>
      <DataTable table={list} maxRows={15} />
    </div>
  );
}
