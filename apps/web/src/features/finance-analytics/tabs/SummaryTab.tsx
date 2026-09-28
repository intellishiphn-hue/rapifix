import { useMemo } from "react";
import { ArrowRight, Lightbulb } from "lucide-react";
import { formatMoney, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type Expense, type Payment } from "@rapifix/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { toDate } from "@/lib/format";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { aggregateTypes, loadBalances, loadCore, loadExpenses, loadPayments, loadPendingExpenses, orderMargin, pct, type Core } from "../data";
import { buckets, effectiveEnd } from "../period";
import { Delta, fmtPct, KpiCard, MoneyChart, Note, ProfitWaterfall, RichTable, toReportTable, type Col } from "../components";
import { finKey, type FinTabProps } from "./common";

async function load(p: FinTabProps) {
  const { period, prev, refresh } = p;
  const [cur, old, pay, payPrev, exp, expPrev, balances, pending] = await Promise.all([
    loadCore(period.start, period.end, refresh),
    loadCore(prev.start, prev.end, refresh),
    loadPayments(period.start, period.end, refresh),
    loadPayments(prev.start, prev.end, refresh),
    loadExpenses(period.start, period.end, refresh),
    loadExpenses(prev.start, prev.end, refresh),
    loadBalances(refresh),
    loadPendingExpenses(refresh).catch(() => [] as Expense[]),
  ]);
  // Gastos fijos pendientes que vencen dentro del período (hasta hoy si el período no ha terminado)
  const from = period.start.getTime();
  const to = effectiveEnd(period).getTime();
  const pendingInPeriod = pending.filter((e) => {
    const t = toDate(e.dueDate ?? e.date)?.getTime() ?? 0;
    return t >= from && t < to;
  });
  return { cur, old, pay, payPrev, exp, expPrev, balances, pendingInPeriod };
}

interface Figures {
  revenue: number;
  orderRevenue: number;
  saleRevenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  expenses: number;
  /** gastos fijos pagados (generados desde Gastos fijos) */
  fixedPaid: number;
  variable: number;
  net: number;
  netMargin: number | null;
  collected: number;
  tax: number;
  ticket: number | null;
  orders: number;
  sales: number;
}

function figures(core: Core, payments: Payment[], expenses: Expense[]): Figures {
  const exp = expenses.reduce((a, e) => a + e.amount, 0);
  const fixedPaid = expenses.filter((e) => e.fixedCostId).reduce((a, e) => a + e.amount, 0);
  return {
    revenue: core.revenue,
    orderRevenue: core.orderRevenue,
    saleRevenue: core.saleRevenue,
    cost: core.cost,
    profit: core.profit,
    margin: pct(core.profit, core.revenue),
    expenses: exp,
    fixedPaid,
    variable: exp - fixedPaid,
    net: core.profit - exp,
    netMargin: pct(core.profit - exp, core.revenue),
    collected: payments.reduce((a, x) => a + x.amount, 0),
    tax: core.tax,
    ticket: core.orders.length ? Math.round(core.orderRevenue / core.orders.length) : null,
    orders: core.orders.length,
    sales: core.sales.length,
  };
}

interface PLRow {
  label: string;
  cur: number | null;
  old: number | null;
  isPct?: boolean;
  strong?: boolean;
}

export function SummaryTab(props: FinTabProps) {
  const { data, loading, error } = useLoader(() => load(props), finKey("summary", props));

  const r = useMemo(() => {
    if (!data) return null;
    const f = figures(data.cur, data.pay, data.exp);
    const o = figures(data.old, data.payPrev, data.expPrev);

    // Gráfico por día o por mes
    const b = buckets(props.period);
    const acc = new Map(b.list.map((x) => [x.key, { revenue: 0, profit: 0 }]));
    const add = (at: Date | null, revenue: number, profit: number) => {
      if (!at) return;
      const a = acc.get(b.keyOf(at));
      if (!a) return;
      a.revenue += revenue;
      a.profit += profit;
    };
    for (const x of data.cur.orders) add(x.at, x.revenue, x.profit);
    for (const x of data.cur.sales) add(x.at, x.revenue, x.profit);
    const chart = b.list.map((x) => ({ label: x.label, revenue: acc.get(x.key)?.revenue ?? 0, profit: acc.get(x.key)?.profit ?? 0 }));

    // Observaciones automáticas (solo reglas simples y verificables)
    const insights: string[] = [];
    if (f.revenue > 0 && o.revenue > 0) {
      const ch = ((f.revenue - o.revenue) / o.revenue) * 100;
      if (Math.abs(ch) >= 5) insights.push(`Los ingresos ${ch > 0 ? "subieron" : "bajaron"} ${fmtPct(Math.abs(ch))} frente al período anterior (${formatMoney(o.revenue)} a ${formatMoney(f.revenue)}).`);
    }
    if (f.margin !== null && o.margin !== null && Math.abs(f.margin - o.margin) >= 2) {
      insights.push(`El margen bruto ${f.margin > o.margin ? "subió" : "bajó"} de ${fmtPct(o.margin)} a ${fmtPct(f.margin)}.`);
    }
    if (f.revenue > 0 && f.net < 0) {
      insights.push(`Los gastos (${formatMoney(f.expenses)}) superaron la utilidad bruta (${formatMoney(f.profit)}): el período va con pérdida estimada de ${formatMoney(-f.net)}.`);
    }
    const types = aggregateTypes(data.cur.lines);
    const parts = types.find((t) => t.type === "part");
    const labor = types.find((t) => t.type === "labor");
    if (parts && labor && parts.revenue > 0 && labor.revenue > 0 && parts.margin !== null && labor.margin !== null) {
      insights.push(`Los repuestos dejan ${fmtPct(parts.margin)} de margen y la mano de obra ${fmtPct(labor.margin)}. La mano de obra representa el ${fmtPct(pct(labor.revenue, f.revenue))} de los ingresos.`);
    }
    if (f.collected > 0) {
      const byMethod = PAYMENT_METHODS.map((m) => ({ m, amount: data.pay.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0) })).sort((a, b2) => b2.amount - a.amount);
      const top = byMethod[0];
      if (top && top.amount > 0) insights.push(`El ${fmtPct(pct(top.amount, f.collected))} de lo cobrado entró en ${PAYMENT_METHOD_LABELS[top.m].toLowerCase()}.`);
    }
    const low = data.cur.orders.filter((x) => x.revenue > 0 && (orderMargin(x) ?? 100) < 15);
    if (low.length) insights.push(`${low.length} ${low.length === 1 ? "orden entregada dejó" : "órdenes entregadas dejaron"} un margen menor a 15 %. Revíselas en la pestaña "Rentabilidad por orden".`);
    if (data.balances.receivable > 0 && f.collected > 0 && data.balances.receivable >= f.collected * 0.5) {
      insights.push(`Hay ${formatMoney(data.balances.receivable)} pendientes de cobro a clientes, equivalente al ${fmtPct(pct(data.balances.receivable, f.collected))} de lo cobrado en el período.`);
    }

    const pl: PLRow[] = [
      { label: "Ingresos por órdenes entregadas", cur: f.orderRevenue, old: o.orderRevenue },
      { label: "Ingresos por ventas del POS", cur: f.saleRevenue, old: o.saleRevenue },
      { label: "Ingresos (ventas netas, sin ISV)", cur: f.revenue, old: o.revenue, strong: true },
      { label: "(−) Costo de ventas", cur: -f.cost, old: -o.cost },
      { label: "Utilidad bruta", cur: f.profit, old: o.profit, strong: true },
      { label: "Margen bruto", cur: f.margin, old: o.margin, isPct: true },
      { label: "(−) Gastos fijos pagados", cur: -f.fixedPaid, old: -o.fixedPaid },
      { label: "(−) Gastos variables", cur: -f.variable, old: -o.variable },
      { label: "Ganancia (utilidad neta estimada)", cur: f.net, old: o.net, strong: true },
      { label: "Margen neto", cur: f.netMargin, old: o.netMargin, isPct: true },
      { label: "Cobrado (dinero que entró)", cur: f.collected, old: o.collected },
      { label: "ISV cobrado (no es ingreso)", cur: f.tax, old: o.tax },
    ];
    const fmtV = (row: PLRow, v: number | null): ReportCell => (row.isPct ? fmtPct(v) : v);
    const plCols: Col<PLRow>[] = [
      { label: "Concepto", value: (x) => x.label, tone: (x) => (x.strong ? "font-semibold text-slate-900" : undefined) },
      { label: "Este período", kind: "money", value: (x) => fmtV(x, x.cur), tone: (x) => (x.strong ? "font-semibold" : undefined) },
      { label: "Período anterior", kind: "money", value: (x) => fmtV(x, x.old) },
      {
        label: "Variación",
        kind: "money",
        value: (x) => {
          if (x.cur === null || x.old === null) return "—";
          if (x.isPct) return `${x.cur - x.old >= 0 ? "+" : "−"}${fmtPct(Math.abs(x.cur - x.old)).replace(" %", " pts")}`;
          if (!x.old) return "—";
          const ch = ((x.cur - x.old) / Math.abs(x.old)) * 100;
          return `${ch >= 0 ? "+" : "−"}${fmtPct(Math.abs(ch))}`;
        },
      },
    ];
    return { f, o, chart, mode: b.mode, insights: insights.slice(0, 5), pl, plCols };
  }, [data, props.period]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const { f, o } = r;
  const plTable = toReportTable("Estado de resultados estimado", r.plCols, r.pl);
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Período anterior comparado", props.prev.label],
    ["Órdenes entregadas", f.orders, "number"],
    ["Ventas del POS", f.sales, "number"],
    ["Ticket promedio por orden (sin ISV)", f.ticket, "money"],
    ["Cuentas por cobrar (hoy)", data.balances.receivable, "money"],
    ["Cuentas por pagar (hoy)", data.balances.payable, "money"],
    ["Líneas sin costo registrado", data.cur.missingLines, "number"],
  ];
  const chartTable = {
    title: r.mode === "month" ? "Ingresos y utilidad por mes" : "Ingresos y utilidad por día",
    columns: [{ label: r.mode === "month" ? "Mes" : "Día" }, { label: "Ingresos", kind: "money" as const }, { label: "Utilidad bruta", kind: "money" as const }],
    rows: r.chart.filter((x) => x.revenue || x.profit).map((x) => [x.label, x.revenue, x.profit]),
  };
  const receivableDocs = data.balances.ordersDue.length + data.balances.salesDue.length;
  const pendingFixed = data.pendingInPeriod.reduce((a, e) => a + e.amount, 0);
  const missing = data.cur.missingLines;

  return (
    <div className="space-y-5">
      <TabHeader
        title="Resumen financiero"
        subtitle={`${props.period.label} · comparado con ${props.prev.label}`}
        actions={<TabActions title="Finanzas - Resumen" periodLabel={props.period.label} fileRange={props.fileRange} tables={[plTable, chartTable]} summary={summary} />}
      />

      <HowMuchWeEarned f={f} periodWord={props.periodKey === "month" || props.periodKey === "prevMonth" ? "del mes" : props.periodKey === "today" ? "de hoy" : "del período"} pendingFixed={pendingFixed} pendingCount={data.pendingInPeriod.length} onClosing={props.openTab ? () => props.openTab!("closing") : undefined} />

      {missing > 0 && (
        <Note tone="warn">
          <b>{missing} {missing === 1 ? "línea" : "líneas"} sin costo registrado</b>: la utilidad puede verse más alta de lo real.
          {data.cur.ordersWithoutQuote > 0 && ` Incluye ${data.cur.ordersWithoutQuote} orden(es) entregada(s) sin cotización aprobada.`} Registre el costo de los repuestos en inventario o en la cotización.
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ingresos (ventas netas)"
          value={formatMoney(f.revenue)}
          sub={`Órdenes ${formatMoney(f.orderRevenue)} · POS ${formatMoney(f.saleRevenue)}`}
          delta={<Delta current={f.revenue} previous={o.revenue} />}
          hint="Órdenes entregadas y ventas del POS del período, sin ISV."
        />
        <KpiCard
          label="Utilidad bruta"
          value={formatMoney(f.profit)}
          tone={f.profit >= 0 ? "text-emerald-700" : "text-red-700"}
          sub={`Margen ${fmtPct(f.margin)}${o.margin !== null ? ` (antes ${fmtPct(o.margin)})` : ""}`}
          delta={<Delta current={f.profit} previous={o.profit} />}
          hint={`Ingresos − costo de repuestos y servicios vendidos${data.cur.estimatedLines || missing ? " (costo estimado)" : ""}.`}
        />
        <KpiCard
          label="Gastos operativos"
          value={formatMoney(f.expenses)}
          sub={`Fijos ${formatMoney(f.fixedPaid)} · Variables ${formatMoney(f.variable)}`}
          tone="text-red-700"
          delta={<Delta current={f.expenses} previous={o.expenses} goodWhenUp={false} />}
          hint={pendingFixed > 0 ? `Pagados en el período. Faltan ${formatMoney(pendingFixed)} de gastos fijos por pagar.` : "Gastos pagados con fecha del período (alquiler, salarios, luz…)."}
        />
        <KpiCard
          label="Ganancia (utilidad neta)"
          value={formatMoney(f.net)}
          tone={f.net >= 0 ? "text-emerald-700" : "text-red-700"}
          sub={`Margen neto ${fmtPct(f.netMargin)}`}
          delta={<Delta current={f.net} previous={o.net} />}
          hint="Utilidad bruta − gastos. Es una estimación, no contabilidad formal."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Cobrado" value={formatMoney(f.collected)} tone="text-brand-700" delta={<Delta current={f.collected} previous={o.collected} />} hint="Dinero que entró (pagos válidos), incluye ISV y abonos de otros períodos." />
        <KpiCard label="ISV cobrado" value={formatMoney(f.tax)} delta={<Delta current={f.tax} previous={o.tax} goodWhenUp={false} label="vs anterior" />} hint="ISV de lo facturado. Se entrega al SAR: no es ingreso del taller." />
        <KpiCard label="Ticket promedio por orden" value={f.ticket === null ? "—" : formatMoney(f.ticket)} sub={`${f.orders} órdenes entregadas`} delta={<Delta current={f.ticket} previous={o.ticket} />} hint="Ingreso promedio por orden, sin ISV." />
        <KpiCard label="Cuentas por cobrar" value={formatMoney(data.balances.receivable)} tone="text-amber-700" sub={`${receivableDocs} documentos`} hint="Saldo pendiente de clientes al día de hoy." />
        <KpiCard label="Cuentas por pagar" value={formatMoney(data.balances.payable)} tone="text-amber-700" sub={`${data.balances.purchasesDue.length} compras`} hint="Saldo pendiente con proveedores al día de hoy." />
      </div>

      <Card className="report-card">
        <CardHeader title={chartTable.title} description="Ingresos sin ISV y utilidad bruta según la fecha de entrega o de venta." />
        <div className="p-4">
          {r.chart.length ? (
            <MoneyChart data={r.chart} series={[{ key: "revenue", name: "Ingresos", color: "#1447E6" }, { key: "profit", name: "Utilidad bruta", color: "#10B981" }]} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">Sin días en el período.</p>
          )}
        </div>
      </Card>

      <Card className="report-card">
        <CardHeader title={<span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" />Qué nos dicen los números</span>} />
        <div className="px-5 pb-5">
          {r.insights.length ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {r.insights.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Aún no hay suficientes datos en este período para sacar conclusiones.</p>
          )}
        </div>
      </Card>

      <RichTable title="Estado de resultados estimado" description={`Este período contra ${props.prev.label}`} cols={r.plCols} rows={r.pl} rowKey={(x) => x.label} />

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 print:hidden">
        <summary className="cursor-pointer font-semibold text-slate-800">¿Cómo se calculan estos números?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Ingresos</b>: órdenes entregadas en el período (según la cotización aprobada, sin ISV y con descuentos) más ventas del POS no anuladas.</li>
          <li><b>Costo de ventas</b>: costo registrado en cada línea de la cotización. Si un repuesto no tiene costo, se usa el costo con que salió del inventario y, si tampoco existe, el costo promedio actual del producto. En el POS se usa el costo de la salida de inventario de cada venta.</li>
          <li><b>Mano de obra</b>: si no tiene costo registrado cuenta como costo cero; los salarios se ven en Gastos.</li>
          <li><b>Utilidad neta estimada</b>: utilidad bruta menos gastos pagados en el período (fijos y variables). Los gastos fijos pendientes de pagar se indican aparte; en la pestaña "Cierre del mes" sí se restan. No incluye depreciación ni impuestos sobre la renta.</li>
          <li><b>Cobrado</b> es dinero que entró por fecha del pago; puede ser de órdenes de otros períodos. Por eso no coincide con los ingresos.</li>
          <li>La comparación es contra {props.prev.label} (la misma cantidad de días).</li>
        </ul>
      </details>
    </div>
  );
}

/** Bloque destacado: cuánto ganamos, en palabras sencillas y en cascada (vendimos → costo → gastos → ganancia). */
function HowMuchWeEarned({ f, periodWord, pendingFixed, pendingCount, onClosing }: { f: Figures; periodWord: string; pendingFixed: number; pendingCount: number; onClosing?: () => void }) {
  const netWithPending = f.net - pendingFixed;
  return (
    <Card className="report-card overflow-hidden border-emerald-200">
      <div className="flex flex-col gap-2 border-b border-slate-100 bg-emerald-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900">¿Cuánto ganamos?</h3>
          <p className="text-xs text-slate-600">De lo que vendimos, primero se resta lo que costó lo vendido y después los gastos del negocio. Lo que queda es la ganancia.</p>
        </div>
        {onClosing && (
          <Button size="sm" variant="secondary" className="shrink-0 print:hidden" icon={<ArrowRight className="h-4 w-4" />} onClick={onClosing}>Ver cierre del mes</Button>
        )}
      </div>
      <div className="grid divide-y divide-slate-100 border-b border-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-5">
          <div className="text-sm font-medium text-slate-500">Utilidad bruta</div>
          <div className={`tabular mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl ${f.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatMoney(f.profit)}</div>
          <p className="mt-1 text-sm text-slate-600">Lo que dejan las ventas después de pagar los repuestos y productos vendidos ({fmtPct(f.margin)} de lo vendido).</p>
        </div>
        <div className="p-5">
          <div className="text-sm font-medium text-slate-500">Ganancia {periodWord} (utilidad neta)</div>
          <div className={`tabular mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl ${f.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatMoney(f.net)}</div>
          <p className="mt-1 text-sm text-slate-600">Lo que realmente queda después de pagar también los gastos (alquiler, salarios, luz y demás). {fmtPct(f.netMargin)} de lo vendido.</p>
        </div>
      </div>
      <ProfitWaterfall
        steps={{ revenue: f.revenue, cost: f.cost, fixed: f.fixedPaid, variable: f.variable }}
        periodWord={periodWord}
        fixedHint="Alquiler, salarios, luz, internet que ya se pagaron en estas fechas."
        footer={pendingFixed > 0 ? (
          <span className="text-amber-900">
            Todavía faltan {formatMoney(pendingFixed)} de gastos fijos por pagar ({pendingCount}) de estas fechas. Cuando se paguen, la ganancia quedaría en <b className="tabular">{formatMoney(netWithPending)}</b>.
          </span>
        ) : undefined}
      />
    </Card>
  );
}
