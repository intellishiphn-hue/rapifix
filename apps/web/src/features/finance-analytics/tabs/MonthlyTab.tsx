import { useMemo, useState } from "react";
import { formatMoney, hnDayKey } from "@rapifix/shared";
import { toDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { loadCore, loadExpenses, loadPayments, pct } from "../data";
import { last12Months, monthKeys, monthLabel } from "../period";
import { fmtPct, KpiCard, marginTone, MoneyChart, RichTable, Segmented, toReportTable, type Col } from "../components";
import type { FinTabProps } from "./common";

interface MonthRow {
  key: string;
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  expenses: number;
  net: number;
  collected: number;
  margin: number | null;
  orders: number;
}

type View = "profit" | "cash";

export function MonthlyTab(props: FinTabProps) {
  const range = useMemo(() => last12Months(), []);
  const { data, loading, error } = useLoader(async () => {
    const [core, payments, expenses] = await Promise.all([
      loadCore(range.start, range.end, props.refresh),
      loadPayments(range.start, range.end, props.refresh),
      loadExpenses(range.start, range.end, props.refresh),
    ]);
    return { core, payments, expenses };
  }, `fin-monthly|${range.start.getTime()}|${props.refresh}`);
  const [view, setView] = useState<View>("profit");

  const rows = useMemo(() => {
    if (!data) return [] as MonthRow[];
    const keys = monthKeys(range.start, range.end);
    const map = new Map<string, MonthRow>(keys.map((k) => [k, { key: k, label: monthLabel(k), revenue: 0, cost: 0, profit: 0, expenses: 0, net: 0, collected: 0, margin: null, orders: 0 }]));
    const mk = (d: Date | null) => (d ? hnDayKey(d).slice(0, 7) : "");
    for (const o of data.core.orders) {
      const m = map.get(mk(o.at));
      if (!m) continue;
      m.revenue += o.revenue;
      m.cost += o.cost;
      m.orders++;
    }
    for (const s of data.core.sales) {
      const m = map.get(mk(s.at));
      if (!m) continue;
      m.revenue += s.revenue;
      m.cost += s.cost;
    }
    for (const e of data.expenses) {
      const m = map.get(mk(toDate(e.date)));
      if (m) m.expenses += e.amount;
    }
    for (const p of data.payments) {
      const m = map.get(mk(toDate(p.at)));
      if (m) m.collected += p.amount;
    }
    return [...map.values()].map((m) => ({ ...m, profit: m.revenue - m.cost, net: m.revenue - m.cost - m.expenses, margin: pct(m.revenue - m.cost, m.revenue) }));
  }, [data, range]);

  if (error) return <TabError message={error} />;
  if (loading || !data) return <TabSkeleton />;

  const cols: Col<MonthRow>[] = [
    { label: "Mes", value: (m) => m.label },
    { label: "Órdenes", kind: "number", value: (m) => m.orders },
    { label: "Ingresos", kind: "money", value: (m) => m.revenue },
    { label: "Costo", kind: "money", value: (m) => m.cost },
    { label: "Utilidad bruta", kind: "money", value: (m) => m.profit },
    { label: "Margen", kind: "percent", value: (m) => m.margin, tone: (m) => marginTone(m.margin) },
    { label: "Gastos", kind: "money", value: (m) => m.expenses },
    { label: "Utilidad neta", kind: "money", value: (m) => m.net, tone: (m) => (m.net < 0 ? "text-red-700 font-semibold" : undefined) },
    { label: "Cobrado", kind: "money", value: (m) => m.collected },
  ];
  const s = (f: (m: MonthRow) => number) => rows.reduce((a, m) => a + f(m), 0);
  const revenue = s((m) => m.revenue);
  const profit = s((m) => m.profit);
  const net = s((m) => m.net);
  const total: ReportCell[] = ["Total 12 meses", s((m) => m.orders), revenue, s((m) => m.cost), profit, pct(profit, revenue), s((m) => m.expenses), net, s((m) => m.collected)];
  const withData = rows.filter((m) => m.revenue > 0);
  const bestMonth = [...withData].sort((a, b) => b.net - a.net)[0];
  const chart = rows.map((m) => ({ label: m.label.slice(0, 3) + " " + m.key.slice(2, 4), revenue: m.revenue, cost: m.cost, profit: m.profit, expenses: m.expenses, net: m.net, collected: m.collected }));

  const tables = [toReportTable("Mes a mes (últimos 12 meses)", cols, rows, total)];
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Ingresos 12 meses", revenue, "money"],
    ["Utilidad bruta 12 meses", profit, "money"],
    ["Utilidad neta estimada 12 meses", net, "money"],
    ["Promedio mensual de ingresos", Math.round(revenue / (rows.length || 1)), "money"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Mes a mes"
        subtitle={`Últimos 12 meses: ${range.label} (no depende del período seleccionado)`}
        actions={<TabActions title="Finanzas - Mes a mes" periodLabel={range.label} fileRange={`${hnDayKey(range.start)} a ${hnDayKey(range.end.getTime() - 1)}`} tables={tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ingresos 12 meses" value={formatMoney(revenue)} sub={`Promedio ${formatMoney(Math.round(revenue / (rows.length || 1)))} por mes`} />
        <KpiCard label="Utilidad bruta" value={formatMoney(profit)} tone="text-emerald-700" sub={`Margen ${fmtPct(pct(profit, revenue))}`} />
        <KpiCard label="Utilidad neta estimada" value={formatMoney(net)} tone={net >= 0 ? "text-emerald-700" : "text-red-700"} sub={`Margen neto ${fmtPct(pct(net, revenue))}`} />
        <KpiCard label="Mejor mes" value={bestMonth ? formatMoney(bestMonth.net) : "—"} sub={bestMonth ? `${bestMonth.label} (utilidad neta)` : "Sin datos"} />
      </div>
      <Card className="report-card">
        <CardHeader
          title="Tendencia"
          action={<Segmented value={view} options={[["profit", "Utilidad"], ["cash", "Cobrado vs ingresos"]] as const} onChange={setView} />}
        />
        <div className="p-4">
          {view === "profit" ? (
            <MoneyChart
              height={300}
              data={chart}
              series={[
                { key: "revenue", name: "Ingresos", color: "#1447E6" },
                { key: "cost", name: "Costo", color: "#94A3B8" },
                { key: "expenses", name: "Gastos", color: "#F59E0B" },
                { key: "net", name: "Utilidad neta", color: "#10B981", type: "line" },
              ]}
            />
          ) : (
            <MoneyChart
              height={300}
              data={chart}
              series={[
                { key: "revenue", name: "Ingresos (sin ISV)", color: "#1447E6" },
                { key: "collected", name: "Cobrado", color: "#8B5CF6" },
                { key: "profit", name: "Utilidad bruta", color: "#10B981", type: "line" },
              ]}
            />
          )}
        </div>
      </Card>
      <RichTable title="Detalle por mes" description="Ingresos por fecha de entrega o de venta; gastos por fecha del gasto; cobrado por fecha del pago." cols={cols} rows={rows} total={total} rowKey={(m) => m.key} />
      {data.core.missingLines > 0 && (
        <p className="text-xs text-amber-700">{data.core.missingLines} líneas sin costo registrado en estos 12 meses: la utilidad puede verse más alta de lo real.</p>
      )}
    </div>
  );
}
