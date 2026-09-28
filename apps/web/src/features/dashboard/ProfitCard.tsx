import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp } from "lucide-react";
import { formatMoney, hnDayKey } from "@rapifix/shared";
import { Card, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Feedback";
import { useLoader } from "@/features/reports/data";
import { loadCore, loadExpenses, loadFixedExpenses } from "@/features/finance-analytics/data";
import { breakEven, monthBounds, monthFigures } from "@/features/finance-analytics/closing";

/** Tarjeta del Dashboard: utilidad estimada del mes en curso (mismo cálculo que "Cierre del mes"). */
export function ProfitCard() {
  const month = hnDayKey(Date.now()).slice(0, 7);
  const { data, loading, error } = useLoader(async () => {
    const { start, end } = monthBounds(month);
    const [core, valid, fixed] = await Promise.all([loadCore(start, end, 0), loadExpenses(start, end, 0), loadFixedExpenses([month], 0)]);
    const f = monthFigures(core, month, fixed, valid);
    return { f, be: breakEven(f, month) };
  }, `dash-profit|${month}`);

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" />Utilidad del mes (estimada)</span>}
        action={<Link to="/finanzas?tab=closing" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Cierre del mes <ArrowRight className="h-4 w-4" /></Link>}
      />
      <div className="px-5 pb-5">
        {error ? <p className="text-sm text-amber-700">No se pudo calcular: {error}</p> : loading || !data ? <Skeleton className="h-16" /> : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">Ganancia del mes (hasta hoy)</div>
              <div className={`tabular text-2xl font-bold ${data.f.net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatMoney(data.f.net)}</div>
              {data.f.fixedPending > 0 && <div className="text-[11px] text-slate-500">Incluye {formatMoney(data.f.fixedPending)} por pagar</div>}
            </div>
            <div>
              <div className="text-xs text-slate-500">Utilidad bruta</div>
              <div className="tabular text-xl font-semibold text-slate-900">{formatMoney(data.f.gross)}</div>
              <div className="text-[11px] text-slate-500">Vendimos {formatMoney(data.f.revenue)} − costo {formatMoney(data.f.cost)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Gastos fijos cubiertos</div>
              <div className="tabular text-xl font-semibold text-slate-900">{data.f.fixed <= 0 ? "—" : data.be.progress === null ? "0 %" : `${Math.min(999, Math.round(data.be.progress))} %`}</div>
              <div className="text-[11px] text-slate-500">{data.f.fixed <= 0 ? "Configure los gastos fijos" : data.be.coveredDay ? `Cubiertos el día ${data.be.coveredDay}` : `Fijos del mes ${formatMoney(data.f.fixed)}`}</div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
