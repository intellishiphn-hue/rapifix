import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  AGING_BUCKETS, AGING_LABELS, formatMoney, formatPhone, hnDayKey, orderPaid, orderTotal, PAYMENT_METHOD_LABELS, paymentTermsDetail, paymentTermsLabel,
} from "@rapifix/shared";
import { formatDate, formatPlate } from "@/lib/format";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { keyLabel, useCompany, useCompanyOrders, useCompanyPaymentsReceived } from "@/features/companies/api";
import { periodMovements, statementRows, statementSummary } from "@/features/companies/statement";
import { usePayout, usePayoutCommissions, useReferrer } from "@/features/commissions/api";
import { keyToDate } from "@/features/reports/period";
import { Box, PrintShell } from "./PrintPages";
import type React from "react";

/** Lista de datos en una columna (las cajas del estado de cuenta son angostas). */
function List({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="space-y-0.5">
      {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
    </dl>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const th = "px-2 py-1.5";
const td = "px-2 py-1.5";
const tdm = "whitespace-nowrap px-2 py-1.5 text-right";

/** Estado de cuenta de una empresa para imprimir o guardar en PDF. ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
export function PrintStatementPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { settings } = useSettings();
  const company = useCompany(id);
  const orders = useCompanyOrders(id);
  const receipts = useCompanyPaymentsReceived(id);
  const today = hnDayKey(Date.now());
  const to = DAY.test(params.get("hasta") ?? "") ? params.get("hasta")! : today;
  const from = DAY.test(params.get("desde") ?? "") ? params.get("desde")! : `${to.slice(0, 8)}01`;

  const data = useMemo(() => {
    const rows = statementRows(company.data, orders.data, today);
    return {
      rows,
      summary: statementSummary(rows, today),
      mov: periodMovements(orders.data, receipts.data, keyToDate(from).getTime(), keyToDate(to).getTime() + 86_400_000),
    };
  }, [company.data, orders.data, receipts.data, from, to, today]);

  if (company.loading || orders.loading || receipts.loading) return <PageLoader />;
  const c = company.data;
  if (company.error || orders.error || receipts.error || !c) return <ErrorState message={company.error ?? orders.error ?? receipts.error ?? "Empresa no encontrada"} />;
  const { rows, summary, mov } = data;

  return (
    <PrintShell settings={settings} title="Estado de cuenta" code={c.name} date={`${keyLabel(from)} al ${keyLabel(to)}`}>
      <div className="grid grid-cols-2 gap-6">
        <Box title="Cliente">
          <List rows={[["Empresa", c.legalName || c.name], ["RTN", c.rtn], ["Contacto", c.contactName], ["Teléfono", formatPhone(c.contactPhone)]]} />
        </Box>
        <Box title="Condiciones">
          <List rows={[["Forma de pago", paymentTermsLabel(c)], ["Límite de crédito", c.creditLimit ? formatMoney(c.creditLimit) : "Sin límite"], ["Emitido", keyLabel(today)]]} />
          <p className="mt-1 text-[11px] text-slate-500">{paymentTermsDetail(c)}</p>
        </Box>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-slate-100 p-3 text-center"><div className="text-[10.5px] uppercase tracking-wide text-slate-500">Saldo total</div><div className="text-xl font-extrabold">{formatMoney(summary.total)}</div></div>
        <div className="rounded-lg bg-red-50 p-3 text-center"><div className="text-[10.5px] uppercase tracking-wide text-red-700">Vencido</div><div className="text-xl font-extrabold text-red-700">{formatMoney(summary.overdue)}</div></div>
        <div className="rounded-lg bg-slate-100 p-3 text-center"><div className="text-[10.5px] uppercase tracking-wide text-slate-500">Por vencer</div><div className="text-xl font-extrabold">{formatMoney(summary.current)}</div></div>
      </section>

      <Box title="Antigüedad de saldos">
        <table className="w-full border-collapse text-[11.5px]">
          <tbody>
            <tr>{AGING_BUCKETS.map((b) => <td key={b} className="border border-slate-200 px-2 py-1 text-center text-slate-500">{AGING_LABELS[b]}</td>)}</tr>
            <tr>{AGING_BUCKETS.map((b) => <td key={b} className="border border-slate-200 px-2 py-1 text-center font-semibold">{formatMoney(summary.buckets[b])}</td>)}</tr>
          </tbody>
        </table>
      </Box>

      <Box title="Órdenes con saldo pendiente">
        {!rows.length ? <p className="text-slate-500">Sin saldo pendiente. Gracias por mantenerse al día.</p> : (
          <table className="w-full border-collapse">
            <thead><tr className="bg-slate-900 text-left text-[10.5px] uppercase tracking-wide text-white"><th className={th}>Orden</th><th className={th}>Vehículo</th><th className={th}>Entregada</th><th className={th}>Vence</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Pagado</th><th className={`${th} text-right`}>Saldo</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order.id} className="border-b border-slate-200">
                  <td className={`${td} whitespace-nowrap font-semibold`}>{r.order.code}</td>
                  <td className={td}>{formatPlate(r.order.vehicle.plate)} · {r.order.vehicle.make} {r.order.vehicle.model}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.deliveredAt ? formatDate(new Date(r.deliveredAt)) : "En taller"}</td>
                  <td className={`${td} ${r.daysOverdue > 0 ? "font-semibold text-red-700" : ""}`}>{r.dueKey ? <>{keyLabel(r.dueKey)}{r.daysOverdue > 0 && <span className="block text-[10.5px]">{r.daysOverdue} días vencida</span>}</> : "Al entregar"}</td>
                  <td className={tdm}>{formatMoney(orderTotal(r.order))}</td>
                  <td className={tdm}>{formatMoney(orderPaid(r.order))}</td>
                  <td className={`${tdm} font-semibold`}>{formatMoney(r.balance)}</td>
                </tr>
              ))}
              <tr className="font-bold"><td className={td} colSpan={6}>Total</td><td className={tdm}>{formatMoney(summary.total)}</td></tr>
            </tbody>
          </table>
        )}
      </Box>

      <div className="grid grid-cols-2 gap-6">
        <Box title={`Entregas del período (${formatMoney(mov.billed)})`}>
          {!mov.delivered.length ? <p className="text-slate-500">Sin entregas.</p> : (
            <table className="w-full border-collapse text-[11.5px]">
              <tbody>
                {mov.delivered.map(({ o, at }) => (
                  <tr key={o.id} className="border-b border-slate-200"><td className="py-1 pr-2">{formatDate(new Date(at))}</td><td className="py-1 pr-2 font-semibold">{o.code}</td><td className="py-1 pr-2">{formatPlate(o.vehicle.plate)}</td><td className="py-1 text-right">{formatMoney(orderTotal(o))}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
        <Box title={`Pagos recibidos (${formatMoney(mov.collected)})`}>
          {!mov.payments.length ? <p className="text-slate-500">Sin pagos.</p> : (
            <table className="w-full border-collapse text-[11.5px]">
              <tbody>
                {mov.payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-200"><td className="whitespace-nowrap py-1 pr-2">{formatDate(p.at)}</td><td className="whitespace-nowrap py-1 pr-2 font-semibold">{p.code}</td><td className="py-1 pr-2">{p.orderCode} · {PAYMENT_METHOD_LABELS[p.method]}</td><td className="whitespace-nowrap py-1 text-right">{formatMoney(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
      </div>

      <Box title="Formas de pago">
        <p>{(settings.bankAccounts ?? []).length ? `Transferencia o depósito a: ${settings.bankAccounts.join(", ")}.` : "Consulte las cuentas bancarias con el taller."} Indique en la referencia el número de orden.</p>
      </Box>
      <p className="text-[10.5px] text-slate-400">Estado de cuenta informativo al {keyLabel(today)}. Los pagos registrados después de esta fecha no aparecen. No es factura fiscal.</p>
    </PrintShell>
  );
}

/** Comprobante de pago de comisiones para el referido. */
export function PrintCommissionPage() {
  const { id } = useParams();
  const { settings } = useSettings();
  const payout = usePayout(id);
  const referrer = useReferrer(payout.data?.referrerId);
  const items = usePayoutCommissions(id);
  if (payout.loading) return <PageLoader />;
  const p = payout.data;
  if (payout.error || !p) return <ErrorState message={payout.error ?? "Pago no encontrado"} />;
  return (
    <PrintShell settings={settings} title="Pago de comisiones" code={p.code} date={formatDate(p.at, true)}>
      <div className="grid grid-cols-2 gap-6">
        <Box title="Pagado a"><List rows={[["Nombre", p.referrerName], ["Identidad", referrer.data?.idNumber], ["Teléfono", formatPhone(referrer.data?.phone)]]} /></Box>
        <Box title="Pago"><List rows={[["Método", PAYMENT_METHOD_LABELS[p.method]], ...(p.bank ? [["Banco", p.bank] as [string, string]] : []), ["Referencia", p.reference], ["Registró", p.byName]]} /></Box>
      </div>
      <Box title={`Comisiones incluidas (${p.count})`}>
        {items.data.length ? (
          <table className="w-full border-collapse">
            <thead><tr className="bg-slate-900 text-left text-[10.5px] uppercase tracking-wide text-white"><th className={th}>Orden</th><th className={th}>Empresa / cliente</th><th className={th}>Cobrada</th><th className={`${th} text-right`}>Utilidad</th><th className={`${th} text-right`}>%</th><th className={`${th} text-right`}>Comisión</th></tr></thead>
            <tbody>
              {[...items.data].sort((a, b) => a.orderCode.localeCompare(b.orderCode)).map((c) => (
                <tr key={c.id} className="border-b border-slate-200">
                  <td className={`${td} font-semibold`}>{c.orderCode}</td><td className={td}>{c.companyName || c.customerName}</td><td className={td}>{formatDate(c.earnedAt)}</td>
                  <td className={`${td} text-right`}>{formatMoney(c.profit)}</td><td className={`${td} text-right`}>{c.pct}%</td><td className={`${td} text-right font-semibold`}>{formatMoney(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-slate-600">Órdenes: {p.orderCodes.join(", ")}.</p>}
        <p className="mt-1 text-[11px] text-slate-500">Comisión calculada como porcentaje de la utilidad de cada orden (ingreso sin ISV menos costo), al quedar pagada completa.</p>
      </Box>
      <div className="rounded-lg bg-slate-100 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Monto pagado</div>
        <div className="text-3xl font-extrabold">{formatMoney(p.amount)}</div>
      </div>
      {p.notes && <p className="text-slate-600">Nota: {p.notes}</p>}
      <div className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px] text-slate-500">
        <div className="border-t border-slate-400 pt-1">Recibí conforme: {p.referrerName}</div>
        <div className="border-t border-slate-400 pt-1">{settings.name}</div>
      </div>
      <p className="text-[10.5px] text-slate-400">Comprobante interno de pago de comisiones.</p>
    </PrintShell>
  );
}
