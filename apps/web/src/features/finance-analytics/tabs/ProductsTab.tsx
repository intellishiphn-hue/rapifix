import { useMemo, useState } from "react";
import { formatMoney, type QuoteItemType } from "@rapifix/shared";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { aggregateItems, aggregateTypes, loadCore, pct, typeLabel, type ItemAgg, type TypeAgg } from "../data";
import { fmtPct, KpiCard, marginTone, Note, RichTable, Segmented, toReportTable, type Col } from "../components";
import { finKey, type FinTabProps } from "./common";

type SortBy = "revenue" | "profit" | "qty" | "margin";
type TypeFilter = "all" | QuoteItemType;

const SORTS: ReadonlyArray<readonly [SortBy, string]> = [["revenue", "Ingresos"], ["profit", "Utilidad"], ["qty", "Cantidad"], ["margin", "Margen"]];
const TYPES: ReadonlyArray<readonly [TypeFilter, string]> = [["all", "Todo"], ["labor", "Mano de obra"], ["part", "Repuestos"], ["service", "Servicios"], ["other", "Otros"]];

export function ProductsTab(props: FinTabProps) {
  const { data, loading, error } = useLoader(() => loadCore(props.period.start, props.period.end, props.refresh), finKey("products", props));
  const [sortBy, setSortBy] = useState<SortBy>("revenue");
  const [type, setType] = useState<TypeFilter>("all");

  const r = useMemo(() => {
    if (!data) return null;
    const items = aggregateItems(data.lines);
    const types = aggregateTypes(data.lines);
    return { items, types };
  }, [data]);

  const rows = useMemo(() => {
    if (!r) return [];
    const list = r.items.filter((x) => type === "all" || x.type === type);
    const by: Record<SortBy, (a: ItemAgg, b: ItemAgg) => number> = {
      revenue: (a, b) => b.revenue - a.revenue,
      profit: (a, b) => b.profit - a.profit,
      qty: (a, b) => b.qty - a.qty || b.revenue - a.revenue,
      margin: (a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity) || b.revenue - a.revenue,
    };
    return [...list].sort(by[sortBy]);
  }, [r, sortBy, type]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;

  const total = data.revenue;
  const itemCols: Col<ItemAgg>[] = [
    { label: "Producto / servicio", value: (x) => (x.missing ? `${x.name} *` : x.estimated ? `${x.name} (costo aprox.)` : x.name) },
    { label: "Tipo", value: (x) => typeLabel(x.type) },
    { label: "Cantidad", kind: "number", value: (x) => x.qty },
    { label: "Ingresos", kind: "money", value: (x) => x.revenue },
    { label: "Costo", kind: "money", value: (x) => x.cost, tone: (x) => (x.missing ? "text-amber-700" : undefined) },
    { label: "Utilidad", kind: "money", value: (x) => x.profit },
    { label: "Margen", kind: "percent", value: (x) => x.margin, tone: (x) => marginTone(x.margin) },
  ];
  const sum = (f: (x: ItemAgg) => number) => rows.reduce((a, x) => a + f(x), 0);
  const itemTotal: ReportCell[] = ["Total", "", null, sum((x) => x.revenue), sum((x) => x.cost), sum((x) => x.profit), pct(sum((x) => x.profit), sum((x) => x.revenue))];

  const typeCols: Col<TypeAgg>[] = [
    { label: "Tipo", value: (x) => typeLabel(x.type) },
    { label: "Ingresos", kind: "money", value: (x) => x.revenue },
    { label: "% de ingresos", kind: "percent", value: (x) => pct(x.revenue, total) },
    { label: "Costo", kind: "money", value: (x) => x.cost },
    { label: "Utilidad", kind: "money", value: (x) => x.profit },
    { label: "% de la utilidad", kind: "percent", value: (x) => pct(x.profit, data.profit) },
    { label: "Margen", kind: "percent", value: (x) => x.margin, tone: (x) => marginTone(x.margin) },
  ];
  const typeRows = r.types.filter((t) => t.revenue !== 0 || t.cost !== 0);
  const typeTotal: ReportCell[] = ["Total", data.revenue, data.revenue ? 100 : null, data.cost, data.profit, data.profit ? 100 : null, pct(data.profit, data.revenue)];

  const best = [...r.items].filter((x) => x.revenue > 0).sort((a, b) => b.profit - a.profit)[0];
  const top = [...r.items].sort((a, b) => b.revenue - a.revenue)[0];
  const lowMargin = r.items.filter((x) => x.revenue > 0 && x.margin !== null && x.margin < 20);
  const sortLabel = SORTS.find((s) => s[0] === sortBy)?.[1] ?? "";
  const typeName = TYPES.find((s) => s[0] === type)?.[1] ?? "";

  const tables = [
    toReportTable("Resumen por tipo", typeCols, typeRows, typeTotal),
    toReportTable(`Ranking de productos y servicios (${typeName}, por ${sortLabel.toLowerCase()})`, itemCols, rows, itemTotal),
  ];
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Órdenes entregadas analizadas", data.orders.length, "number"],
    ["Ventas del POS analizadas", data.sales.length, "number"],
    ["Ingresos (sin ISV)", data.revenue, "money"],
    ["Utilidad bruta", data.profit, "money"],
    ["Margen bruto", pct(data.profit, data.revenue), "percent"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Productos y servicios"
        subtitle={`${props.period.label} · órdenes entregadas y ventas del POS`}
        actions={<TabActions title="Finanzas - Productos" periodLabel={props.period.label} fileRange={props.fileRange} tables={tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Lo más vendido" value={top ? formatMoney(top.revenue) : "—"} sub={top?.name ?? "Sin ventas"} hint="Mayor ingreso en el período." />
        <KpiCard label="Lo más rentable" value={best ? formatMoney(best.profit) : "—"} tone="text-emerald-700" sub={best ? `${best.name} · margen ${fmtPct(best.margin)}` : "Sin ventas"} hint="Mayor utilidad en lempiras." />
        <KpiCard label="Productos/servicios distintos" value={r.items.length} sub={`${data.lines.length} líneas vendidas`} />
        <KpiCard label="Con margen menor a 20 %" value={lowMargin.length} tone={lowMargin.length ? "text-amber-700" : "text-slate-900"} hint="Revise precios o costos de estos artículos." />
      </div>

      {data.missingLines > 0 && (
        <Note tone="warn">
          {data.missingLines} {data.missingLines === 1 ? "línea" : "líneas"} sin costo registrado (marcadas con *): la utilidad puede verse más alta de lo real.
        </Note>
      )}

      <RichTable
        title="Resumen por tipo"
        description="Cuánto aporta cada tipo de trabajo a los ingresos y a la utilidad."
        cols={typeCols}
        rows={typeRows}
        total={typeTotal}
        rowKey={(x) => x.type}
        empty="No hay ventas en este período."
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <Segmented label="Ordenar por:" value={sortBy} options={SORTS} onChange={setSortBy} />
        <Segmented label="Mostrar:" value={type} options={TYPES} onChange={setType} />
      </div>
      <RichTable
        title="Ranking de productos y servicios"
        description="Agrupado por artículo del catálogo (o por descripción si no viene del catálogo). Margen menor a 20 % en ámbar."
        cols={itemCols}
        rows={rows}
        total={itemTotal}
        maxRows={30}
        rowKey={(x) => x.key}
        empty="No hay ventas de este tipo en el período."
      />
      <p className="text-xs text-slate-500">
        Montos sin ISV y con descuentos. La mano de obra y los servicios sin costo registrado cuentan con costo cero (los salarios están en Gastos).
        "Costo aprox." indica que se usó el costo promedio actual del repuesto porque no se guardó el costo al venderlo.
      </p>
    </div>
  );
}
