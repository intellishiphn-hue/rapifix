import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Flag, Target, Wallet } from "lucide-react";
import { addMonths, formatMoney, hnDayKey, type Expense } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell, ReportTable } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { MonthSwitcher } from "@/features/finance/parts";
import { useEnsureFixedCostsGenerated } from "@/features/finance/PendingExpenses";
import { loadBudget, loadCore, loadExpenses, loadFixedExpenses, loadPayments, loadSupplierPayments, pct } from "../data";
import { monthLabel } from "../period";
import { averageFigures, breakEven, cashFlow, monthBounds, monthFigures, previousMonths, unitFigures } from "../closing";
import { fmtPct, KpiCard, Note, ProfitWaterfall } from "../components";
import type { FinTabProps } from "./common";

const thisMonth = () => hnDayKey(Date.now()).slice(0, 7);
const lower = (month: string) => monthLabel(month).split(" ")[0]!.toLowerCase();

async function load(month: string, refresh: number) {
  const months = [...previousMonths(month), month];
  const range = { start: monthBounds(months[0]!).start, end: monthBounds(month).end };
  const cur = monthBounds(month);
  const [core, validExpenses, fixedExpenses, payments, supplierPayments, budget] = await Promise.all([
    loadCore(range.start, range.end, refresh),
    loadExpenses(range.start, range.end, refresh),
    loadFixedExpenses(months, refresh),
    loadPayments(cur.start, cur.end, refresh),
    loadSupplierPayments(cur.start, cur.end, refresh),
    loadBudget(refresh).catch(() => ({}) as Record<string, number>),
  ]);
  return { months, core, validExpenses, fixedExpenses, payments, supplierPayments, budget };
}

type Fig = ReturnType<typeof averageFigures>;

interface PLRow {
  key: string;
  label: string;
  hint?: string;
  get: (f: Fig) => number | null;
  isPct?: boolean;
  level?: "section" | "strong" | "total";
  negative?: boolean;
  hideIfZero?: boolean;
}

const PL: PLRow[] = [
  { key: "h1", label: "Ingresos (sin ISV)", get: () => null, level: "section" },
  { key: "shop", label: "Taller (órdenes entregadas)", get: (f) => f.shopRevenue },
  { key: "counter", label: "Mostrador (ventas del POS)", get: (f) => f.counterRevenue },
  { key: "carwash", label: "Carwash", get: (f) => f.carwashRevenue, hideIfZero: true },
  { key: "revenue", label: "Total ingresos", get: (f) => f.revenue, level: "strong" },
  { key: "cost", label: "(−) Costo de lo vendido", hint: "Repuestos y productos que se vendieron", get: (f) => -f.cost, negative: true },
  { key: "gross", label: "Utilidad bruta", hint: "Lo que queda después de pagar lo vendido", get: (f) => f.gross, level: "strong" },
  { key: "grossM", label: "Margen bruto", get: (f) => f.grossMargin, isPct: true },
  { key: "fixed", label: "(−) Gastos fijos", hint: "Alquiler, salarios, servicios (pagados y pendientes)", get: (f) => -f.fixed, negative: true },
  { key: "variable", label: "(−) Gastos variables", hint: "Otros gastos pagados en el mes", get: (f) => -f.variable, negative: true },
  { key: "net", label: "Ganancia del mes (utilidad neta)", hint: "Lo que realmente le quedó al negocio", get: (f) => f.net, level: "total" },
  { key: "netM", label: "Margen neto", get: (f) => f.netMargin, isPct: true },
];

export function ClosingTab(props: FinTabProps) {
  const [month, setMonth] = useState(thisMonth());
  useEnsureFixedCostsGenerated();
  const { data, loading, error } = useLoader(() => load(month, props.refresh), `fin-closing|${month}|${props.refresh}`);

  const r = useMemo(() => {
    if (!data) return null;
    const figs = data.months.map((m) => monthFigures(data.core, m, data.fixedExpenses, data.validExpenses));
    const cur = figs[figs.length - 1]!;
    const prev = figs[figs.length - 2]!;
    const avg = averageFigures(figs.slice(0, -1));
    const be = breakEven(cur, thisMonth());
    const units = unitFigures(cur, data.fixedExpenses, data.validExpenses);
    const flow = cashFlow(month, data.payments, data.validExpenses, data.supplierPayments);

    // Gastos fijos del mes por categoría
    const fixedList = data.fixedExpenses.filter((e) => e.period === month).sort((a, b) => a.category.localeCompare(b.category, "es") || a.description.localeCompare(b.description, "es"));
    const fixedCats = groupBy(fixedList, (e) => e.category || "Otros").map(([category, items]) => ({
      category, items,
      paid: items.filter((e) => e.status === "valid").reduce((a, e) => a + e.amount, 0),
      pending: items.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount, 0),
    })).sort((a, b) => b.paid + b.pending - (a.paid + a.pending));

    // Gastos variables por categoría contra presupuesto
    const varList = data.validExpenses.filter((e) => !e.fixedCostId && e.date?.toMillis && hnDayKey(e.date.toMillis()).slice(0, 7) === month);
    const cats = new Set([...varList.map((e) => e.category || "Otros"), ...Object.keys(data.budget)]);
    const varCats = [...cats].map((category) => {
      const items = varList.filter((e) => (e.category || "Otros") === category);
      const amount = items.reduce((a, e) => a + e.amount, 0);
      const budget = data.budget[category] ?? 0;
      return { category, count: items.length, amount, budget, used: budget ? (amount / budget) * 100 : null };
    }).filter((x) => x.amount > 0 || x.budget > 0).sort((a, b) => b.amount - a.amount || b.budget - a.budget);
    const budgetTotal = Object.values(data.budget).reduce((a, v) => a + v, 0);

    return { figs, cur, prev, avg, be, units, flow, fixedCats, varCats, budgetTotal };
  }, [data, month]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;

  const { cur, prev, avg, be, units, flow } = r;
  const isCurrent = be.isCurrent;
  const mName = lower(month);
  const prevLabel = monthLabel(addMonths(month, -1));
  const avgLabel = "Promedio 3 meses anteriores";
  const rows = PL.filter((row) => !row.hideIfZero || [cur, prev, avg].some((f) => row.get(f)));

  // ---------- Conclusión automática (solo con datos reales) ----------
  const sentences: string[] = [];
  if (cur.revenue <= 0 && cur.fixed <= 0 && cur.variable <= 0) {
    sentences.push(`Todavía no hay ventas ni gastos registrados en ${mName}.`);
  } else {
    const won = cur.net >= 0;
    const share = cur.revenue > 0 ? ` (${fmtPct(Math.abs(cur.netMargin ?? 0))} de lo vendido)` : "";
    sentences.push(isCurrent
      ? `En lo que va de ${mName} ${won ? "llevan una utilidad de" : "van con una pérdida de"} ${formatMoney(Math.abs(cur.net))}${share}.`
      : `En ${mName} ${won ? "ganaron" : "perdieron"} ${formatMoney(Math.abs(cur.net))}${share}.`);
    if (cur.fixed > 0) {
      if (be.coveredDay) sentences.push(`Las ventas cubrieron los gastos fijos el día ${be.coveredDay}.`);
      else if (be.target !== null) {
        const missing = Math.max(0, be.target - cur.revenue);
        sentences.push(isCurrent
          ? `Faltan ${formatMoney(missing)} en ventas para cubrir los gastos fijos del mes.`
          : `Las ventas no alcanzaron a cubrir los gastos fijos: faltaron ${formatMoney(missing)}.`);
      } else if (cur.revenue > 0) sentences.push("Con el margen actual las ventas no alcanzan a cubrir los gastos fijos.");
    }
    if (isCurrent && be.projectedNet !== null) {
      sentences.push(`A este ritmo cerrarían el mes con ${be.projectedNet >= 0 ? "una utilidad" : "una pérdida"} estimada de ${formatMoney(Math.abs(be.projectedNet))}.`);
    }
  }

  // ---------- Excel ----------
  const fmtRow = (row: PLRow, f: Fig): ReportCell => {
    if (row.level === "section") return null;
    const v = row.get(f);
    return row.isPct ? fmtPct(v) : v;
  };
  const tables: ReportTable[] = [
    {
      title: `Estado de resultados de ${monthLabel(month)}`,
      columns: [{ label: "Concepto" }, { label: monthLabel(month), kind: "money" }, { label: prevLabel, kind: "money" }, { label: avgLabel, kind: "money" }],
      rows: rows.map((row) => [row.label, fmtRow(row, cur), fmtRow(row, prev), fmtRow(row, avg)]),
    },
    {
      title: "Gastos fijos del mes",
      columns: [{ label: "Categoría" }, { label: "Concepto" }, { label: "Vence" }, { label: "Estado" }, { label: "Monto", kind: "money" }],
      rows: r.fixedCats.flatMap((c) => c.items.map((e) => [c.category, e.description, formatDate(e.dueDate ?? e.date), e.status === "valid" ? "Pagado" : "Pendiente", e.amount])),
      total: ["Total", "", "", cur.fixedPending ? `Pendiente ${formatMoney(cur.fixedPending)}` : "Todo pagado", cur.fixed],
      empty: "Sin gastos fijos este mes.",
    },
    {
      title: "Gastos variables por categoría",
      columns: [{ label: "Categoría" }, { label: "Gastado", kind: "money" }, { label: "Presupuesto", kind: "money" }, { label: "% usado", kind: "percent" }],
      rows: r.varCats.map((x) => [x.category, x.amount, x.budget || null, x.used]),
      total: ["Total", cur.variable, r.budgetTotal || null, r.budgetTotal ? (cur.variable / r.budgetTotal) * 100 : null],
      empty: "Sin gastos variables este mes.",
    },
    {
      title: "Punto de equilibrio",
      columns: [{ label: "Concepto" }, { label: "Valor", kind: "money" }],
      rows: [
        ["Gastos fijos del mes", cur.fixed],
        ["Margen bruto", fmtPct(cur.grossMargin)],
        ["Ventas necesarias para cubrir los fijos", be.target],
        ["Ventas del mes", cur.revenue],
        ["Avance", be.progress === null ? "—" : fmtPct(be.progress)],
        ["Día en que se cubrieron los fijos", be.coveredDay ? `Día ${be.coveredDay}` : "No se cubrieron"],
        ...(be.projectedRevenue !== null ? [["Proyección de ventas a fin de mes", be.projectedRevenue] as ReportCell[], ["Proyección de utilidad neta", be.projectedNet] as ReportCell[]] : []),
      ],
    },
    ...(units.hasCarwash ? [{
      title: "Por negocio",
      columns: [{ label: "Negocio" }, { label: "Ingresos", kind: "money" as ColKind }, { label: "Costo", kind: "money" as ColKind }, { label: "Utilidad bruta", kind: "money" as ColKind }, { label: "Gastos propios", kind: "money" as ColKind }, { label: "Parte de gastos generales", kind: "money" as ColKind }, { label: "Utilidad neta", kind: "money" as ColKind }],
      rows: units.rows.map((u) => [u.label, u.revenue, u.cost, u.gross, u.fixedOwn + u.variableOwn, u.generalShare, u.net]),
    }] : []),
    {
      title: "Flujo de caja del mes",
      columns: [{ label: "Concepto" }, { label: "Monto", kind: "money" }],
      rows: [["Cobrado a clientes", flow.collected], ["(−) Gastos pagados", -flow.expensesPaid], ["(−) Pagos a proveedores", -flow.suppliersPaid], ["Flujo neto", flow.net]],
    },
  ];
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Conclusión", sentences.join(" ")],
    ["Ganancia del mes (utilidad neta)", cur.net, "money"],
    ["Utilidad bruta", cur.gross, "money"],
    ["Gastos fijos pendientes de pagar", cur.fixedPending, "money"],
  ];

  const progress = Math.min(100, Math.max(0, be.progress ?? 0));

  return (
    <div className="space-y-5">
      <TabHeader
        title={`Cierre del mes · ${monthLabel(month)}`}
        subtitle="Estado de resultados: cuánto se vendió, cuánto costó y cuánto quedó."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="print:hidden"><MonthSwitcher month={month} onChange={setMonth} /></div>
            <TabActions title="Cierre del mes" periodLabel={monthLabel(month)} fileRange={month} tables={tables} summary={summary} />
          </div>
        }
      />

      {isCurrent && (
        <Note>
          <b>Mes en curso</b>: van {be.daysElapsed} de {be.daysTotal} días. Los números cambian hasta que termine el mes.
        </Note>
      )}
      {cur.missingLines > 0 && (
        <Note tone="warn">{cur.missingLines} {cur.missingLines === 1 ? "línea vendida no tiene" : "líneas vendidas no tienen"} costo registrado: la utilidad puede verse más alta de lo real.</Note>
      )}
      {cur.fixed === 0 && (
        <Note tone="warn">
          No hay gastos fijos registrados para {mName}. Agregue alquiler, salarios y servicios en <Link to="/gastos-fijos" className="font-semibold underline">Gastos fijos</Link> para ver la utilidad real.
        </Note>
      )}

      {/* Conclusión */}
      <Card className={cn("report-card border-l-4 p-5", cur.net >= 0 ? "border-l-emerald-500" : "border-l-red-500")}>
        <div className="flex items-start gap-3">
          <Flag className={cn("mt-1 h-5 w-5 shrink-0", cur.net >= 0 ? "text-emerald-600" : "text-red-600")} />
          <p className="text-base font-medium leading-relaxed text-slate-800 sm:text-lg">{sentences.join(" ")}</p>
        </div>
      </Card>

      {/* Cascada: de lo vendido a la ganancia */}
      <Card className="report-card overflow-hidden">
        <CardHeader title="¿Cómo llegamos a la ganancia?" description="De lo que vendimos se resta lo que costó lo vendido y después los gastos del mes. Lo que queda es lo que ganó el negocio." />
        <div className="border-t border-slate-100">
          <ProfitWaterfall
            steps={{ revenue: cur.revenue, cost: cur.cost, fixed: cur.fixed, variable: cur.variable }}
            periodWord={isCurrent ? "del mes (hasta hoy)" : "del mes"}
            fixedHint={cur.fixedPending > 0
              ? `Alquiler, salarios, luz, internet de ${mName}. Incluye ${formatMoney(cur.fixedPending)} que todavía falta pagar.`
              : `Alquiler, salarios, luz, internet de ${mName}.`}
            footer={cur.fixedPending > 0 ? <span className="text-amber-900">Los gastos fijos pendientes igual se restan: es lo que cuesta el mes aunque el dinero todavía no haya salido.</span> : undefined}
          />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ganancia del mes (utilidad neta)" value={formatMoney(cur.net)} tone={cur.net >= 0 ? "text-emerald-700" : "text-red-700"} sub={`Margen neto ${fmtPct(cur.netMargin)}`}
          hint={cur.fixedPending > 0 ? `Incluye ${formatMoney(cur.fixedPending)} de gastos fijos pendientes de pagar.` : "Ingresos − costo − gastos fijos − gastos variables."} className="ring-2 ring-emerald-100" />
        <KpiCard label="Utilidad bruta" value={formatMoney(cur.gross)} tone={cur.gross >= 0 ? "text-emerald-700" : "text-red-700"} sub={`Margen bruto ${fmtPct(cur.grossMargin)}`} hint="Ventas menos lo que costaron los repuestos y productos vendidos." />
        <KpiCard label="Ingresos (sin ISV)" value={formatMoney(cur.revenue)} sub={`${cur.orders} órdenes · ${cur.sales} ventas`} hint={`Mes anterior: ${formatMoney(prev.revenue)}`} />
        <KpiCard label="Gastos del mes" value={formatMoney(cur.fixed + cur.variable)} tone="text-red-700" sub={`Fijos ${formatMoney(cur.fixed)} · Variables ${formatMoney(cur.variable)}`} hint={cur.fixedPending > 0 ? `Pendiente de pagar: ${formatMoney(cur.fixedPending)}` : "Todo lo fijo está pagado."} />
      </div>

      {/* Estado de resultados */}
      <Card className="report-card overflow-hidden">
        <CardHeader title="Estado de resultados" description={`${monthLabel(month)} comparado con ${prevLabel.toLowerCase()} y con el promedio de los 3 meses anteriores.`} />
        <div className="overflow-x-auto">
          <table className="report-table w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-medium">Concepto</th>
                <th className="px-4 py-2 text-right font-medium">{monthLabel(month)}</th>
                <th className="px-4 py-2 text-right font-medium">{prevLabel}</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell print:table-cell">Promedio 3 meses</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.level === "section") {
                  return <tr key={row.key}><td colSpan={4} className="bg-slate-50/40 px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</td></tr>;
                }
                const cell = (f: Fig) => {
                  const v = row.get(f);
                  if (row.isPct) return fmtPct(v);
                  return v === null ? "—" : formatMoney(v);
                };
                const tone = (f: Fig) => {
                  const v = row.get(f) ?? 0;
                  if (row.level === "total" || row.key === "gross") return v < 0 ? "text-red-700" : "text-emerald-700";
                  return row.negative ? "text-slate-600" : undefined;
                };
                return (
                  <tr key={row.key} className={cn("border-b border-slate-100", row.level === "total" && "bg-emerald-50/50", row.isPct && "text-xs text-slate-500")}>
                    <td className={cn("px-4 py-2", row.level ? "font-semibold text-slate-900" : "text-slate-700", row.level === "total" && "text-base")}>
                      {row.label}
                      {row.hint && <div className="text-[11px] font-normal text-slate-400">{row.hint}</div>}
                    </td>
                    <td className={cn("tabular px-4 py-2 text-right", row.level && "font-semibold", row.level === "total" && "text-base font-bold", tone(cur))}>{cell(cur)}</td>
                    <td className={cn("tabular px-4 py-2 text-right text-slate-600", row.level && "font-medium")}>{cell(prev)}</td>
                    <td className="tabular hidden px-4 py-2 text-right text-slate-500 sm:table-cell print:table-cell">{cell(avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {cur.fixedPending > 0 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-amber-800">La utilidad neta incluye {formatMoney(cur.fixedPending)} de gastos fijos pendientes de pagar (es lo que cuesta el mes aunque todavía no haya salido el dinero).</div>}
      </Card>

      {/* Punto de equilibrio */}
      <Card className="report-card">
        <CardHeader title={<span className="flex items-center gap-2"><Target className="h-4 w-4 text-brand-600" />Punto de equilibrio</span>} description="Cuánto hay que vender para pagar los gastos fijos del mes con el margen actual." />
        <div className="space-y-3 px-5 pb-5">
          {cur.fixed <= 0 ? (
            <p className="text-sm text-slate-500">Sin gastos fijos registrados en el mes.</p>
          ) : be.target === null ? (
            <p className="text-sm text-slate-600">Sin margen bruto positivo en el mes no se puede calcular. Revise precios y costos.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-700">Llevan <b className="tabular text-slate-900">{formatMoney(cur.revenue)}</b> de <b className="tabular text-slate-900">{formatMoney(be.target)}</b></span>
                <span className={cn("tabular text-lg font-bold", (be.progress ?? 0) >= 100 ? "text-emerald-700" : "text-amber-700")}>{fmtPct(be.progress)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className={cn("h-full rounded-full", (be.progress ?? 0) >= 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${progress}%` }} />
              </div>
              <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                <div>Gastos fijos: <b className="tabular">{formatMoney(cur.fixed)}</b></div>
                <div>Margen bruto: <b className="tabular">{fmtPct(cur.grossMargin)}</b></div>
                <div>{be.coveredDay ? <>Cubiertos el <b>día {be.coveredDay}</b></> : <>Faltan <b className="tabular">{formatMoney(Math.max(0, be.target - cur.revenue))}</b></>}</div>
              </div>
              {be.projectedRevenue !== null && (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  Proyección a fin de mes (al ritmo de {be.daysElapsed} días): ventas de <b className="tabular">{formatMoney(be.projectedRevenue)}</b>
                  {be.projectedRevenue >= be.target ? ", suficiente para cubrir los fijos" : `, faltarían ${formatMoney(be.target - be.projectedRevenue)} para cubrir los fijos`}.
                </p>
              )}
              <p className="text-[11px] text-slate-400">Cálculo: gastos fijos ÷ margen bruto %. Si el margen sube, se necesita vender menos.</p>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Gastos fijos */}
        <Card className="report-card">
          <CardHeader title="Gastos fijos del mes" description={`${formatMoney(cur.fixed)} · pagado ${formatMoney(cur.fixedPaid)}${cur.fixedPending ? ` · pendiente ${formatMoney(cur.fixedPending)}` : ""}`}
            action={<Link to="/gastos" className="text-sm font-medium text-brand-700 print:hidden">Pagar</Link>} />
          {!r.fixedCats.length ? <p className="px-5 pb-5 text-sm text-slate-500">Sin gastos fijos este mes.</p> : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {r.fixedCats.map((c) => (
                <li key={c.category}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-sm">
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180 print:hidden" />
                      <span className="flex-1 font-medium text-slate-800">{c.category}</span>
                      {c.pending > 0 && <Badge tone="amber">Pendiente {formatMoney(c.pending)}</Badge>}
                      <span className="tabular w-28 text-right font-semibold">{formatMoney(c.paid + c.pending)}</span>
                    </summary>
                    <ul className="bg-slate-50/60 pb-1">
                      {c.items.map((e) => <FixedLine key={e.id} e={e} />)}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Gastos variables */}
        <Card className="report-card">
          <CardHeader title="Gastos variables" description={r.budgetTotal ? `${formatMoney(cur.variable)} de ${formatMoney(r.budgetTotal)} presupuestados` : `${formatMoney(cur.variable)} · sin presupuesto definido`}
            action={<Link to="/gastos-fijos" className="text-sm font-medium text-brand-700 print:hidden">Presupuesto</Link>} />
          {!r.varCats.length ? <p className="px-5 pb-5 text-sm text-slate-500">Sin gastos variables este mes.</p> : (
            <ul className="space-y-3 border-t border-slate-100 px-5 py-4">
              {r.varCats.map((x) => {
                const over = x.budget > 0 && x.amount > x.budget;
                return (
                  <li key={x.category}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate text-slate-700">{x.category}</span>
                      <span className={cn("tabular shrink-0 font-medium", over && "text-red-700")}>
                        {formatMoney(x.amount)}{x.budget > 0 && <span className="font-normal text-slate-400"> / {formatMoney(x.budget)}</span>}
                      </span>
                    </div>
                    {x.budget > 0 && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-brand-500")} style={{ width: `${Math.min(100, x.used ?? 0)}%` }} />
                      </div>
                    )}
                    {over && <div className="mt-0.5 text-[11px] text-red-700">Se pasó {formatMoney(x.amount - x.budget)} del presupuesto</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Por negocio */}
      {units.hasCarwash && (
        <Card className="report-card overflow-hidden">
          <CardHeader title="Por negocio: Taller y Carwash" description="Los gastos generales (sin negocio asignado) se reparten según lo que vendió cada uno." />
          <div className="overflow-x-auto">
            <table className="report-table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 text-left font-medium">Concepto</th>
                  {units.rows.map((u) => <th key={u.unit} className="px-4 py-2 text-right font-medium">{u.unit === "shop" ? "Taller" : "Carwash"}</th>)}
                </tr>
              </thead>
              <tbody>
                {([
                  ["Ingresos", (u) => u.revenue],
                  ["(−) Costo de lo vendido", (u) => -u.cost],
                  ["Utilidad bruta", (u) => u.gross, true],
                  ["(−) Gastos propios (fijos y variables)", (u) => -(u.fixedOwn + u.variableOwn)],
                  [`(−) Parte de gastos generales (${formatMoney(units.general)})`, (u) => -u.generalShare],
                  ["Utilidad neta", (u) => u.net, true],
                ] as Array<[string, (u: (typeof units.rows)[number]) => number, boolean?]>).map(([label, get, strong]) => (
                  <tr key={label} className="border-b border-slate-100">
                    <td className={cn("px-4 py-2", strong ? "font-semibold text-slate-900" : "text-slate-700")}>{label}</td>
                    {units.rows.map((u) => <td key={u.unit} className={cn("tabular px-4 py-2 text-right", strong && "font-semibold", strong && (get(u) < 0 ? "text-red-700" : "text-emerald-700"))}>{formatMoney(get(u))}</td>)}
                  </tr>
                ))}
                <tr className="text-xs text-slate-500">
                  <td className="px-4 py-2">Margen neto</td>
                  {units.rows.map((u) => <td key={u.unit} className="tabular px-4 py-2 text-right">{fmtPct(pct(u.net, u.revenue))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Flujo de caja */}
      <Card className="report-card">
        <CardHeader title={<span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" />Flujo de caja del mes</span>} description="Dinero que entró y salió. No es lo mismo que la utilidad: incluye ISV, abonos de otros meses y compras de inventario." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-4">
          <FlowItem label="Cobrado a clientes" value={flow.collected} tone="text-brand-700" />
          <FlowItem label="(−) Gastos pagados" value={-flow.expensesPaid} />
          <FlowItem label="(−) Pagos a proveedores" value={-flow.suppliersPaid} />
          <FlowItem label="Flujo neto" value={flow.net} tone={flow.net >= 0 ? "text-emerald-700" : "text-red-700"} strong />
        </div>
      </Card>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 print:hidden">
        <summary className="cursor-pointer font-semibold text-slate-800">¿Cómo se calcula el cierre?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Ingresos</b>: órdenes entregadas en el mes y ventas del POS no anuladas, sin ISV. Las ventas del carwash se separan.</li>
          <li><b>Costo de lo vendido</b>: costo de los repuestos y productos vendidos (el mismo cálculo de la pestaña Resumen).</li>
          <li><b>Gastos fijos</b>: los generados desde Gastos fijos para este mes, pagados o pendientes. Los que marcó como "no aplica" no cuentan.</li>
          <li><b>Gastos variables</b>: los demás gastos pagados con fecha del mes.</li>
          <li><b>Utilidad neta</b> = ingresos − costo − gastos fijos − gastos variables. No incluye depreciación ni impuesto sobre la renta.</li>
          <li><b>Por negocio</b>: cada gasto con negocio asignado va a ese negocio; los gastos generales se reparten según las ventas de cada uno.</li>
          <li>Las compras de inventario no son gasto: se vuelven costo cuando el repuesto se vende. Sí aparecen en el flujo de caja cuando se pagan.</li>
        </ul>
      </details>
    </div>
  );
}

function FixedLine({ e }: { e: Expense }) {
  const paid = e.status === "valid";
  return (
    <li className="flex items-center gap-2 px-5 py-1.5 pl-11 text-xs">
      <span className="min-w-0 flex-1 truncate text-slate-700">{e.description}{e.employeeName && !e.description.includes(e.employeeName) ? ` · ${e.employeeName}` : ""}</span>
      <span className={cn("shrink-0 font-medium", paid ? "text-emerald-700" : "text-amber-700")}>{paid ? `Pagado ${formatDate(e.date)}` : `Pendiente · vence ${formatDate(e.dueDate ?? e.date)}`}</span>
      <span className="tabular w-24 shrink-0 text-right font-medium">{formatMoney(e.amount)}</span>
    </li>
  );
}

function FlowItem({ label, value, tone, strong }: { label: string; value: number; tone?: string; strong?: boolean }): ReactNode {
  return (
    <div className={cn("rounded-xl border border-slate-100 p-3", strong && "bg-slate-50")}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("tabular mt-0.5 text-lg font-semibold", strong && "font-bold", tone)}>{formatMoney(value)}</div>
    </div>
  );
}

function groupBy<T>(list: T[], key: (x: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  list.forEach((x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]));
  return [...m.entries()];
}

