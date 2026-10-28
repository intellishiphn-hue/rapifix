import { useParams } from "react-router-dom";
import { fmtPct, formatMoney, formatPhone, PAYMENT_METHOD_LABELS } from "@rapifix/shared";
import { formatDate } from "@/lib/format";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { useEmployeeProfiles } from "@/features/employees/api";
import { usePayoutEarnings, useTechPayout } from "@/features/tech-pay/api";
import { Box, PrintShell } from "./PrintPages";

const th = "px-2 py-1.5";
const td = "px-2 py-1.5 align-top";

/** Comprobante interno de pago a un técnico, con el detalle por orden y por trabajo. */
export function PrintTechPayoutPage() {
  const { id } = useParams();
  const { settings } = useSettings();
  const payout = useTechPayout(id);
  const items = usePayoutEarnings(id);
  const profiles = useEmployeeProfiles();
  if (payout.loading) return <PageLoader />;
  const p = payout.data;
  if (payout.error || !p) return <ErrorState message={payout.error ?? "Pago no encontrado"} />;
  const phone = profiles.data.find((x) => x.id === p.employeeId)?.phone;
  const rows = [...items.data].sort((a, b) => a.orderCode.localeCompare(b.orderCode));
  return (
    <PrintShell settings={settings} title="Pago a técnico" code={p.code} date={formatDate(p.at, true)}>
      <div className="grid grid-cols-2 gap-6">
        <Box title="Pagado a">
          <dl className="space-y-0.5">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Nombre</dt><dd className="font-medium">{p.employeeName}</dd></div>
            {phone && <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Teléfono</dt><dd className="font-medium">{formatPhone(phone)}</dd></div>}
          </dl>
        </Box>
        <Box title="Pago">
          <dl className="space-y-0.5">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Método</dt><dd className="font-medium">{PAYMENT_METHOD_LABELS[p.method]}{p.bank ? ` · ${p.bank}` : ""}</dd></div>
            {p.reference && <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Referencia</dt><dd className="font-medium">{p.reference}</dd></div>}
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Registró</dt><dd className="font-medium">{p.byName}</dd></div>
            {p.expenseCode && <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">Gasto</dt><dd className="font-medium">{p.expenseCode}</dd></div>}
          </dl>
        </Box>
      </div>
      <Box title={`Trabajos incluidos (${p.count} ${p.count === 1 ? "orden" : "órdenes"})`}>
        {rows.length ? (
          <table className="w-full border-collapse">
            <thead><tr className="bg-slate-900 text-left text-[10.5px] uppercase tracking-wide text-white"><th className={th}>Orden</th><th className={th}>Trabajo</th><th className={`${th} whitespace-nowrap text-right`}>Base sin ISV</th><th className={`${th} text-right`}>Regla</th><th className={`${th} text-right`}>Monto</th></tr></thead>
            <tbody>
              {rows.map((e) => e.lines.map((l, i) => (
                <tr key={`${e.id}-${l.itemId}`} className={i === e.lines.length - 1 ? "border-b border-slate-300" : "border-b border-slate-100"}>
                  {i === 0 && (
                    <td className={`${td} whitespace-nowrap`} rowSpan={e.lines.length}>
                      <div className="font-semibold">{e.orderCode}</div>
                      <div className="text-[10.5px] text-slate-500">{e.plate} · cobrada {formatDate(e.earnedAt)}</div>
                    </td>
                  )}
                  <td className={td}>{l.description}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{l.mode === "percent" ? formatMoney(l.base) : ""}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{l.mode === "percent" ? fmtPct(l.percent) : "Fijo por trabajo"}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>{formatMoney(l.amount)}</td>
                </tr>
              )))}
              <tr className="font-bold"><td className={td} colSpan={4}>Total</td><td className={`${td} whitespace-nowrap text-right`}>{formatMoney(p.amount)}</td></tr>
            </tbody>
          </table>
        ) : <p className="text-slate-600">Órdenes: {p.orderCodes.join(", ")}.</p>}
        <p className="mt-1 text-[11px] text-slate-500">Porcentaje sobre lo que pagó el cliente por cada trabajo, sin ISV y después de descuentos. El monto fijo es por trabajo.</p>
      </Box>
      <div className="rounded-lg bg-slate-100 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Monto pagado</div>
        <div className="text-3xl font-extrabold">{formatMoney(p.amount)}</div>
      </div>
      {p.notes && <p className="text-slate-600">Nota: {p.notes}</p>}
      <div className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px] text-slate-500">
        <div className="border-t border-slate-400 pt-1">Recibí conforme: {p.employeeName}</div>
        <div className="border-t border-slate-400 pt-1">{settings.name}</div>
      </div>
      <p className="text-[10.5px] text-slate-400">Comprobante interno de pago a técnicos. No es para el cliente.</p>
    </PrintShell>
  );
}
