import { useMemo } from "react";
import { financeCol, formatMoney, PAYMENT_METHOD_LABELS, type Expense } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { formatDate, toDate } from "@/lib/format";
import { fetchRange, sumBy, useLoader } from "../data";
import type { ColKind, ReportCell, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

export function ExpensesTab(props: TabProps) {
  const { data, loading, error } = useLoader(
    () => fetchRange<Expense>(financeCol.expenses(TENANT_ID), "date", props.period.start, props.period.end).then((l) => l.filter((e) => e.status === "valid")),
    loaderKey("expenses", props),
  );

  const r = useMemo(() => {
    if (!data) return null;
    const total = sumBy(data, (e) => e.amount);
    const cats = new Map<string, { count: number; total: number }>();
    for (const e of data) {
      const c = cats.get(e.category) ?? { count: 0, total: 0 };
      c.count++;
      c.total += e.amount;
      cats.set(e.category, c);
    }
    const catList = [...cats.entries()].sort((a, b) => b[1].total - a[1].total);
    const tCats: ReportTable = {
      title: "Gastos por categoría",
      columns: [{ label: "Categoría" }, { label: "Registros", kind: "number" }, { label: "Monto", kind: "money" }, { label: "% del total", kind: "percent" }],
      rows: catList.map(([name, c]) => [name, c.count, c.total, total ? (c.total / total) * 100 : 0]),
      total: ["Total", data.length, total, total ? 100 : null],
      empty: "No hay gastos registrados en este período.",
    };
    const tList: ReportTable = {
      title: "Detalle de gastos",
      columns: [{ label: "Fecha" }, { label: "Código" }, { label: "Categoría" }, { label: "Descripción" }, { label: "Proveedor" }, { label: "Método" }, { label: "Monto", kind: "money" }],
      rows: [...data]
        .sort((a, b) => (toDate(b.date)?.getTime() ?? 0) - (toDate(a.date)?.getTime() ?? 0))
        .map((e) => [formatDate(e.date), e.code, e.category, e.description, e.supplierName || "", PAYMENT_METHOD_LABELS[e.method] ?? e.method, e.amount]),
      total: ["Total", "", "", "", "", "", total],
      empty: "No hay gastos registrados en este período.",
    };
    return { total, top: catList[0], tables: [tCats, tList] };
  }, [data]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [tCats, tList] = r.tables as [ReportTable, ReportTable];
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Total de gastos", r.total, "money"],
    ["Registros", data.length, "number"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Gastos"
        subtitle={`${props.period.label} · no incluye los anulados`}
        actions={<TabActions title="Gastos" periodLabel={props.period.label} fileRange={props.fileRange} tables={r.tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total de gastos" value={formatMoney(r.total)} tone="text-red-700" />
        <StatCard label="Registros" value={data.length} />
        <StatCard label="Categoría principal" value={r.top ? r.top[0] : "—"} hint={r.top ? formatMoney(r.top[1].total) : undefined} />
      </div>
      <DataTable table={tCats} />
      <DataTable table={tList} maxRows={20} />
    </div>
  );
}
