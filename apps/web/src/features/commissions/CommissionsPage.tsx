import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Ban, ChevronDown, FileSpreadsheet, HandCoins, Plus, Printer, UserRound, Users } from "lucide-react";
import {
  COMMISSION_STATUS_LABELS, formatMoney, formatPhone, PAYMENT_METHOD_LABELS,
  type CommissionPayout, type CommissionStatus, type ReferralCommission, type Referrer,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { KpiCard, RichTable, Segmented, toReportTable, type Col } from "@/features/finance-analytics/components";
import { computePeriod, type PeriodKey } from "@/features/reports/period";
import { exportToExcel } from "@/features/reports/table";
import { hnDayKey } from "@rapifix/shared";
import { useCommissionsEarned, useCommissionsToReview, usePayouts, usePendingCommissions, useReferrers } from "./api";
import { PayCommissionsDialog, VoidCommissionDialog } from "./PayCommissionsDialog";
import { ReferrerFormDialog } from "./ReferrerFormDialog";

type Tab = "pending" | "history" | "payouts" | "referrers";
const PERIODS: ReadonlyArray<readonly [PeriodKey, string]> = [["month", "Este mes"], ["prevMonth", "Mes anterior"], ["year", "Este año"]];
const STATUS_TONE: Record<CommissionStatus, "amber" | "green" | "gray"> = { pending: "amber", paid: "green", voided: "gray" };

export function CommissionStatusBadge({ c }: { c: Pick<ReferralCommission, "status" | "needsReview"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[c.status]}>{COMMISSION_STATUS_LABELS[c.status]}</Badge>
      {c.needsReview && <Badge tone="red">Revisar</Badge>}
    </span>
  );
}

/** Columnas del detalle por orden (pantalla y Excel). */
export function commissionCols(opts: { referrer?: boolean; actions?: (c: ReferralCommission) => React.ReactNode } = {}): Col<ReferralCommission>[] {
  return [
    { label: "Orden", value: (c) => c.orderCode, render: (c) => <Link to={`/ordenes/${c.orderId}`} className="whitespace-nowrap font-semibold text-brand-700 hover:underline">{c.orderCode}</Link> },
    ...(opts.referrer ? [{ label: "Referido", value: (c: ReferralCommission) => c.referrerName }] : []),
    { label: "Empresa / cliente", value: (c) => c.companyName || c.customerName, render: (c) => c.companyId ? <Link to={`/empresas/${c.companyId}`} className="hover:text-brand-700">{c.companyName}</Link> : <Link to={`/clientes/${c.customerId}`} className="hover:text-brand-700">{c.customerName}</Link> },
    { label: "Cobrada", value: (c) => formatDate(c.earnedAt), render: (c) => <span className="whitespace-nowrap">{formatDate(c.earnedAt)}</span> },
    { label: "Ingreso sin ISV", kind: "money", value: (c) => c.revenue },
    { label: "Utilidad", kind: "money", value: (c) => c.profit, tone: (c) => (c.profit < 0 ? "text-red-700" : c.missingCostLines ? "text-amber-700" : undefined) },
    { label: "%", kind: "percent", value: (c) => c.pct },
    { label: "Comisión", kind: "money", value: (c) => c.amount, tone: () => "font-semibold text-slate-900" },
    { label: "Estado", value: (c) => `${COMMISSION_STATUS_LABELS[c.status]}${c.needsReview ? " (revisar)" : ""}`, render: (c) => <CommissionStatusBadge c={c} /> },
    ...(opts.actions ? [{ label: "", value: () => "", screenOnly: true, render: opts.actions }] : []),
  ];
}

/** Comisiones por referido: pendientes, historial, pagos y referidos. */
export function CommissionsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<Tab>("pending");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const period = useMemo(() => computePeriod(periodKey), [periodKey]);
  const pending = usePendingCommissions();
  const earned = useCommissionsEarned(period.start, period.end);
  const payouts = usePayouts(period.start, period.end);
  const review = useCommissionsToReview();
  const referrers = useReferrers();
  const [paying, setPaying] = useState<{ referrer: Pick<Referrer, "id" | "name" | "paymentMethod">; list: ReferralCommission[] } | null>(null);
  const [acting, setActing] = useState<{ c: ReferralCommission; mode: "void" | "reviewed" } | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; list: ReferralCommission[]; total: number }>();
    for (const c of pending.data) {
      const g = map.get(c.referrerId) ?? { id: c.referrerId, name: c.referrerName, list: [], total: 0 };
      g.list.push(c);
      g.total += c.amount;
      map.set(c.referrerId, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [pending.data]);

  const pendingTotal = pending.data.reduce((a, c) => a + c.amount, 0);
  const earnedValid = earned.data.filter((c) => c.status !== "voided");
  const earnedTotal = earnedValid.reduce((a, c) => a + c.amount, 0);
  const paidTotal = payouts.data.reduce((a, p) => a + p.amount, 0);
  const refById = useMemo(() => new Map(referrers.data.map((r) => [r.id, r])), [referrers.data]);

  const actions = isAdmin ? (c: ReferralCommission) => (
    c.status === "pending" ? <button onClick={() => setActing({ c, mode: "void" })} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Anular comisión" aria-label={`Anular comisión de ${c.orderCode}`}><Ban className="h-4 w-4" /></button>
      : c.needsReview ? <button onClick={() => setActing({ c, mode: "reviewed" })} className="text-xs font-semibold text-brand-700 hover:underline">Revisar</button> : null
  ) : undefined;

  const onExport = async () => {
    setExporting(true);
    try {
      const cols = commissionCols({ referrer: true });
      const payoutCols: Col<CommissionPayout>[] = [
        { label: "Pago", value: (p) => p.code }, { label: "Fecha", value: (p) => formatDate(p.at) }, { label: "Referido", value: (p) => p.referrerName },
        { label: "Órdenes", value: (p) => p.orderCodes.join(", ") }, { label: "Método", value: (p) => PAYMENT_METHOD_LABELS[p.method] }, { label: "Referencia", value: (p) => p.reference },
        { label: "Gasto", value: (p) => p.expenseCode }, { label: "Monto", kind: "money", value: (p) => p.amount },
      ];
      await exportToExcel({
        title: "Comisiones",
        periodLabel: period.label,
        fileRange: `${hnDayKey(period.start)} a ${hnDayKey(period.end.getTime() - 1)}`,
        summary: [["Pendiente por pagar (todas)", pendingTotal, "money"], ["Ganado en el período", earnedTotal, "money"], ["Pagado en el período", paidTotal, "money"]],
        tables: [
          toReportTable("Pendientes por pagar (todas las fechas)", cols, pending.data, undefined, "Sin comisiones pendientes"),
          toReportTable("Comisiones ganadas en el período", cols, earned.data, undefined, "Sin comisiones en el período"),
          toReportTable("Pagos de comisiones en el período", payoutCols, payouts.data, undefined, "Sin pagos en el período"),
        ],
      });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "pending", label: "Por pagar", icon: <HandCoins className="h-4 w-4" />, count: pending.data.length },
    { value: "history", label: "Historial", icon: <FileSpreadsheet className="h-4 w-4" /> },
    { value: "payouts", label: "Pagos", icon: <Printer className="h-4 w-4" /> },
    { value: "referrers", label: "Referidos", icon: <Users className="h-4 w-4" />, count: referrers.data.filter((r) => r.active).length },
  ];

  return (
    <>
      <PageHeader
        title="Comisiones"
        description="Lo que ganan quienes traen clientes: un % de la utilidad de cada orden cobrada."
        actions={
          <>
            <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void onExport()} loading={exporting}>Exportar a Excel</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo referido</Button>
          </>
        }
      />

      {review.data.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{review.data.length === 1 ? "Una comisión ya pagada tiene un aviso" : `${review.data.length} comisiones ya pagadas tienen avisos`}: la orden cambió después del pago. {review.data.slice(0, 3).map((c) => c.orderCode).join(", ")}</span>
          {isAdmin && <Button size="sm" variant="secondary" onClick={() => setActing({ c: review.data[0]!, mode: "reviewed" })}>Revisar</Button>}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Pendiente por pagar" value={formatMoney(pendingTotal)} tone={pendingTotal > 0 ? "text-amber-700" : "text-slate-900"} sub={`${pending.data.length} ${pending.data.length === 1 ? "orden" : "órdenes"} · ${groups.length} ${groups.length === 1 ? "referido" : "referidos"}`} />
        <KpiCard label="Ganado" value={formatMoney(earnedTotal)} sub={period.label} />
        <KpiCard label="Pagado" value={formatMoney(paidTotal)} tone="text-emerald-700" sub={period.label} />
        <KpiCard label="Referidos activos" value={referrers.data.filter((r) => r.active).length} sub="Aplica a órdenes del taller" />
      </div>

      <Card>
        <div className="flex flex-col gap-2 px-3 pt-1 lg:flex-row lg:items-center lg:justify-between">
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          {(tab === "history" || tab === "payouts") && <div className="px-2 pb-2 lg:pb-0"><Segmented value={periodKey} onChange={setPeriodKey} options={PERIODS} /></div>}
        </div>

        {tab === "pending" && (
          pending.error ? <ErrorState message={pending.error} /> : pending.loading && !pending.data.length ? <ListSkeleton /> : !groups.length ? (
            <EmptyState icon={<HandCoins className="h-7 w-7" />} title="Nada pendiente" description="Cuando una orden de una empresa o cliente referido quede pagada, su comisión aparecerá aquí." />
          ) : (
            <div className="space-y-3 p-4">
              {groups.map((g) => <PendingGroup key={g.id} group={g} referrer={refById.get(g.id)} onPay={() => setPaying({ referrer: refById.get(g.id) ?? { id: g.id, name: g.name, paymentMethod: "" }, list: g.list })} actions={actions} />)}
            </div>
          )
        )}

        {tab === "history" && (
          earned.error ? <ErrorState message={earned.error} /> : earned.loading && !earned.data.length ? <ListSkeleton /> : (
            <div className="p-4">
              <RichTable
                title={`Comisiones ganadas · ${period.label}`}
                description="Por la fecha en que la orden quedó pagada."
                cols={commissionCols({ referrer: true, actions })}
                rows={earned.data}
                rowKey={(c) => c.id}
                total={["Total", "", "", "", earnedValid.reduce((a, c) => a + c.revenue, 0), earnedValid.reduce((a, c) => a + c.profit, 0), null, earnedTotal, ""]}
                empty="Sin comisiones en este período."
              />
            </div>
          )
        )}

        {tab === "payouts" && (
          payouts.error ? <ErrorState message={payouts.error} /> : payouts.loading && !payouts.data.length ? <ListSkeleton /> : !payouts.data.length ? (
            <EmptyState icon={<Printer className="h-7 w-7" />} title="Sin pagos en este período" description="Los pagos de comisiones quedan aquí con su comprobante." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {payouts.data.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{p.code} · <Link to={`/referidos/${p.referrerId}`} className="hover:text-brand-700">{p.referrerName}</Link></div>
                    <div className="truncate text-xs text-slate-500">{formatDate(p.at, true)} · {PAYMENT_METHOD_LABELS[p.method]}{p.bank ? ` ${p.bank}` : ""}{p.reference ? ` · ref. ${p.reference}` : ""} · {p.count} {p.count === 1 ? "orden" : "órdenes"}{p.expenseCode ? ` · gasto ${p.expenseCode}` : ""}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className="tabular text-sm font-bold text-emerald-700">{formatMoney(p.amount)}</span>
                    <a href={`/imprimir/comision/${p.id}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />}>Comprobante</Button></a>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "referrers" && (
          referrers.error ? <ErrorState message={referrers.error} /> : referrers.loading && !referrers.data.length ? <ListSkeleton /> : !referrers.data.length ? (
            <EmptyState icon={<Users className="h-7 w-7" />} title="Sin referidos" description="Registre a las personas que traen clientes al taller para asignarles comisión." action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo referido</Button>} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {referrers.data.map((r) => {
                const g = groups.find((x) => x.id === r.id);
                return (
                  <li key={r.id}>
                    <Link to={`/referidos/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><UserRound className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span className="truncate font-semibold text-slate-900">{r.name}</span>{!r.active && <Badge tone="gray">Inactivo</Badge>}</div>
                        <div className="truncate text-xs text-slate-500">{formatPhone(r.phone)} · {r.defaultPct}% de la utilidad{r.paymentMethod ? ` · ${r.paymentMethod}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn("tabular text-sm font-bold", g ? "text-amber-700" : "text-slate-400")}>{formatMoney(g?.total ?? 0)}</div>
                        <div className="text-[11px] text-slate-500">pendiente</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </Card>

      {paying && <PayCommissionsDialog referrer={paying.referrer} pending={paying.list} onClose={() => setPaying(null)} />}
      {acting && <VoidCommissionDialog commission={acting.c} mode={acting.mode} onClose={() => setActing(null)} />}
      <ReferrerFormDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function ListSkeleton() {
  return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
}

function PendingGroup({ group, referrer, onPay, actions }: {
  group: { id: string; name: string; list: ReferralCommission[]; total: number };
  referrer: Referrer | undefined;
  onPay: () => void;
  actions?: (c: ReferralCommission) => React.ReactNode;
}) {
  const [open, setOpen] = useState(group.list.length <= 4);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex flex-col gap-3 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-600 ring-1 ring-inset ring-slate-200"><UserRound className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900">{group.name}</span>
            <span className="block truncate text-xs text-slate-500">{group.list.length} {group.list.length === 1 ? "orden" : "órdenes"}{referrer?.paymentMethod ? ` · ${referrer.paymentMethod}` : ""}</span>
          </span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-slate-400 transition sm:ml-2", open && "rotate-180")} />
        </button>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="tabular text-lg font-bold text-slate-900">{formatMoney(group.total)}</span>
          <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={onPay}>Pagar comisiones</Button>
        </div>
      </div>
      {open && (
        <ul className="divide-y divide-slate-100">
          {group.list.map((c) => (
            <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:grid-cols-[100px_1fr_150px_120px_56px_110px_32px]">
              <Link to={`/ordenes/${c.orderId}`} className="font-semibold text-brand-700 hover:underline">{c.orderCode}</Link>
              <span className="order-3 col-span-2 truncate text-xs text-slate-600 sm:order-none sm:col-span-1 sm:text-sm">{c.companyName || c.customerName} · {c.plate}</span>
              <span className="hidden whitespace-nowrap text-slate-500 sm:block">Cobrada {formatDate(c.earnedAt)}</span>
              <span className={cn("tabular hidden text-right sm:block", c.missingCostLines ? "text-amber-700" : "text-slate-600")} title={c.missingCostLines ? "Faltan costos de repuestos" : undefined}>{formatMoney(c.profit)}</span>
              <span className="tabular hidden text-right text-slate-500 sm:block">{c.pct}%</span>
              <span className="tabular text-right font-semibold text-slate-900">{formatMoney(c.amount)}</span>
              <span className="hidden text-right sm:block">{actions?.(c)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
