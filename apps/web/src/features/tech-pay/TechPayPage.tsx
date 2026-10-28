import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, FileSpreadsheet, HandCoins, HardHat, Info, ListChecks, MessageCircle, Printer } from "lucide-react";
import {
  formatMoney, hnDayKey, PAYMENT_METHOD_LABELS, TECH_EARNING_STATUS_LABELS, whatsappLink,
  type TechEarning, type TechPayout,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate, initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { KpiCard, RichTable, Segmented, toReportTable, type Col } from "@/features/finance-analytics/components";
import { exportToExcel } from "@/features/reports/table";
import { useSettings } from "@/features/settings/api";
import { useEmployeeProfiles } from "@/features/employees/api";
import { useStaffDirectory } from "@/features/work-orders/api";
import { useEarningsInRange, useEarningsToReview, usePendingEarnings, useTechPayouts } from "./api";
import { PayTechDialog, payoutMessage, ReviewEarningDialog, summaryMessage } from "./PayTechDialog";
import { earningLineText, ruleText, TECH_PERIODS, techPeriod, type TechPeriodKey } from "./format";

type Tab = "employees" | "detail" | "payouts";
const ms = (t: { toMillis?: () => number } | null | undefined) => t?.toMillis?.() ?? 0;

export function EarningStatusBadge({ e }: { e: Pick<TechEarning, "status" | "needsReview"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={e.status === "paid" ? "green" : "amber"}>{TECH_EARNING_STATUS_LABELS[e.status]}</Badge>
      {e.needsReview && <Badge tone="red">Revisar</Badge>}
    </span>
  );
}

interface Group {
  id: string;
  name: string;
  /** todos los pendientes (cualquier fecha) */
  pending: TechEarning[];
  pendingTotal: number;
  /** pendientes ganados dentro del período */
  pendingInPeriod: TechEarning[];
  earnedInPeriod: number;
  paidInPeriod: number;
}

/** Pagos a técnicos por trabajo: lo que gana cada empleado en las órdenes cobradas, y sus pagos. */
export function TechPayPage() {
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>("employees");
  const [periodKey, setPeriodKey] = useState<TechPeriodKey>("fortnight");
  const today = hnDayKey(Date.now());
  const [custom, setCustom] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const period = useMemo(() => techPeriod(periodKey, custom), [periodKey, custom]);
  const pending = usePendingEarnings();
  const earned = useEarningsInRange(period.start, period.end);
  const payouts = useTechPayouts(period.start, period.end);
  const review = useEarningsToReview();
  const profiles = useEmployeeProfiles();
  const staff = useStaffDirectory();
  const [paying, setPaying] = useState<Group | null>(null);
  const [reviewing, setReviewing] = useState<TechEarning | null>(null);
  const [exporting, setExporting] = useState(false);

  const phoneOf = useMemo(() => new Map(profiles.data.map((p) => [p.id, p.phone ?? ""])), [profiles.data]);
  const nameOf = useMemo(() => new Map(staff.data.map((s) => [s.id, s.displayName])), [staff.data]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    const get = (id: string, name: string) => {
      let g = map.get(id);
      if (!g) {
        g = { id, name: nameOf.get(id) || name, pending: [], pendingTotal: 0, pendingInPeriod: [], earnedInPeriod: 0, paidInPeriod: 0 };
        map.set(id, g);
      }
      return g;
    };
    const from = period.start.getTime();
    const to = period.end.getTime();
    for (const e of pending.data) {
      const g = get(e.employeeId, e.employeeName);
      g.pending.push(e);
      g.pendingTotal += e.total;
      const t = ms(e.earnedAt);
      if (t >= from && t < to) g.pendingInPeriod.push(e);
    }
    for (const e of earned.data) get(e.employeeId, e.employeeName).earnedInPeriod += e.total;
    for (const p of payouts.data) get(p.employeeId, p.employeeName).paidInPeriod += p.amount;
    return [...map.values()].sort((a, b) => b.pendingTotal - a.pendingTotal || b.earnedInPeriod - a.earnedInPeriod || a.name.localeCompare(b.name));
  }, [pending.data, earned.data, payouts.data, period, nameOf]);

  const pendingTotal = pending.data.reduce((a, e) => a + e.total, 0);
  const earnedTotal = earned.data.reduce((a, e) => a + e.total, 0);
  const paidTotal = payouts.data.reduce((a, p) => a + p.amount, 0);
  const pendingInPeriod = groups.reduce((a, g) => a + g.pendingInPeriod.reduce((x, e) => x + e.total, 0), 0);

  const detailCols: Col<TechEarning>[] = [
    { label: "Orden", value: (e) => e.orderCode, render: (e) => <Link to={`/ordenes/${e.orderId}?tab=servicios`} className="whitespace-nowrap font-semibold text-brand-700 hover:underline">{e.orderCode}</Link> },
    { label: "Empleado", value: (e) => e.employeeName },
    { label: "Cliente / vehículo", value: (e) => `${e.customerName} · ${e.plate}` },
    { label: "Cobrada", value: (e) => formatDate(e.earnedAt), render: (e) => <span className="whitespace-nowrap">{formatDate(e.earnedAt)}</span> },
    {
      label: "Trabajos", value: (e) => e.lines.map(earningLineText).join("; "),
      render: (e) => (
        <ul className="space-y-0.5 text-xs">
          {e.lines.map((l) => <li key={l.itemId}><span className="text-slate-800">{l.description}</span> <span className="text-slate-500">· {ruleText(l)}{l.mode === "percent" ? ` de ${formatMoney(l.base)}` : ""} · <span className="tabular">{formatMoney(l.amount)}</span></span></li>)}
        </ul>
      ),
    },
    { label: "Total", kind: "money", value: (e) => e.total, tone: () => "font-semibold text-slate-900" },
    { label: "Estado", value: (e) => `${TECH_EARNING_STATUS_LABELS[e.status]}${e.needsReview ? " (revisar)" : ""}`, render: (e) => <EarningStatusBadge e={e} /> },
    { label: "", value: () => "", screenOnly: true, render: (e) => (e.needsReview ? <button onClick={() => setReviewing(e)} className="text-xs font-semibold text-brand-700 hover:underline">Revisar</button> : null) },
  ];

  const onExport = async () => {
    setExporting(true);
    try {
      const payoutCols: Col<TechPayout>[] = [
        { label: "Pago", value: (p) => p.code }, { label: "Fecha", value: (p) => formatDate(p.at) }, { label: "Empleado", value: (p) => p.employeeName },
        { label: "Órdenes", value: (p) => p.orderCodes.join(", ") }, { label: "Método", value: (p) => PAYMENT_METHOD_LABELS[p.method] }, { label: "Referencia", value: (p) => p.reference },
        { label: "Gasto", value: (p) => p.expenseCode }, { label: "Monto", kind: "money", value: (p) => p.amount },
      ];
      const byEmp: Col<Group>[] = [
        { label: "Empleado", value: (g) => g.name }, { label: "Pendiente (todas las fechas)", kind: "money", value: (g) => g.pendingTotal },
        { label: "Ganado en el período", kind: "money", value: (g) => g.earnedInPeriod }, { label: "Pagado en el período", kind: "money", value: (g) => g.paidInPeriod },
      ];
      await exportToExcel({
        title: "Pagos a técnicos",
        periodLabel: period.label,
        fileRange: `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`,
        summary: [["Pendiente por pagar (todas las fechas)", pendingTotal, "money"], ["Ganado en el período", earnedTotal, "money"], ["Pagado en el período", paidTotal, "money"]],
        tables: [
          toReportTable("Resumen por empleado", byEmp, groups, ["Total", pendingTotal, earnedTotal, paidTotal]),
          toReportTable("Trabajos ganados en el período", detailCols, earned.data, undefined, "Sin trabajos en el período"),
          toReportTable("Pendientes por pagar (todas las fechas)", detailCols, pending.data, undefined, "Sin pendientes"),
          toReportTable("Pagos en el período", payoutCols, payouts.data, undefined, "Sin pagos en el período"),
        ],
      });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "employees", label: "Por empleado", icon: <HardHat className="h-4 w-4" />, count: groups.length },
    { value: "detail", label: "Detalle por orden", icon: <ListChecks className="h-4 w-4" />, count: earned.data.length },
    { value: "payouts", label: "Pagos", icon: <Printer className="h-4 w-4" />, count: payouts.data.length },
  ];
  const loadingFirst = (pending.loading && !pending.data.length) || (earned.loading && !earned.data.length);

  return (
    <>
      <PageHeader
        title="Pagos a técnicos"
        description="Lo que gana cada empleado por los trabajos de mano de obra y servicio, cuando la orden se cobra completa."
        actions={<Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void onExport()} loading={exporting}>Exportar a Excel</Button>}
      />

      {review.data.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{review.data.length === 1 ? "Un trabajo ya pagado tiene un aviso" : `${review.data.length} trabajos ya pagados tienen avisos`}: la orden cambió después del pago. {review.data.slice(0, 3).map((e) => `${e.orderCode} (${e.employeeName})`).join(", ")}</span>
          <Button size="sm" variant="secondary" onClick={() => setReviewing(review.data[0]!)}>Revisar</Button>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <Segmented value={periodKey} onChange={setPeriodKey} options={TECH_PERIODS} />
        {periodKey === "custom" && (
          <div className="flex items-center gap-2 text-sm">
            <Input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 w-auto" aria-label="Desde" />
            <span className="text-slate-500">al</span>
            <Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 w-auto" aria-label="Hasta" />
          </div>
        )}
        <span className="text-sm text-slate-500 lg:ml-auto">{period.label}</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Pendiente por pagar" value={formatMoney(pendingTotal)} tone={pendingTotal > 0 ? "text-amber-700" : "text-slate-900"} sub={`${pending.data.length} ${pending.data.length === 1 ? "trabajo" : "trabajos"} · todas las fechas`} />
        <KpiCard label="Pendiente del período" value={formatMoney(pendingInPeriod)} sub="Órdenes cobradas en el período" />
        <KpiCard label="Ganado en el período" value={formatMoney(earnedTotal)} sub={`${earned.data.length} ${earned.data.length === 1 ? "orden" : "órdenes"} por empleado`} />
        <KpiCard label="Pagado en el período" value={formatMoney(paidTotal)} tone="text-emerald-700" sub={`${payouts.data.length} ${payouts.data.length === 1 ? "pago" : "pagos"}`} />
      </div>

      <Card>
        <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>

        {tab === "employees" && (
          pending.error ? <ErrorState message={pending.error} /> : loadingFirst ? <ListSkeleton /> : !groups.length ? (
            <EmptyState icon={<HandCoins className="h-7 w-7" />} title="Sin trabajos por pagar" description="Ponga el pago a técnico en las líneas de mano de obra o servicio de la cotización. Se gana cuando la orden se cobra completa." />
          ) : (
            <div className="space-y-3 p-4">
              {groups.map((g) => (
                <EmployeeGroup
                  key={g.id} group={g} periodLabel={period.label} phone={phoneOf.get(g.id)} workshop={settings.name}
                  onPay={() => setPaying(g)} onReview={setReviewing}
                />
              ))}
            </div>
          )
        )}

        {tab === "detail" && (
          earned.error ? <ErrorState message={earned.error} /> : earned.loading && !earned.data.length ? <ListSkeleton /> : (
            <div className="p-4">
              <RichTable
                title={`Trabajos ganados · ${period.label}`}
                description="Por la fecha en que la orden quedó pagada. Una fila por orden y empleado."
                cols={detailCols}
                rows={earned.data}
                rowKey={(e) => e.id}
                total={["Total", "", "", "", "", earnedTotal, "", ""]}
                empty="Sin trabajos en este período."
              />
            </div>
          )
        )}

        {tab === "payouts" && (
          payouts.error ? <ErrorState message={payouts.error} /> : payouts.loading && !payouts.data.length ? <ListSkeleton /> : !payouts.data.length ? (
            <EmptyState icon={<Printer className="h-7 w-7" />} title="Sin pagos en este período" description="Los pagos a técnicos quedan aquí con su comprobante." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {payouts.data.map((p) => {
                const phone = phoneOf.get(p.employeeId);
                return (
                  <li key={p.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{p.code} · {p.employeeName}</div>
                      <div className="truncate text-xs text-slate-500">{formatDate(p.at, true)} · {PAYMENT_METHOD_LABELS[p.method]}{p.bank ? ` ${p.bank}` : ""}{p.reference ? ` · ref. ${p.reference}` : ""} · {p.count} {p.count === 1 ? "orden" : "órdenes"}{p.expenseCode ? ` · gasto ${p.expenseCode}` : ""}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <span className="tabular text-sm font-bold text-emerald-700">{formatMoney(p.amount)}</span>
                      <div className="flex gap-2">
                        {phone && <a href={whatsappLink(phone, payoutMessage(p, settings.name))} target="_blank" rel="noreferrer" aria-label={`Enviar a ${p.employeeName} por WhatsApp`}><Button size="sm" variant="ghost" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>WhatsApp</Button></a>}
                        <a href={`/imprimir/pago-tecnico/${p.id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />}>Comprobante</Button></a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          El pago a técnicos es <b>costo</b> de cada orden: Finanzas ya lo resta de la utilidad, y la comisión de referidos se calcula después de restarlo.
          Al registrar el pago se crea un gasto <b>Pago a técnicos</b> para el control de caja, que no se vuelve a restar de la utilidad.
          Si la orden vuelve a tener saldo o cambia la cotización, lo pendiente se recalcula solo; lo ya pagado queda marcado para revisar.
        </p>
      </div>

      {paying && (
        <PayTechDialog
          employee={{ id: paying.id, name: paying.name }}
          pending={paying.pending}
          preselect={paying.pendingInPeriod.map((e) => e.id)}
          phone={phoneOf.get(paying.id)}
          onClose={() => setPaying(null)}
        />
      )}
      {reviewing && <ReviewEarningDialog earning={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function ListSkeleton() {
  return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
}

function EmployeeGroup({ group: g, periodLabel, phone, workshop, onPay, onReview }: {
  group: Group;
  periodLabel: string;
  phone?: string;
  workshop: string;
  onPay: () => void;
  onReview: (e: TechEarning) => void;
}) {
  const [open, setOpen] = useState(g.pending.length > 0 && g.pending.length <= 4);
  const msg = summaryMessage(g.name, workshop, periodLabel, g.pending, g.paidInPeriod);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" data-testid="techpay-group">
      <div className="flex flex-col gap-3 bg-slate-50/70 px-4 py-3 md:flex-row md:items-center">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={!g.pending.length}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-700 ring-1 ring-inset ring-slate-200">{initials(g.name) || "?"}</span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900">{g.name}</span>
            <span className="block truncate text-xs text-slate-500">{g.pending.length ? `${g.pending.length} ${g.pending.length === 1 ? "trabajo pendiente" : "trabajos pendientes"}` : "Al día"}</span>
          </span>
          {g.pending.length > 0 && <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-slate-400 transition md:ml-2", open && "rotate-180")} />}
        </button>
        <dl className="grid grid-cols-3 gap-3 text-right md:w-[360px]">
          <div><dt className="text-[11px] text-slate-500">Pendiente</dt><dd className={cn("tabular text-sm font-bold", g.pendingTotal ? "text-amber-700" : "text-slate-400")}>{formatMoney(g.pendingTotal)}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Ganado</dt><dd className="tabular text-sm font-semibold text-slate-900">{formatMoney(g.earnedInPeriod)}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Pagado</dt><dd className="tabular text-sm font-semibold text-emerald-700">{formatMoney(g.paidInPeriod)}</dd></div>
        </dl>
        <div className="flex items-center justify-end gap-2">
          {phone && (
            <a href={whatsappLink(phone, msg)} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Enviar resumen por WhatsApp" aria-label={`Enviar resumen a ${g.name} por WhatsApp`}>
              <MessageCircle className="h-4 w-4" />
            </a>
          )}
          <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={onPay} disabled={!g.pending.length}>Registrar pago</Button>
        </div>
      </div>
      {open && g.pending.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {g.pending.map((e) => (
            <li key={e.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <Link to={`/ordenes/${e.orderId}?tab=servicios`} className="font-semibold text-brand-700 hover:underline">{e.orderCode}</Link>
                <span className="min-w-0 flex-1 truncate text-slate-600">{e.customerName} · {e.plate}</span>
                <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">Cobrada {formatDate(e.earnedAt)}</span>
                <span className="tabular font-semibold text-slate-900">{formatMoney(e.total)}</span>
              </div>
              <ul className="mt-1 space-y-0.5 pl-1 text-xs text-slate-500">
                {e.lines.map((l) => (
                  <li key={l.itemId} className="flex gap-2">
                    <span className="min-w-0 flex-1 sm:truncate">{l.description} · {ruleText(l)}{l.mode === "percent" ? ` de ${formatMoney(l.base)}` : ""}</span>
                    <span className="tabular">{formatMoney(l.amount)}</span>
                  </li>
                ))}
              </ul>
              {e.needsReview && <button onClick={() => onReview(e)} className="mt-1 text-xs font-semibold text-red-700 hover:underline">Revisar aviso</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
