import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, FileSpreadsheet, HandCoins, Printer } from "lucide-react";
import {
  AGING_BUCKETS, AGING_LABELS, AGING_SHORT, formatMoney, hnDayKey, orderPaid, orderTotal, PAYMENT_METHOD_LABELS, paymentTermsDetail, paymentTermsLabel,
  type Company, type CompanyPayment, type Payment, type WorkOrder,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { KpiCard } from "@/features/finance-analytics/components";
import { keyToDate } from "@/features/reports/period";
import { exportToExcel, type ReportTable } from "@/features/reports/table";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { keyLabel } from "./api";
import { CompanyPaymentDialog } from "./CompanyPaymentDialog";
import { DueBadge } from "./OrdersTab";
import { periodMovements, statementRows, statementSummary } from "./statement";

const BUCKET_COLOR: Record<string, string> = { current: "bg-emerald-500", d30: "bg-amber-400", d60: "bg-orange-500", d90: "bg-red-500", d90plus: "bg-red-700" };

/** Rango por defecto del estado de cuenta: desde el primer día de hace 2 meses hasta hoy. */
export function defaultStatementRange() {
  const today = hnDayKey(Date.now());
  const [y, m] = today.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 3, 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

/** Pestaña Estado de cuenta: saldo, vencido y por vencer, órdenes con saldo y pago de la empresa. */
export function StatementTab({ company, orders, receipts, companyPayments, loading, error }: {
  company: Company;
  orders: WorkOrder[];
  receipts: Payment[];
  companyPayments: CompanyPayment[];
  loading: boolean;
  error: string | null;
}) {
  const { can } = useAuth();
  const today = hnDayKey(Date.now());
  const rows = useMemo(() => statementRows(company, orders, today), [company, orders, today]);
  const summary = useMemo(() => statementSummary(rows, today), [rows, today]);
  const [paying, setPaying] = useState(false);
  const [range, setRange] = useState(defaultStatementRange);
  const [exporting, setExporting] = useState(false);

  const printUrl = `/imprimir/estado-cuenta/${company.id}?desde=${range.from}&hasta=${range.to}`;

  const onExport = async () => {
    setExporting(true);
    try {
      const start = keyToDate(range.from).getTime();
      const end = keyToDate(range.to).getTime() + 86_400_000;
      const mov = periodMovements(orders, receipts, start, end);
      const due: ReportTable = {
        title: "Órdenes con saldo (al día de hoy)",
        columns: [{ label: "Orden" }, { label: "Placa" }, { label: "Vehículo" }, { label: "Entregada" }, { label: "Vence" }, { label: "Días vencida", kind: "number" }, { label: "Total", kind: "money" }, { label: "Pagado", kind: "money" }, { label: "Saldo", kind: "money" }],
        rows: rows.map((r) => [r.order.code, formatPlate(r.order.vehicle.plate), `${r.order.vehicle.make} ${r.order.vehicle.model} ${r.order.vehicle.year}`, r.deliveredAt ? formatDate(new Date(r.deliveredAt)) : "En taller", r.dueKey ? keyLabel(r.dueKey) : "Al entregar", r.daysOverdue, orderTotal(r.order), orderPaid(r.order), r.balance]),
        total: ["Total", "", "", "", "", null, rows.reduce((a, r) => a + orderTotal(r.order), 0), rows.reduce((a, r) => a + orderPaid(r.order), 0), summary.total],
        empty: "Sin saldo pendiente",
      };
      const billed: ReportTable = {
        title: "Órdenes entregadas en el período",
        columns: [{ label: "Orden" }, { label: "Entregada" }, { label: "Placa" }, { label: "Vehículo" }, { label: "Total", kind: "money" }, { label: "Pagado", kind: "money" }, { label: "Saldo", kind: "money" }],
        rows: mov.delivered.map(({ o, at }) => [o.code, formatDate(new Date(at)), formatPlate(o.vehicle.plate), `${o.vehicle.make} ${o.vehicle.model}`, orderTotal(o), orderPaid(o), orderTotal(o) - orderPaid(o)]),
        total: ["Total", "", "", "", mov.billed, mov.paidOfDelivered, mov.billed - mov.paidOfDelivered],
        empty: "Sin entregas en el período",
      };
      const paid: ReportTable = {
        title: "Pagos recibidos en el período",
        columns: [{ label: "Recibo" }, { label: "Fecha" }, { label: "Orden" }, { label: "Método" }, { label: "Referencia" }, { label: "Monto", kind: "money" }],
        rows: mov.payments.map((p) => [p.code, formatDate(p.at), p.orderCode ?? "", PAYMENT_METHOD_LABELS[p.method], p.reference, p.amount]),
        total: ["Total", "", "", "", "", mov.collected],
        empty: "Sin pagos en el período",
      };
      await exportToExcel({
        title: `Estado de cuenta ${company.name}`,
        periodLabel: `${keyLabel(range.from)} al ${keyLabel(range.to)}`,
        fileRange: `${range.from} a ${range.to}`,
        tables: [due, billed, paid],
        summary: [
          ["Forma de pago", paymentTermsLabel(company)],
          ["Saldo total", summary.total, "money"],
          ["Vencido", summary.overdue, "money"],
          ["Por vencer", summary.current, "money"],
          ...AGING_BUCKETS.filter((b) => b !== "current").map((b) => [AGING_LABELS[b], summary.buckets[b], "money"] as [string, number, "money"]),
          ["Facturado en el período", mov.billed, "money"],
          ["Cobrado en el período", mov.collected, "money"],
        ],
      });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (loading && !orders.length) return <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div className="space-y-5 p-3 sm:p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Saldo total" value={formatMoney(summary.total)} tone={cn("whitespace-nowrap", summary.total > 0 ? "text-slate-900" : "text-emerald-700")} sub={`${summary.count} ${summary.count === 1 ? "orden" : "órdenes"}`} />
        <KpiCard label="Vencido" value={formatMoney(summary.overdue)} tone={cn("whitespace-nowrap", summary.overdue > 0 ? "text-red-600" : "text-slate-900")} sub={summary.overdueCount ? `${summary.overdueCount} ${summary.overdueCount === 1 ? "orden vencida" : "órdenes vencidas"}` : "Nada vencido"} />
        <KpiCard label="Por vencer" value={formatMoney(summary.current)} tone="whitespace-nowrap text-slate-900" sub={paymentTermsLabel(company)} />
        <KpiCard
          label="Límite de crédito"
          value={company.creditLimit ? formatMoney(company.creditLimit) : "Sin límite"}
          tone={cn("whitespace-nowrap", company.creditLimit && summary.total > company.creditLimit ? "text-red-600" : "text-slate-900")}
          sub={company.creditLimit ? (summary.total > company.creditLimit ? `Excedido por ${formatMoney(summary.total - company.creditLimit)}` : `Disponible ${formatMoney(company.creditLimit - summary.total)}`) : paymentTermsDetail(company)}
        />
      </div>

      {/* Antigüedad */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-slate-900">Antigüedad de saldos</h3>
          <span className="text-xs text-slate-500">Según la forma de pago: {paymentTermsDetail(company).toLowerCase()}</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
          {summary.total > 0 && AGING_BUCKETS.map((b) => summary.buckets[b] > 0 && (
            <div key={b} className={BUCKET_COLOR[b]} style={{ width: `${(summary.buckets[b] / summary.total) * 100}%` }} title={`${AGING_LABELS[b]}: ${formatMoney(summary.buckets[b])}`} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AGING_BUCKETS.map((b) => (
            <div key={b} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><span className={cn("h-2 w-2 rounded-full", BUCKET_COLOR[b])} />{b === "current" ? "Por vencer" : `${AGING_SHORT[b]} días`}</div>
              <div className={cn("tabular mt-0.5 text-sm font-bold", b !== "current" && summary.buckets[b] > 0 ? "text-red-700" : "text-slate-900")}>{formatMoney(summary.buckets[b])}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Órdenes con saldo */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Órdenes con saldo</h3>
            <p className="mt-0.5 text-sm text-slate-500">De la más vieja a la más nueva.</p>
          </div>
          {can("payments.read") && rows.length > 0 && <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={() => setPaying(true)}>Registrar pago de la empresa</Button>}
        </div>
        {!rows.length ? (
          <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="Al día" description={`${company.name} no tiene saldo pendiente.`} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5">Orden</th><th className="px-3 py-2.5">Vehículo</th><th className="px-3 py-2.5">Entregada</th><th className="px-3 py-2.5">Vencimiento</th>
                    <th className="px-3 py-2.5 text-right">Total</th><th className="hidden px-3 py-2.5 text-right 2xl:table-cell">Pagado</th><th className="px-5 py-2.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.order.id} className={cn("hover:bg-slate-50/60", r.daysOverdue > 0 && "bg-red-50/30")}>
                      <td className="px-5 py-2.5"><Link to={`/ordenes/${r.order.id}`} className="whitespace-nowrap font-bold text-brand-700 hover:underline">{r.order.code}</Link></td>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><PlateTag plate={r.order.vehicle.plate} className="text-[10px]" /><span className="truncate text-slate-700">{r.order.vehicle.make} {r.order.vehicle.model}</span></div></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.deliveredAt ? formatDate(new Date(r.deliveredAt)) : <span className="text-slate-400">En taller</span>}</td>
                      <td className="px-3 py-2.5"><DueBadge dueKey={r.dueKey} today={today} />{r.dueKey && r.daysOverdue > 0 && <div className="text-[11px] text-slate-500">{keyLabel(r.dueKey)}</div>}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{formatMoney(orderTotal(r.order))}</td>
                      <td className="tabular hidden whitespace-nowrap px-3 py-2.5 text-right text-slate-600 2xl:table-cell">{formatMoney(orderPaid(r.order))}</td>
                      <td className="tabular whitespace-nowrap px-5 py-2.5 text-right font-bold text-slate-900">{formatMoney(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-5 py-2.5" colSpan={5}>Total</td><td className="hidden 2xl:table-cell" />
                    <td className="tabular whitespace-nowrap px-5 py-2.5 text-right">{formatMoney(summary.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.order.id} className={cn("px-4 py-3", r.daysOverdue > 0 && "bg-red-50/30")}>
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/ordenes/${r.order.id}`} className="text-sm font-bold text-brand-700">{r.order.code}</Link>
                    <span className="tabular text-sm font-bold text-slate-900">{formatMoney(r.balance)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm"><PlateTag plate={r.order.vehicle.plate} className="text-[10px]" /><span className="truncate text-slate-700">{r.order.vehicle.make} {r.order.vehicle.model}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{r.deliveredAt ? `Entregada ${formatDate(new Date(r.deliveredAt))}` : "En taller"}</span>
                    <DueBadge dueKey={r.dueKey} today={today} />
                  </div>
                </li>
              ))}
              <li className="flex justify-between bg-slate-50 px-4 py-3 text-sm font-semibold"><span>Total</span><span className="tabular">{formatMoney(summary.total)}</span></li>
            </ul>
          </>
        )}
      </Card>

      {/* Exportar / imprimir */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Estado de cuenta para enviar</h3>
            <p className="text-sm text-slate-500">Incluye el saldo de hoy, las entregas y los pagos del rango de fechas.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Input type="date" aria-label="Desde" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none" />
              <span>al</span>
              <Input type="date" aria-label="Hasta" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void onExport()} loading={exporting}>Excel</Button>
              <a href={printUrl} target="_blank" rel="noreferrer"><Button variant="secondary" size="sm" className="w-full" icon={<Printer className="h-4 w-4" />}><span className="whitespace-nowrap">Imprimir / PDF</span></Button></a>
            </div>
          </div>
        </div>
      </Card>

      {/* Pagos de la empresa */}
      {companyPayments.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Pagos de la empresa" description="Pagos repartidos entre varias órdenes. Cada orden tiene su recibo." />
          <ul className="divide-y divide-slate-100">
            {companyPayments.slice(0, 10).map((p) => (
              <li key={p.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{p.code} <span className="font-normal text-slate-500">· {formatDate(p.at, true)} · {PAYMENT_METHOD_LABELS[p.method]}{p.bank ? ` ${p.bank}` : ""}{p.reference ? ` · ref. ${p.reference}` : ""}</span></div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {p.allocations.map((a) => <a key={a.paymentId} href={`/imprimir/recibo/${a.paymentId}`} target="_blank" rel="noreferrer" className="hover:text-brand-700">{a.orderCode} {formatMoney(a.amount)} ({a.paymentCode})</a>)}
                  </div>
                </div>
                <span className="tabular text-sm font-bold text-emerald-700">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {paying && <CompanyPaymentDialog open onClose={() => setPaying(false)} company={company} rows={rows} />}
    </div>
  );
}
