import { useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, ClipboardList, HardHat, Receipt, RefreshCw, ShoppingCart, Wallet, Wrench } from "lucide-react";
import { hnDayKey } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/Feedback";
import { computePeriod, hnTodayStart, PERIOD_OPTIONS, type PeriodKey } from "./period";
import { ReportPrintStyles } from "./ui";
import type { TabProps } from "./tabs/common";
import { SummaryTab } from "./tabs/SummaryTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { ServicesTab } from "./tabs/ServicesTab";
import { TechniciansTab } from "./tabs/TechniciansTab";
import { SalesTab } from "./tabs/SalesTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { InventoryTab } from "./tabs/InventoryTab";

type TabKey = "summary" | "orders" | "services" | "technicians" | "sales" | "expenses" | "inventory";

const TAB_KEY = "rapifix.reports.tab";

export function ReportsPage() {
  const { can, role } = useAuth();
  const financial = can("reports.financial");
  const isManager = role === "admin" || role === "manager";

  const tabs = useMemo(() => {
    const t: Array<{ value: TabKey; label: string; icon: React.ReactNode; show: boolean }> = [
      { value: "summary", label: "Resumen", icon: <BarChart3 className="h-4 w-4" />, show: financial },
      { value: "orders", label: "Órdenes", icon: <ClipboardList className="h-4 w-4" />, show: isManager || role === "reception" },
      { value: "services", label: "Servicios y repuestos", icon: <Wrench className="h-4 w-4" />, show: isManager || role === "reception" },
      { value: "technicians", label: "Técnicos", icon: <HardHat className="h-4 w-4" />, show: isManager },
      { value: "sales", label: "Ventas", icon: <ShoppingCart className="h-4 w-4" />, show: isManager || role === "seller" },
      { value: "expenses", label: "Gastos", icon: <Receipt className="h-4 w-4" />, show: financial },
      { value: "inventory", label: "Inventario", icon: <Boxes className="h-4 w-4" />, show: isManager || role === "warehouse" },
    ];
    return t.filter((x) => x.show);
  }, [financial, isManager, role]);

  const [tab, setTab] = useState<TabKey>(() => {
    try {
      return (sessionStorage.getItem(TAB_KEY) as TabKey) || "summary";
    } catch {
      return "summary";
    }
  });
  const current = tabs.find((t) => t.value === tab) ? tab : tabs[0]?.value;
  useEffect(() => {
    try {
      if (current) sessionStorage.setItem(TAB_KEY, current);
    } catch {
      /* sin almacenamiento */
    }
  }, [current]);

  const today = hnDayKey(hnTodayStart());
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + "01", to: today });
  const [refresh, setRefresh] = useState(0);
  const period = useMemo(() => computePeriod(periodKey, custom), [periodKey, custom]);
  const fileRange = `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`;
  const props: TabProps = { period, fileRange, refresh };

  if (!current) {
    return (
      <>
        <PageHeader title="Reportes" />
        <Card><EmptyState icon={<BarChart3 className="h-7 w-7" />} title="Sin reportes disponibles" description="Su rol no tiene reportes asignados." /></Card>
      </>
    );
  }

  return (
    <>
      <ReportPrintStyles />
      <div className="print:hidden">
        <PageHeader
          title="Reportes"
          description="Números del taller por período, en hora de Honduras. Exporte a Excel o imprima cada pestaña."
          actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefresh((n) => n + 1)}>Actualizar</Button>}
        />
      </div>
      <div className="mb-3 hidden print:block">
        <div className="text-xl font-extrabold tracking-tight">RAPI<span className="text-brand-600">FIX</span> · Reportes</div>
        <div className="text-sm text-slate-600">Impreso el {new Intl.DateTimeFormat("es-HN", { dateStyle: "long", timeStyle: "short", timeZone: "America/Tegucigalpa" }).format(new Date())}</div>
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
            <div className="flex items-center gap-2">
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

      {tabs.length > 1 && (
        <div className="mb-5 print:hidden">
          <Tabs tabs={tabs.map(({ value, label, icon }) => ({ value, label, icon }))} value={current} onChange={setTab} />
        </div>
      )}

      {current === "summary" && <SummaryTab {...props} />}
      {current === "orders" && <OrdersTab {...props} />}
      {current === "services" && <ServicesTab {...props} />}
      {current === "technicians" && <TechniciansTab {...props} />}
      {current === "sales" && <SalesTab {...props} />}
      {current === "expenses" && <ExpensesTab {...props} />}
      {current === "inventory" && <InventoryTab {...props} />}

      {financial && current === "summary" && (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400 print:hidden">
          <Wallet className="h-3.5 w-3.5" /> Los pagos anulados, gastos anulados y órdenes canceladas no suman en los totales.
        </p>
      )}
    </>
  );
}
