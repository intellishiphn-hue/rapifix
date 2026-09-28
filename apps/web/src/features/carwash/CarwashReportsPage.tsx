import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { carwashCol, CARWASH_SERVICE_KIND_LABELS, formatMoney, hnDayKey, type CarwashMembership, type CarwashServiceKind, type Wash } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { computePeriod, hnTodayStart, PERIOD_OPTIONS, type PeriodKey } from "@/features/reports/period";
import { fetchAll, fetchRange, useLoader } from "@/features/reports/data";
import { DailyAmountChart } from "@/features/reports/charts";
import { DataTable, ReportPrintStyles, StatCard, TabActions, TabError, TabSkeleton } from "@/features/reports/ui";
import type { ReportTable } from "@/features/reports/table";
import { buildCarwashReport } from "./reportData";
import { CarwashTabs, formatMinutes } from "./ui";

async function load(start: Date, end: Date) {
  const [washes, memberships] = await Promise.all([
    fetchRange<Wash>(carwashCol.washes(TENANT_ID), "createdAt", start, end),
    fetchAll<CarwashMembership>(carwashCol.memberships(TENANT_ID)),
  ]);
  return { washes, memberships };
}

export function CarwashReportsPage() {
  const today = hnDayKey(hnTodayStart());
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + "01", to: today });
  const [refresh, setRefresh] = useState(0);
  const period = useMemo(() => computePeriod(periodKey, custom), [periodKey, custom]);
  const fileRange = `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`;

  const { data, loading, error } = useLoader(() => load(period.start, period.end), `carwash-report|${period.start.getTime()}|${period.end.getTime()}|${refresh}`);
  const r = useMemo(() => (data ? buildCarwashReport(data.washes, data.memberships, period.start, period.end) : null), [data, period]);

  const tables: ReportTable[] = useMemo(() => {
    if (!r) return [];
    return [
      {
        title: "Por servicio",
        columns: [{ label: "Servicio" }, { label: "Tipo" }, { label: "Veces", kind: "number" }, { label: "Cortesías", kind: "number" }, { label: "Ingreso sin ISV", kind: "money" }],
        rows: r.byService.map((s) => [s.name, CARWASH_SERVICE_KIND_LABELS[s.kind as CarwashServiceKind] ?? s.kind, s.count, s.covered, s.income]),
      },
      {
        title: "Por tamaño",
        columns: [{ label: "Tamaño" }, { label: "Carros", kind: "number" }, { label: "Ingreso sin ISV", kind: "money" }],
        rows: r.bySize.map((s) => [s.label, s.count, s.income]),
        total: ["Total", r.count, r.income],
      },
      {
        title: "Por lavador",
        columns: [{ label: "Lavador" }, { label: "Lavados", kind: "number" }, { label: "Entregados", kind: "number" }, { label: "Ingreso generado", kind: "money" }, { label: "Comisión a pagar", kind: "money" }],
        rows: r.byWasher.map((w) => [w.name, w.washes, w.delivered, w.income, w.commission]),
        total: ["Total", r.byWasher.reduce((a, w) => a + w.washes, 0), r.delivered, r.income, r.byWasher.reduce((a, w) => a + w.commission, 0)],
      },
      {
        title: "Por día",
        columns: [{ label: "Día" }, { label: "Carros", kind: "number" }, { label: "Ingreso sin ISV", kind: "money" }],
        rows: r.byDay.map((d) => [d.key, d.count, d.amount]),
      },
      {
        title: "Horas pico (hora del día)",
        columns: [{ label: "Hora" }, { label: "Carros", kind: "number" }],
        rows: r.byHour.map((h) => [h.label, h.count]),
      },
      {
        title: "Día de la semana",
        columns: [{ label: "Día" }, { label: "Carros", kind: "number" }],
        rows: r.byWeekday.map((d) => [d.label, d.count]),
      },
    ];
  }, [r]);

  const summary = r
    ? ([
        ["Carros lavados", r.count, "number"],
        ["Entregados", r.delivered, "number"],
        ["Ingresos sin ISV (lavados)", r.income, "money"],
        ["ISV cobrado", r.tax, "money"],
        ["Ticket promedio", r.avgTicket, "money"],
        ["Espera promedio (min)", Math.round(r.avgWaitMin), "number"],
        ["Lavado promedio (min)", Math.round(r.avgWashMin), "number"],
        ["Cortesías (membresía o premio)", r.courtesies, "number"],
        ["Valor de cortesías", r.courtesyValue, "money"],
        ["Membresías activas", r.memberships.active, "number"],
        ["Ingreso recurrente mensual", r.memberships.recurring, "money"],
        ["Membresías nuevas en el período", r.memberships.newCount, "number"],
        ["Renovaciones en el período", r.memberships.renewals, "number"],
        ["Cobrado por membresías en el período", r.memberships.income, "money"],
      ] as Array<[string, number, "number" | "money"]>)
    : [];

  return (
    <>
      <ReportPrintStyles />
      <div className="print:hidden">
        <PageHeader
          title="Reportes del carwash"
          description="Lavados, ingresos, tiempos, lavadores y membresías por período (hora de Honduras)."
          actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefresh((n) => n + 1)}>Actualizar</Button>}
        />
        <CarwashTabs />
      </div>
      <div className="mb-3 hidden print:block">
        <div className="text-xl font-extrabold tracking-tight">RAPI<span className="text-brand-600">FIX</span> · Carwash</div>
        <div className="text-sm text-slate-600">{period.label}</div>
      </div>

      <Card className="mb-5 p-3 print:hidden">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            <div className="flex rounded-[10px] bg-slate-200/70 p-1">
              {PERIOD_OPTIONS.map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setPeriodKey(k)}
                  className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", periodKey === k ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900")}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {periodKey === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                Desde
                <Input type="date" value={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 w-[150px]" />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                Hasta
                <Input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 w-[150px]" />
              </label>
            </div>
          )}
          <div className="text-sm font-medium text-slate-600 lg:ml-auto">{period.label}</div>
        </div>
      </Card>

      {loading && !r ? (
        <TabSkeleton />
      ) : error ? (
        <TabError message={error} />
      ) : r ? (
        <div className="space-y-5">
          <div className="flex justify-end">
            <TabActions title="Carwash" periodLabel={period.label} fileRange={fileRange} tables={tables} summary={summary} disabled={loading} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Carros lavados" value={r.count} hint={`${r.delivered} entregados${r.cancelled ? ` · ${r.cancelled} cancelados` : ""}`} />
            <StatCard label="Ingresos sin ISV" value={formatMoney(r.income)} hint={`${r.charged} cobros · ISV ${formatMoney(r.tax)}`} tone="text-emerald-700" />
            <StatCard label="Ticket promedio" value={formatMoney(r.avgTicket)} hint="Sin ISV, por lavado cobrado" />
            <StatCard label="Cortesías" value={r.courtesies} hint={`Membresía o premio · ${formatMoney(r.courtesyValue)} en menú`} />
            <StatCard label="Espera promedio" value={formatMinutes(r.avgWaitMin)} hint="De registrado a empezar" />
            <StatCard label="Lavado promedio" value={formatMinutes(r.avgWashMin)} hint="De empezar a listo" />
            <StatCard label="Membresías activas" value={r.memberships.active} hint={`${formatMoney(r.memberships.recurring)} al mes`} />
            <StatCard
              label="Membresías en el período"
              value={formatMoney(r.memberships.income)}
              hint={`${r.memberships.newCount} nuevas · ${r.memberships.renewals} renovaciones`}
            />
          </div>
          {r.pendingCharge > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              Hay {r.pendingCharge} {r.pendingCharge === 1 ? "lavado" : "lavados"} del período sin cobrar. No suman en los ingresos.
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="report-card">
              <CardHeader title="Carros por día" />
              <div className="px-2 pb-4"><CountChart data={r.byDay.map((d) => ({ label: d.label, count: d.count }))} /></div>
            </Card>
            <Card className="report-card">
              <CardHeader title="Ingresos por día" description="Sin ISV, lavados cobrados" />
              <div className="px-2 pb-4"><DailyAmountChart data={r.byDay.map((d) => ({ key: d.key, label: d.label, amount: d.amount }))} /></div>
            </Card>
            <Card className="report-card">
              <CardHeader title="Horas pico" description="Carros registrados por hora del día" />
              <div className="px-2 pb-4"><CountChart data={r.byHour.map((h) => ({ label: h.label, count: h.count }))} /></div>
            </Card>
            <Card className="report-card">
              <CardHeader title="Día de la semana" />
              <div className="px-2 pb-4"><CountChart data={r.byWeekday.map((d) => ({ label: d.label.slice(0, 3), count: d.count }))} /></div>
            </Card>
          </div>

          <DataTable table={tables[2]!} description="La comisión se paga solo por lavados entregados (no cancelados)." />
          <div className="grid gap-5 lg:grid-cols-2">
            <DataTable table={tables[0]!} maxRows={12} />
            <DataTable table={tables[1]!} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function CountChart({ data, height = 220 }: { data: Array<{ label: string; count: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke="#EEF1F6" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#94A3B8", fontSize: 11 }} width={40} />
        <Tooltip
          cursor={{ fill: "#EEF3FF" }}
          contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 13, boxShadow: "0 8px 24px -8px rgb(15 23 42 / .2)" }}
          formatter={(v) => [String(v), "Carros"]}
        />
        <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
