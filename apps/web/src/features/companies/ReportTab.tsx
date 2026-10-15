import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  deliveredMs, formatMoney, hnDayKey, orderBalance, orderTotal, WORK_TYPE_LABELS,
  type Company, type Payment, type Sale, type WorkOrder, type WorkType,
} from "@rapifix/shared";
import { formatPlate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { DonutChart, KpiCard, MoneyChart, PALETTE, RichTable, Segmented, type Col } from "@/features/finance-analytics/components";
import { hnDate, hnParts } from "@/features/reports/period";

type RangeKey = "month" | "prevMonth" | "q" | "year" | "12m";
const RANGES: ReadonlyArray<readonly [RangeKey, string]> = [
  ["month", "Este mes"], ["prevMonth", "Mes anterior"], ["q", "Últimos 3 meses"], ["year", "Este año"], ["12m", "Últimos 12 meses"],
];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function range(key: RangeKey): { start: number; end: number; label: string } {
  const p = hnParts();
  const fmt = (y: number, m: number) => `${MONTHS[(m - 1 + 12) % 12]} ${y}`;
  switch (key) {
    case "month": return { start: hnDate(p.y, p.m, 1).getTime(), end: hnDate(p.y, p.m + 1, 1).getTime(), label: fmt(p.y, p.m) };
    case "prevMonth": {
      const s = hnDate(p.y, p.m - 1, 1);
      const k = hnDayKey(s).split("-").map(Number) as [number, number];
      return { start: s.getTime(), end: hnDate(p.y, p.m, 1).getTime(), label: fmt(k[0], k[1]) };
    }
    case "q": return { start: hnDate(p.y, p.m - 2, 1).getTime(), end: hnDate(p.y, p.m + 1, 1).getTime(), label: "Últimos 3 meses" };
    case "year": return { start: hnDate(p.y, 1, 1).getTime(), end: hnDate(p.y + 1, 1, 1).getTime(), label: `Año ${p.y}` };
    case "12m": return { start: hnDate(p.y, p.m - 11, 1).getTime(), end: hnDate(p.y, p.m + 1, 1).getTime(), label: "Últimos 12 meses" };
  }
}

interface VehicleAgg { key: string; plate: string; label: string; visits: number; billed: number; balance: number }

/** Pestaña Reporte: lo facturado y cobrado a la empresa, gasto por vehículo, tipos de trabajo y meses. */
export function ReportTab({ company, orders, receipts, sales, loading, error }: { company: Company; orders: WorkOrder[]; receipts: Payment[]; sales: Sale[]; loading: boolean; error: string | null }) {
  const [key, setKey] = useState<RangeKey>("12m");
  const r = useMemo(() => range(key), [key]);

  const data = useMemo(() => {
    const delivered = orders
      .filter((o) => o.status === "DELIVERED")
      .map((o) => ({ o, at: deliveredMs(o) ?? 0 }))
      .filter((x) => x.at >= r.start && x.at < r.end);
    const pays = receipts.filter((p) => p.status === "valid" && (p.at?.toMillis?.() ?? 0) >= r.start && (p.at?.toMillis?.() ?? 0) < r.end);
    const wash = sales.filter((s) => s.status !== "voided" && (s.at?.toMillis?.() ?? 0) >= r.start && (s.at?.toMillis?.() ?? 0) < r.end);
    const billed = delivered.reduce((a, x) => a + orderTotal(x.o), 0);
    const collected = pays.reduce((a, p) => a + p.amount, 0);
    const balance = delivered.reduce((a, x) => a + orderBalance(x.o), 0);
    const washTotal = wash.reduce((a, s) => a + (s.totals?.total ?? 0), 0);

    // Por vehículo
    const byV = new Map<string, VehicleAgg>();
    for (const { o } of delivered) {
      const k = o.vehicleId || o.vehicle.plate;
      const a = byV.get(k) ?? { key: k, plate: o.vehicle.plate, label: `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year || ""}`.trim(), visits: 0, billed: 0, balance: 0 };
      a.visits++;
      a.billed += orderTotal(o);
      a.balance += orderBalance(o);
      byV.set(k, a);
    }
    const vehicles = [...byV.values()];

    // Tipos de trabajo
    const byType = new Map<WorkType, number>();
    for (const { o } of delivered) byType.set(o.type, (byType.get(o.type) ?? 0) + orderTotal(o));
    const types = [...byType].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([t, v], i) => ({ name: WORK_TYPE_LABELS[t] ?? "Otro", value: v, color: PALETTE[i % PALETTE.length]! }));

    // Por mes
    const months: Array<{ key: string; label: string; facturado: number; cobrado: number }> = [];
    const first = hnDayKey(r.start).slice(0, 7);
    const lastMs = Math.min(r.end, Date.now() + 86_400_000) - 1;
    const last = hnDayKey(lastMs).slice(0, 7);
    let [y, m] = first.split("-").map(Number) as [number, number];
    for (let i = 0; i < 24; i++) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      if (k > last) break;
      months.push({ key: k, label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, facturado: 0, cobrado: 0 });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    const idx = new Map(months.map((x, i) => [x.key, i]));
    for (const { o, at } of delivered) { const i = idx.get(hnDayKey(at).slice(0, 7)); if (i !== undefined) months[i]!.facturado += orderTotal(o); }
    for (const p of pays) { const i = idx.get(hnDayKey(p.at.toMillis()).slice(0, 7)); if (i !== undefined) months[i]!.cobrado += p.amount; }

    return { count: delivered.length, billed, collected, balance, washTotal, washCount: wash.length, vehicles, types, months };
  }, [orders, receipts, sales, r]);

  if (error) return <ErrorState message={error} />;
  if (loading && !orders.length) return <div className="grid gap-3 p-5 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>;

  const vehicleCols: Col<VehicleAgg>[] = [
    { label: "Vehículo", value: (v) => `${formatPlate(v.plate)} · ${v.label}` },
    { label: "Visitas", kind: "number", value: (v) => v.visits },
    { label: "Facturado", kind: "money", value: (v) => v.billed },
    { label: "Promedio por visita", kind: "money", value: (v) => (v.visits ? Math.round(v.billed / v.visits) : 0) },
    { label: "Saldo", kind: "money", value: (v) => v.balance, tone: (v) => (v.balance > 0 ? "text-amber-700 font-semibold" : undefined) },
  ];
  const bySpend = [...data.vehicles].sort((a, b) => b.billed - a.billed);
  const byVisits = [...data.vehicles].sort((a, b) => b.visits - a.visits || b.billed - a.billed);

  return (
    <div className="min-w-0 space-y-5 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented value={key} onChange={setKey} options={RANGES} />
        <span className="text-xs text-slate-500">Órdenes entregadas a {company.name} · {r.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <KpiCard label="Facturado" value={formatMoney(data.billed)} sub={`${data.count} ${data.count === 1 ? "orden" : "órdenes"}`} />
        <KpiCard label="Cobrado" value={formatMoney(data.collected)} tone="text-emerald-700" sub="Pagos recibidos en el período" />
        <KpiCard label="Saldo de estas órdenes" value={formatMoney(data.balance)} tone={data.balance > 0 ? "text-amber-700" : "text-slate-900"} />
        <KpiCard label="Ticket promedio" value={formatMoney(data.count ? Math.round(data.billed / data.count) : 0)} sub={`${data.vehicles.length} vehículos atendidos`} />
        <KpiCard label="Carwash" value={formatMoney(data.washTotal)} sub={`${data.washCount} ${data.washCount === 1 ? "venta" : "ventas"} (aparte del taller)`} className="col-span-2 md:col-span-1" />
      </div>

      {!data.count && !data.washCount ? (
        <Card><EmptyState icon={<BarChart3 className="h-7 w-7" />} title="Sin movimiento en este período" description="Pruebe con un período más amplio." /></Card>
      ) : (
        <>
          <div className="grid gap-5 2xl:grid-cols-[3fr_2fr]">
            <Card className="min-w-0">
              <CardHeader title="Por mes" description="Facturado (órdenes entregadas) y cobrado" />
              <div className="p-3 sm:p-4"><MoneyChart data={data.months} series={[{ key: "facturado", name: "Facturado", color: "#1447E6" }, { key: "cobrado", name: "Cobrado", color: "#10B981" }]} height={250} /></div>
            </Card>
            <Card className="min-w-0">
              <CardHeader title="Tipos de trabajo" description="Facturado por tipo" />
              <div className="p-4">{data.types.length ? <DonutChart data={data.types} /> : <p className="py-8 text-center text-sm text-slate-500">Sin órdenes entregadas.</p>}</div>
            </Card>
          </div>
          <div className="grid gap-5 2xl:grid-cols-2">
            <RichTable title="Gasto por vehículo" description="De mayor a menor" cols={vehicleCols} rows={bySpend} rowKey={(v) => v.key} maxRows={8} total={["Total", data.count, data.billed, null, data.balance]} />
            <RichTable title="Vehículos que más visitan" description="Cantidad de órdenes entregadas" cols={vehicleCols.slice(0, 3)} rows={byVisits} rowKey={(v) => v.key} maxRows={8} />
          </div>
        </>
      )}
    </div>
  );
}
