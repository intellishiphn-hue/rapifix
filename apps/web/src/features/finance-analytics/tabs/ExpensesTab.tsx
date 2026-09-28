import { useMemo } from "react";
import { formatMoney, type Expense } from "@rapifix/shared";
import { formatDate, toDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { loadExpenses, pct } from "../data";
import { Delta, DonutChart, fmtPct, KpiCard, PALETTE, RichTable, toReportTable, type Col } from "../components";
import { finKey, type FinTabProps } from "./common";

interface CatRow {
  category: string;
  count: number;
  amount: number;
  share: number | null;
  prev: number;
}

export function ExpensesTab(props: FinTabProps) {
  const { data, loading, error } = useLoader(
    async () => {
      const [cur, prev] = await Promise.all([
        loadExpenses(props.period.start, props.period.end, props.refresh),
        loadExpenses(props.prev.start, props.prev.end, props.refresh),
      ]);
      return { cur, prev };
    },
    finKey("expenses", props),
  );

  const r = useMemo(() => {
    if (!data) return null;
    const total = data.cur.reduce((a, e) => a + e.amount, 0);
    const prevTotal = data.prev.reduce((a, e) => a + e.amount, 0);
    const cats = new Set([...data.cur, ...data.prev].map((e) => e.category || "Otros"));
    const rows: CatRow[] = [...cats]
      .map((c) => {
        const l = data.cur.filter((e) => (e.category || "Otros") === c);
        const amount = l.reduce((a, e) => a + e.amount, 0);
        return { category: c, count: l.length, amount, share: pct(amount, total), prev: data.prev.filter((e) => (e.category || "Otros") === c).reduce((a, e) => a + e.amount, 0) };
      })
      .sort((a, b) => b.amount - a.amount || b.prev - a.prev);
    const top = [...data.cur].sort((a, b) => b.amount - a.amount).slice(0, 10);
    return { total, prevTotal, rows, top };
  }, [data]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;

  const change = (x: CatRow) => (x.prev ? ((x.amount - x.prev) / x.prev) * 100 : null);
  const catCols: Col<CatRow>[] = [
    { label: "Categoría", value: (x) => x.category },
    { label: "Registros", kind: "number", value: (x) => x.count },
    { label: "Monto", kind: "money", value: (x) => x.amount },
    { label: "% del total", kind: "percent", value: (x) => x.share },
    { label: "Período anterior", kind: "money", value: (x) => x.prev },
    {
      label: "Variación",
      kind: "percent",
      value: (x) => change(x),
      tone: (x) => {
        const c = change(x);
        return c === null ? undefined : c > 10 ? "text-red-700 font-semibold" : c < -10 ? "text-emerald-700" : undefined;
      },
    },
  ];
  const catTotal: ReportCell[] = ["Total", data.cur.length, r.total, r.total ? 100 : null, r.prevTotal, r.prevTotal ? ((r.total - r.prevTotal) / r.prevTotal) * 100 : null];

  const topCols: Col<Expense>[] = [
    { label: "Fecha", value: (e) => formatDate(toDate(e.date)) },
    { label: "Código", value: (e) => e.code },
    { label: "Categoría", value: (e) => e.category },
    { label: "Descripción", value: (e) => e.description },
    { label: "Proveedor", value: (e) => e.supplierName || "" },
    { label: "Monto", kind: "money", value: (e) => e.amount },
  ];

  const donut = r.rows.filter((x) => x.amount > 0).slice(0, 6).map((x, i) => ({ name: x.category, value: x.amount, color: PALETTE[i % PALETTE.length]! }));
  const rest = r.rows.filter((x) => x.amount > 0).slice(6).reduce((a, x) => a + x.amount, 0);
  if (rest > 0) donut.push({ name: "Resto", value: rest, color: "#CBD5E1" });

  const tables = [
    toReportTable("Gastos por categoría", catCols, r.rows, catTotal, "No hay gastos en este período."),
    toReportTable("Los 10 gastos más grandes", topCols, r.top, undefined, "No hay gastos en este período."),
  ];
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Total de gastos", r.total, "money"],
    ["Período anterior", r.prevTotal, "money"],
    ["Período comparado", props.prev.label],
  ];
  const topCat = r.rows[0];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Gastos operativos"
        subtitle={`${props.period.label} · comparado con ${props.prev.label}`}
        actions={<TabActions title="Finanzas - Gastos" periodLabel={props.period.label} fileRange={props.fileRange} tables={tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Total de gastos" value={formatMoney(r.total)} tone="text-red-700" sub={`${data.cur.length} registros`} delta={<Delta current={r.total} previous={r.prevTotal} goodWhenUp={false} />} />
        <KpiCard label="Categoría principal" value={topCat && topCat.amount > 0 ? formatMoney(topCat.amount) : "—"} sub={topCat && topCat.amount > 0 ? `${topCat.category} · ${fmtPct(topCat.share)}` : "Sin gastos"} />
        <KpiCard label="Gasto promedio" value={data.cur.length ? formatMoney(Math.round(r.total / data.cur.length)) : "—"} hint="Solo gastos válidos (no anulados), por fecha del gasto." />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="report-card">
          <CardHeader title="Distribución" />
          <div className="px-5 pb-5">{donut.length ? <DonutChart data={donut} /> : <p className="py-6 text-center text-sm text-slate-500">No hay gastos en este período.</p>}</div>
        </Card>
        <RichTable
          title="Por categoría"
          description="Aumentos de más de 10 % en rojo."
          cols={catCols}
          rows={r.rows}
          total={catTotal}
          rowKey={(x) => x.category}
          empty="No hay gastos en este período."
        />
      </div>
      <RichTable title="Los 10 gastos más grandes" cols={topCols} rows={r.top} rowKey={(e) => e.id} empty="No hay gastos en este período." />
      <p className="text-xs text-slate-500">Las compras de repuestos para inventario no son gastos: se reflejan como costo cuando el repuesto se vende.</p>
    </div>
  );
}
