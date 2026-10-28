import { useMemo } from "react";
import { Link } from "react-router-dom";
import { HardHat } from "lucide-react";
import { computeTechPay, formatMoney, OPEN_QUOTE_STATUSES, type WorkOrder } from "@rapifix/shared";
import { Badge } from "@/components/ui/Badge";
import { useOrderQuotes } from "@/features/quotes/api";
import { EditCostsButton } from "@/features/quotes/EditCostsDialog";
import { useOrderEarnings } from "./api";
import { ruleText } from "./format";

/**
 * Resumen "Pago a técnicos" de una orden (solo admin/gerencia; quien llama decide si se muestra).
 * Muestra lo que toca a cada técnico según la cotización aprobada vigente y su estado:
 * por cobrar (la orden aún tiene saldo), pendiente de pago, pagado o con aviso por revisar.
 */
export function OrderTechPay({ order }: { order: WorkOrder }) {
  const quotes = useOrderQuotes(order.id);
  const earnings = useOrderEarnings(order.id);
  const approved = quotes.data.find((q) => q.status === "approved") ?? null;
  const draft = !approved ? quotes.data.find((q) => OPEN_QUOTE_STATUSES.includes(q.status)) ?? null : null;
  const quote = approved ?? draft;
  const tp = useMemo(() => computeTechPay(quote?.items ?? []), [quote]);
  const byEmp = new Map(earnings.data.map((e) => [e.employeeId, e]));
  // Ganancias que ya no salen en la cotización (ej. pagadas antes de un cambio)
  const orphan = earnings.data.filter((e) => !tp.byEmployee.some((x) => x.employeeId === e.employeeId));
  if (quotes.loading || (!tp.byEmployee.length && !orphan.length)) {
    return quotes.loading ? null : (
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500" data-testid="order-techpay-empty">
        <HardHat className="h-4 w-4 text-slate-400" />
        <span className="flex-1">Sin pago a técnicos en esta orden. Se pone en cada mano de obra o servicio de la cotización.</span>
        {approved && <EditCostsButton quote={approved} label="Poner pago a técnicos" />}
      </div>
    );
  }
  return (
    <section className="border-b border-slate-100 px-5 py-4" data-testid="order-techpay">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><HardHat className="h-4 w-4 text-slate-400" />Pago a técnicos</h3>
        <span className="text-xs text-slate-500">{approved ? "Cotización aprobada" : "Borrador o cotización enviada (aún no aprobada)"} · costo interno, el cliente no lo ve</span>
        <span className="tabular ml-auto text-sm font-bold text-slate-900">{formatMoney(tp.total)}</span>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {tp.byEmployee.map((e) => {
          const earned = byEmp.get(e.employeeId);
          return (
            <li key={e.employeeId} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{e.employeeName}</span>
                {earned ? (
                  <>
                    <Badge tone={earned.status === "paid" ? "green" : "amber"}>{earned.status === "paid" ? "Pagado" : "Pendiente de pago"}</Badge>
                    {earned.needsReview && <Badge tone="red">Revisar</Badge>}
                  </>
                ) : <Badge tone="gray">{approved ? "Se gana al cobrar la orden" : "Falta aprobación"}</Badge>}
                <span className="tabular ml-auto font-semibold text-slate-900">{formatMoney(e.total)}</span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {e.lines.map((l) => (
                  <li key={l.itemId} className="flex gap-2">
                    <span className="min-w-0 flex-1 sm:truncate">{l.description} · {ruleText(l)}{l.mode === "percent" ? ` de ${formatMoney(l.base)}` : ""}</span>
                    <span className="tabular">{formatMoney(l.amount)}</span>
                  </li>
                ))}
              </ul>
              {earned?.status === "paid" && earned.total !== e.total && <p className="mt-1 text-xs text-red-700">Se le pagó {formatMoney(earned.total)}; con la cotización actual le tocan {formatMoney(e.total)}.</p>}
            </li>
          );
        })}
        {orphan.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
            <span className="font-semibold text-slate-900">{e.employeeName}</span>
            <Badge tone={e.status === "paid" ? "green" : "amber"}>{e.status === "paid" ? "Pagado" : "Pendiente de pago"}</Badge>
            {e.needsReview && <Badge tone="red">Revisar</Badge>}
            <span className="text-xs text-slate-500">Ya no tiene pago en la cotización actual</span>
            <span className="tabular ml-auto font-semibold text-slate-900">{formatMoney(e.total)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="flex-1">Se gana cuando la orden queda pagada completa y cuenta como costo en la utilidad.</span>
        <Link to="/pagos-tecnicos" className="font-semibold text-brand-700 hover:underline">Ver pagos a técnicos</Link>
        {approved && <EditCostsButton quote={approved} label="Editar pago" />}
      </div>
    </section>
  );
}
