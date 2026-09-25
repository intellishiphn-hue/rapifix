import { useMemo, useState } from "react";
import { catalogCol, formatMoney, normalizeText, orderCol, QUOTE_ITEM_LABELS, type ProductCost, type Sale, type WorkOrder } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { fetchAll, fetchApprovedQuotes, fetchRange, useLoader } from "../data";
import type { ColKind, ReportCell, ReportColumn, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

async function load(p: TabProps, withCosts: boolean, withSales: boolean) {
  const { start, end } = p.period;
  const [delivered, sales, costs] = await Promise.all([
    fetchRange<WorkOrder>(orderCol.workOrders(TENANT_ID), "deliveredAt", start, end).then((l) => l.filter((o) => o.status === "DELIVERED")),
    withSales ? fetchRange<Sale>(catalogCol.sales(TENANT_ID), "at", start, end).then((l) => l.filter((x) => x.status !== "voided")) : Promise.resolve([] as Sale[]),
    withCosts ? fetchAll<ProductCost & { id: string }>(catalogCol.productCosts(TENANT_ID)) : Promise.resolve([] as Array<ProductCost & { id: string }>),
  ]);
  const quotes = await fetchApprovedQuotes(delivered);
  return { delivered, quotes, sales, costs: new Map(costs.map((c) => [c.id, c.avgCost || c.cost || 0])) };
}

interface Agg {
  name: string;
  kind: string;
  qty: number;
  qtyOrders: number;
  qtyPos: number;
  revenue: number;
  cost: number;
  /** alguna línea sin costo registrado */
  missingCost: boolean;
}

type SortBy = "revenue" | "qty";

export function ServicesTab(props: TabProps) {
  const { role, can } = useAuth();
  const showCosts = role === "admin" || role === "manager";
  const withSales = can("payments.read");
  const [sortBy, setSortBy] = useState<SortBy>("revenue");
  const { data, loading, error } = useLoader(() => load(props, showCosts, withSales), loaderKey("services", props, `${showCosts}${withSales}`));

  const r = useMemo(() => {
    if (!data) return null;
    const services = new Map<string, Agg>();
    const parts = new Map<string, Agg>();
    const add = (map: Map<string, Agg>, key: string, name: string, kind: string, qty: number, revenue: number, cost: number | null, pos: boolean) => {
      let a = map.get(key);
      if (!a) {
        a = { name, kind, qty: 0, qtyOrders: 0, qtyPos: 0, revenue: 0, cost: 0, missingCost: false };
        map.set(key, a);
      }
      a.qty += qty;
      if (pos) a.qtyPos += qty;
      else a.qtyOrders += qty;
      a.revenue += revenue;
      if (cost === null) a.missingCost = true;
      else a.cost += Math.round(cost * qty);
    };

    for (const o of data.delivered) {
      const q = data.quotes.get(o.id);
      for (const it of q?.items ?? []) {
        const isPart = it.type === "part";
        const key = isPart ? `p:${it.productId || normalizeText(it.description)}` : `s:${it.serviceId || `${it.type}:${normalizeText(it.description)}`}`;
        const cost = isPart ? (it.unitCost || data.costs.get(it.productId ?? "") || null) : it.unitCost || 0;
        add(isPart ? parts : services, key, it.description, QUOTE_ITEM_LABELS[it.type], it.qty, it.lineTotal, cost, false);
      }
    }
    for (const s of data.sales) {
      for (const it of s.items) {
        const isPart = it.kind === "product";
        const key = isPart ? `p:${it.refId || normalizeText(it.description)}` : `s:${it.refId || `${it.kind}:${normalizeText(it.description)}`}`;
        const cost = isPart ? (data.costs.get(it.refId ?? "") ?? null) : 0;
        add(isPart ? parts : services, key, it.description, isPart ? "Repuesto" : it.kind === "service" ? "Servicio" : "Otro cargo", it.qty, it.lineTotal, cost, true);
      }
    }

    const sorter = (a: Agg, b: Agg) => (sortBy === "qty" ? b.qty - a.qty || b.revenue - a.revenue : b.revenue - a.revenue || b.qty - a.qty);
    const cols = (first: string): ReportColumn[] => [
      { label: first }, { label: "Tipo" }, { label: "Cantidad", kind: "number" }, { label: "En órdenes", kind: "number" }, { label: "En POS", kind: "number" }, { label: "Ingreso", kind: "money" },
      ...(showCosts ? [{ label: "Costo", kind: "money" as const }, { label: "Margen", kind: "money" as const }, { label: "Margen %", kind: "percent" as const }] : []),
    ];
    const row = (a: Agg): ReportCell[] => [
      a.missingCost && showCosts ? `${a.name} *` : a.name, a.kind, a.qty, a.qtyOrders, a.qtyPos, a.revenue,
      ...(showCosts ? [a.cost, a.revenue - a.cost, a.revenue ? ((a.revenue - a.cost) / a.revenue) * 100 : null] : []),
    ];
    const totalRow = (list: Agg[]): ReportCell[] => {
      const rev = list.reduce((x, a) => x + a.revenue, 0);
      const cost = list.reduce((x, a) => x + a.cost, 0);
      return ["Total", "", list.reduce((x, a) => x + a.qty, 0), null, null, rev, ...(showCosts ? [cost, rev - cost, rev ? ((rev - cost) / rev) * 100 : null] : [])];
    };
    const sList = [...services.values()].sort(sorter);
    const pList = [...parts.values()].sort(sorter);
    const tServices: ReportTable = { title: "Servicios y mano de obra", columns: cols("Servicio / trabajo"), rows: sList.map(row), total: totalRow(sList), empty: "No hay servicios facturados en el período." };
    const tParts: ReportTable = { title: "Repuestos", columns: cols("Repuesto"), rows: pList.map(row), total: totalRow(pList), empty: "No hay repuestos facturados en el período." };
    const sRev = sList.reduce((x, a) => x + a.revenue, 0);
    const pRev = pList.reduce((x, a) => x + a.revenue, 0);
    const pCost = pList.reduce((x, a) => x + a.cost, 0);
    const sCost = sList.reduce((x, a) => x + a.cost, 0);
    const missing = [...sList, ...pList].some((a) => a.missingCost);
    return { tables: [tServices, tParts], sRev, pRev, margin: sRev + pRev - sCost - pCost, missing };
  }, [data, sortBy, showCosts]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [tServices, tParts] = r.tables as [ReportTable, ReportTable];
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Órdenes entregadas analizadas", data.delivered.length, "number"],
    ["Ventas del POS analizadas", data.sales.length, "number"],
    ["Ingreso por servicios y mano de obra", r.sRev, "money"],
    ["Ingreso por repuestos", r.pRev, "money"],
  ];
  if (showCosts) summary.push(["Margen estimado", r.margin, "money"]);
  const withoutQuote = data.delivered.filter((o) => !data.quotes.has(o.id)).length;

  return (
    <div className="space-y-5">
      <TabHeader
        title="Servicios y repuestos"
        subtitle={`${props.period.label} · órdenes entregadas${withSales ? " y ventas del POS" : ""}`}
        actions={<TabActions title="Servicios y repuestos" periodLabel={props.period.label} fileRange={props.fileRange} tables={r.tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Servicios y mano de obra" value={formatMoney(r.sRev)} />
        <StatCard label="Repuestos" value={formatMoney(r.pRev)} />
        <StatCard label="Órdenes / ventas analizadas" value={`${data.delivered.length} / ${data.sales.length}`} hint={withoutQuote ? `${withoutQuote} orden(es) sin cotización aprobada` : undefined} />
        {showCosts && <StatCard label="Margen estimado" value={formatMoney(r.margin)} tone={r.margin >= 0 ? "text-emerald-700" : "text-red-700"} hint="Ingreso − costo registrado" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
        <span className="text-slate-500">Ordenar por:</span>
        <div className="flex rounded-[10px] bg-slate-200/70 p-1">
          {([["revenue", "Ingreso"], ["qty", "Cantidad"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSortBy(k)} className={cn("rounded-lg px-3 py-1 text-sm font-medium", sortBy === k ? "bg-white shadow-sm" : "text-slate-600")}>{l}</button>
          ))}
        </div>
      </div>
      <DataTable table={tServices} maxRows={15} />
      <DataTable table={tParts} maxRows={15} />
      <p className="text-xs text-slate-500">
        Montos sin ISV y con descuentos aplicados. Se toman las cotizaciones aprobadas de las órdenes entregadas en el período{withSales ? " y las ventas del punto de venta" : ""}.
        {showCosts && " El margen es estimado: usa el costo guardado en la cotización o el costo promedio del repuesto; la mano de obra sin costo registrado cuenta como margen completo."}
        {showCosts && r.missing && " (*) Algunas líneas no tienen costo registrado."}
      </p>
    </div>
  );
}
