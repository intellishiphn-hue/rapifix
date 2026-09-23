import { useMemo } from "react";
import { catalogCol, formatMoney, type Product, type ProductCost } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { fetchAll, useLoader } from "../data";
import type { ColKind, ReportCell, ReportColumn, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

async function load(withCosts: boolean) {
  const [products, costs] = await Promise.all([
    fetchAll<Product>(catalogCol.products(TENANT_ID)),
    withCosts ? fetchAll<ProductCost & { id: string }>(catalogCol.productCosts(TENANT_ID)) : Promise.resolve([] as Array<ProductCost & { id: string }>),
  ]);
  return { products: products.filter((p) => p.active !== false), costs: new Map(costs.map((c) => [c.id, c.avgCost || c.cost || 0])) };
}

export function InventoryTab(props: TabProps) {
  const { role } = useAuth();
  const withCosts = role === "admin" || role === "manager" || role === "warehouse";
  // El inventario es una foto del momento: solo depende de Actualizar
  const { data, loading, error } = useLoader(() => load(withCosts), loaderKey("inventory", { ...props, period: { start: new Date(0), end: new Date(0), label: "" } }, String(withCosts)));

  const r = useMemo(() => {
    if (!data) return null;
    const { products, costs } = data;
    let units = 0, atCost = 0, atPrice = 0;
    const cats = new Map<string, { count: number; units: number; cost: number; price: number }>();
    for (const p of products) {
      const stock = Math.max(0, p.stock || 0);
      const c = Math.round(stock * (costs.get(p.id) ?? 0));
      const v = Math.round(stock * (p.price || 0));
      units += stock;
      atCost += c;
      atPrice += v;
      const key = p.category || "Sin categoría";
      const a = cats.get(key) ?? { count: 0, units: 0, cost: 0, price: 0 };
      a.count++;
      a.units += stock;
      a.cost += c;
      a.price += v;
      cats.set(key, a);
    }
    const low = products.filter((p) => p.minStock > 0 && p.stock <= p.minStock).sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock));
    const tLow: ReportTable = {
      title: "Productos en o bajo el mínimo",
      columns: [{ label: "Producto" }, { label: "SKU" }, { label: "Ubicación" }, { label: "Existencia", kind: "number" }, { label: "Mínimo", kind: "number" }, { label: "Faltante", kind: "number" }, { label: "Proveedor" }],
      rows: low.map((p) => [p.name, p.sku || "", p.location || "", p.stock, p.minStock, Math.max(0, p.minStock - p.stock), p.supplier || ""]),
      empty: "Ningún producto está bajo el mínimo.",
    };
    const catCols: ReportColumn[] = [
      { label: "Categoría" }, { label: "Productos", kind: "number" }, { label: "Unidades", kind: "number" },
      ...(withCosts ? [{ label: "Valor a costo promedio", kind: "money" as const }] : []),
      { label: "Valor a precio de venta", kind: "money" },
    ];
    const tCats: ReportTable = {
      title: "Valor del inventario por categoría",
      columns: catCols,
      rows: [...cats.entries()].sort((a, b) => b[1].price - a[1].price).map(([k, a]) => [k, a.count, a.units, ...(withCosts ? [a.cost] : []), a.price]),
      total: ["Total", products.length, units, ...(withCosts ? [atCost] : []), atPrice],
      empty: "No hay productos activos.",
    };
    return { units, atCost, atPrice, low, tables: [tLow, tCats] };
  }, [data, withCosts]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [tLow, tCats] = r.tables as [ReportTable, ReportTable];
  const now = new Intl.DateTimeFormat("es-HN", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tegucigalpa" }).format(new Date());
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Productos activos", data.products.length, "number"],
    ["Unidades en existencia", r.units, "number"],
    ["Productos bajo el mínimo", r.low.length, "number"],
  ];
  if (withCosts) summary.push(["Valor a costo promedio", r.atCost, "money"]);
  summary.push(["Valor a precio de venta", r.atPrice, "money"]);

  return (
    <div className="space-y-5">
      <TabHeader
        title="Inventario"
        subtitle={`Existencias al ${now} (no depende del período)`}
        actions={<TabActions title="Inventario" periodLabel={`Al ${now}`} fileRange={now.replace(/[^\dA-Za-z]+/g, "-")} tables={r.tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Productos activos" value={data.products.length} hint={`${new Intl.NumberFormat("es-HN").format(r.units)} unidades`} />
        <StatCard label="Bajo el mínimo" value={r.low.length} tone={r.low.length ? "text-red-700" : "text-slate-900"} />
        {withCosts && <StatCard label="Valor a costo promedio" value={formatMoney(r.atCost)} />}
        <StatCard label="Valor a precio de venta" value={formatMoney(r.atPrice)} tone="text-emerald-700" />
      </div>
      <DataTable table={tLow} maxRows={20} />
      <DataTable table={tCats} />
    </div>
  );
}
