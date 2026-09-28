import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import {
  formatMoney, hnDayKey, VEHICLE_SIZE_SHORT, WASH_STATUS_LABELS, WASH_STATUSES, washPlate, type Wash, type WashStatus,
} from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { formatDate, formatPlate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { computePeriod, hnTodayStart, type PeriodKey } from "@/features/reports/period";
import { StatCard } from "@/features/reports/ui";
import { useWashesInRange } from "./api";
import { ChargeDialog } from "./ChargeDialog";
import { RegisterWashDialog } from "./RegisterWashDialog";
import { washNet } from "./reportData";
import { CarwashTabs, msOf, STATUS_STYLE } from "./ui";
import { CancelWashDialog, needsCharge, WashDetailDialog, WhatsAppReadyDialog } from "./WashDialogs";

const PERIODS: Array<[PeriodKey, string]> = [
  ["today", "Hoy"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["prevMonth", "Mes anterior"],
  ["custom", "Día"],
];

type StatusFilter = WashStatus | "all" | "unpaid";

/** Historial de lavados por período: buscar por placa, ver detalle, cobrar pendientes y reimprimir tickets. */
export function CarwashHistoryPage() {
  const today = hnDayKey(hnTodayStart());
  const [periodKey, setPeriodKey] = useState<PeriodKey>("today");
  const [day, setDay] = useState(today);
  const period = useMemo(() => computePeriod(periodKey, { from: day, to: day }), [periodKey, day]);
  const washes = useWashesInRange(period.start, period.end);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [charge, setCharge] = useState<Wash | null>(null);
  const [whatsapp, setWhatsapp] = useState<Wash | null>(null);
  const [cancel, setCancel] = useState<Wash | null>(null);
  const [edit, setEdit] = useState<Wash | null>(null);

  const rows = useMemo(() => {
    const q = washPlate(search);
    const text = search.trim().toLowerCase();
    return washes.data
      .filter((w) => (status === "all" ? true : status === "unpaid" ? needsCharge(w) : w.status === status))
      .filter((w) => !text || (q && w.plate.includes(q)) || w.customerName.toLowerCase().includes(text) || w.code.toLowerCase().includes(text))
      .sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
  }, [washes.data, status, search]);

  const stats = useMemo(() => {
    const valid = washes.data.filter((w) => w.status !== "cancelled");
    return {
      count: valid.length,
      income: valid.reduce((a, w) => a + washNet(w), 0),
      collected: valid.reduce((a, w) => a + (w.saleId ? w.total : 0), 0),
      unpaid: valid.filter(needsCharge).length,
    };
  }, [washes.data]);

  const detail = detailId ? washes.data.find((w) => w.id === detailId) ?? null : null;

  return (
    <>
      <PageHeader title="Historial del carwash" description="Todos los lavados del período. Toque uno para ver el detalle, cobrarlo o reimprimir el ticket." />
      <CarwashTabs />

      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex w-max rounded-[10px] bg-slate-200/70 p-1">
              {PERIODS.map(([k, l]) => (
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
            <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-[160px]" />
          )}
          <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Placa, cliente o LAV-..." className="h-9 pl-9" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 sm:w-44">
              <option value="all">Todos los estados</option>
              <option value="unpaid">Pendientes de cobro</option>
              {WASH_STATUSES.map((s) => <option key={s} value={s}>{WASH_STATUS_LABELS[s]}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Carros" value={stats.count} hint={period.label} />
        <StatCard label="Cobrado (con ISV)" value={formatMoney(stats.collected)} />
        <StatCard label="Ingreso sin ISV" value={formatMoney(stats.income)} tone="text-emerald-700" />
        <StatCard label="Pendientes de cobro" value={stats.unpaid} tone={stats.unpaid ? "text-amber-700" : "text-slate-900"} />
      </div>

      {washes.error ? (
        <Card><ErrorState message={washes.error} /></Card>
      ) : washes.loading && !washes.data.length ? (
        <PageLoader />
      ) : !rows.length ? (
        <Card><EmptyState icon={<History className="h-7 w-7" />} title="Sin lavados" description={washes.data.length ? "Ningún lavado coincide con el filtro." : "No hay lavados registrados en este período."} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">Lavado</th>
                  <th className="px-4 py-2.5 font-semibold">Placa</th>
                  <th className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 font-semibold">Servicios</th>
                  <th className="px-4 py-2.5 font-semibold">Lavador</th>
                  <th className="px-4 py-2.5 font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((w) => (
                  <tr key={w.id} onClick={() => setDetailId(w.id)} className="cursor-pointer hover:bg-slate-50/70">
                    <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{w.code}</div><div className="text-xs text-slate-500">{formatDate(w.createdAt, true)}</div></td>
                    <td className="px-4 py-2.5 font-bold tracking-wider">{formatPlate(w.plate)}<div className="text-xs font-normal tracking-normal text-slate-500">{VEHICLE_SIZE_SHORT[w.size]}</div></td>
                    <td className="px-4 py-2.5 text-slate-700">{w.customerName || "-"}</td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 text-slate-700">{w.items.map((i) => i.name).join(", ")}</td>
                    <td className="px-4 py-2.5 text-slate-700">{w.washerName || "-"}</td>
                    <td className="px-4 py-2.5"><StatusBadges w={w} /></td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold">{w.total > 0 ? formatMoney(w.total) : "Sin cobro"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 md:hidden">
            {rows.map((w) => (
              <li key={w.id}>
                <button onClick={() => setDetailId(w.id)} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-lg font-extrabold tracking-wider">{formatPlate(w.plate)}</div>
                      <div className="truncate text-xs text-slate-500">{w.code} · {formatDate(w.createdAt, true)}{w.customerName ? ` · ${w.customerName}` : ""}</div>
                    </div>
                    <div className="tabular shrink-0 text-right font-semibold">{w.total > 0 ? formatMoney(w.total) : "Sin cobro"}</div>
                  </div>
                  <div className="mt-1 truncate text-sm text-slate-700">{w.items.map((i) => i.name).join(", ")}</div>
                  <div className="mt-1.5"><StatusBadges w={w} /></div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {charge && <ChargeDialog wash={washes.data.find((w) => w.id === charge.id) ?? charge} onClose={() => setCharge(null)} />}
      <WhatsAppReadyDialog wash={whatsapp} onClose={() => setWhatsapp(null)} />
      <CancelWashDialog wash={cancel} onClose={(done) => { setCancel(null); if (done) setDetailId(null); }} />
      <RegisterWashDialog open={!!edit} wash={edit} onClose={() => setEdit(null)} />
      <WashDetailDialog
        wash={detail}
        onClose={() => setDetailId(null)}
        onCharge={(w) => setCharge(w)}
        onEdit={(w) => { setDetailId(null); setEdit(w); }}
        onWhatsApp={(w) => setWhatsapp(w)}
        onCancel={(w) => setCancel(w)}
      />
    </>
  );
}

function StatusBadges({ w }: { w: Wash }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={STATUS_STYLE[w.status].tone}>{WASH_STATUS_LABELS[w.status]}</Badge>
      {needsCharge(w) && <Badge tone="amber">Sin cobrar</Badge>}
      {w.membershipId && <Badge tone="blue">Membresía</Badge>}
      {w.loyaltyRedeemed && <Badge tone="blue">Premio</Badge>}
    </span>
  );
}
