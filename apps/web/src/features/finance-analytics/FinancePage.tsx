import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarRange, ClipboardList, CreditCard, Package, Receipt, RefreshCw } from "lucide-react";
import { hnDayKey } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { computePeriod, hnTodayStart, PERIOD_OPTIONS, type PeriodKey } from "@/features/reports/period";
import { ReportPrintStyles } from "@/features/reports/ui";
import { previousPeriod } from "./period";
import type { FinTabProps } from "./tabs/common";
import { SummaryTab } from "./tabs/SummaryTab";
import { PaymentsTab } from "./tabs/PaymentsTab";
import { ProductsTab } from "./tabs/ProductsTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { MonthlyTab } from "./tabs/MonthlyTab";

type TabKey = "summary" | "payments" | "products" | "orders" | "expenses" | "monthly";

const TABS: Array<{ value: TabKey; label: string; icon: React.ReactNode }> = [
  { value: "summary", label: "Resumen", icon: <BarChart3 className="h-4 w-4" /> },
  { value: "payments", label: "Cómo nos pagan", icon: <CreditCard className="h-4 w-4" /> },
  { value: "products", label: "Productos y servicios", icon: <Package className="h-4 w-4" /> },
  { value: "orders", label: "Rentabilidad por orden", icon: <ClipboardList className="h-4 w-4" /> },
  { value: "expenses", label: "Gastos", icon: <Receipt className="h-4 w-4" /> },
  { value: "monthly", label: "Mes a mes", icon: <CalendarRange className="h-4 w-4" /> },
];

const TAB_KEY = "rapifix.finance.tab";

export function FinancePage() {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY) as TabKey | null;
      return v && TABS.some((t) => t.value === v) ? v : "summary";
    } catch {
      return "summary";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      /* sin almacenamiento */
    }
  }, [tab]);

  const today = hnDayKey(hnTodayStart());
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + "01", to: today });
  const [refresh, setRefresh] = useState(0);
  const period = useMemo(() => computePeriod(periodKey, custom), [periodKey, custom]);
  const prev = useMemo(() => previousPeriod(periodKey, period), [periodKey, period]);
  const fileRange = `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`;
  const props: FinTabProps = { periodKey, period, prev, fileRange, refresh };

  return (
    <>
      <ReportPrintStyles />
      <div className="print:hidden">
        <PageHeader
          title="Finanzas"
          description="Utilidad, márgenes, lo más rentable y cómo le pagan al taller. Montos sin ISV salvo donde se indica, en hora de Honduras."
          actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefresh((n) => n + 1)}>Actualizar</Button>}
        />
      </div>
      <div className="mb-3 hidden print:block">
        <div className="text-xl font-extrabold tracking-tight">RAPI<span className="text-brand-600">FIX</span> · Finanzas</div>
        <div className="text-sm text-slate-600">
          {tab === "monthly" ? "Últimos 12 meses" : period.label} · Impreso el{" "}
          {new Intl.DateTimeFormat("es-HN", { dateStyle: "long", timeStyle: "short", timeZone: "America/Tegucigalpa" }).format(new Date())}
        </div>
      </div>

      {tab !== "monthly" && (
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
            <div className="text-sm lg:ml-auto lg:text-right">
              <div className="font-medium text-slate-700">{period.label}</div>
              <div className="text-xs text-slate-400">Se compara con {prev.label}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-5 print:hidden">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "summary" && <SummaryTab {...props} />}
      {tab === "payments" && <PaymentsTab {...props} />}
      {tab === "products" && <ProductsTab {...props} />}
      {tab === "orders" && <OrdersTab {...props} />}
      {tab === "expenses" && <ExpensesTab {...props} />}
      {tab === "monthly" && <MonthlyTab {...props} />}

      <p className="mt-6 text-xs text-slate-400 print:hidden">
        Números estimados para tomar decisiones, no contabilidad formal. Pagos anulados, gastos anulados, ventas anuladas y órdenes canceladas no suman.
      </p>
    </>
  );
}
