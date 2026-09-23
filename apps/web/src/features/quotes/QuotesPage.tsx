import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { formatMoney, QUOTE_STATUS_META, QUOTE_STATUSES, type QuoteStatus } from "@rapifix/shared";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useQuotesList } from "./api";
import { QuoteStatusBadge } from "./QuoteStatusBadge";

export function QuotesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [pageSize, setPageSize] = useState(30);
  const { data, loading, error, hasMore } = useQuotesList(status, pageSize);

  return (
    <>
      <PageHeader title="Cotizaciones" description="Se crean desde cada orden de trabajo, en la pestaña Cotización." />
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus | "all")} className="sm:w-60">
            <option value="all">Todas</option>
            {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_META[s].label}</option>)}
          </Select>
        </div>
        {error ? <ErrorState message={error} /> : loading && !data.length ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<FileText className="h-7 w-7" />} title="Sin cotizaciones" description="Abra una orden y use la pestaña Cotización para crear la primera." />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.map((q) => (
                <li key={q.id}>
                  <button onClick={() => navigate(`/ordenes/${q.orderId}?tab=cotizacion`)} className="flex w-full flex-col gap-1 px-5 py-3 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-28 font-bold text-brand-700">{q.code}{q.version > 1 && <span className="ml-1 text-xs font-normal text-slate-400">v{q.version}</span>}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm"><PlateTag plate={q.plate} /><span className="truncate">{q.vehicleLabel} · {q.customerName}</span></span>
                    <span className="text-xs text-slate-500">{q.orderCode} · {formatDate(q.createdAt)}</span>
                    <span className="tabular w-28 text-right font-semibold">{formatMoney(q.totals.total)}</span>
                    <QuoteStatusBadge status={q.status} />
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && <div className="border-t border-slate-100 p-3 text-center"><Button variant="ghost" onClick={() => setPageSize((p) => p + 30)}>Cargar más</Button></div>}
          </>
        )}
      </Card>
    </>
  );
}
