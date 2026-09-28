import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard } from "lucide-react";
import { formatMoney, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type Payment } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { usePayments, type Range } from "./api";
import { PaymentList } from "./OrderPayments";
import { VoidPaymentDialog } from "./PaymentDialogs";
import { ProofReviewCard, usePendingProofs } from "./proofs";

const RANGES: Array<[Range, string]> = [["today", "Hoy"], ["week", "7 días"], ["month", "Este mes"], ["all", "Todo"]];

export function PaymentsPage() {
  const { can } = useAuth();
  const [range, setRange] = useState<Range>("today");
  const { data, loading, error } = usePayments(range);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const valid = data.filter((p) => p.status === "valid");
  const byMethod = useMemo(() => PAYMENT_METHODS.map((m) => ({ m, total: valid.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0) })), [valid]);
  const total = valid.reduce((a, p) => a + p.amount, 0);
  const proofs = usePendingProofs(true);

  return (
    <>
      <PageHeader title="Pagos" description="Todo lo cobrado en órdenes y ventas de mostrador." actions={
        <div className="flex rounded-[10px] bg-slate-200/70 p-1">
          {RANGES.map(([r, l]) => <button key={r} onClick={() => setRange(r)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", range === r ? "bg-white shadow-sm" : "text-slate-600")}>{l}</button>)}
        </div>
      } />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Card className="col-span-2 p-4 sm:col-span-1"><div className="text-xs text-slate-500">Total cobrado</div><div className="tabular text-2xl font-bold">{formatMoney(total)}</div></Card>
        {byMethod.map(({ m, total: t }) => <Card key={m} className="p-4"><div className="text-xs text-slate-500">{PAYMENT_METHOD_LABELS[m]}</div><div className="tabular text-lg font-semibold">{formatMoney(t)}</div></Card>)}
      </div>
      {proofs.data.length > 0 && (
        <Card className="mb-5 border-amber-200">
          <div className="border-b border-amber-100 bg-amber-50/70 px-5 py-3">
            <h2 className="font-bold text-amber-900">Comprobantes por revisar ({proofs.data.length})</h2>
            <p className="text-xs text-amber-800">Transferencias y depósitos que los clientes subieron desde su link. Revise que el dinero esté en el banco antes de aprobar.</p>
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {proofs.data.map((p) => <ProofReviewCard key={p.id} proof={p} showTarget />)}
          </div>
        </Card>
      )}
      <Card>
        {error ? <ErrorState message={error} /> : loading ? <div className="p-5"><Skeleton className="h-24" /></div> : !data.length ? (
          <EmptyState icon={<CreditCard className="h-7 w-7" />} title="Sin pagos en este período" description="Los pagos se registran en la pestaña Pagos de cada orden o en el punto de venta." action={<Link to="/pos" className="font-semibold text-brand-700">Ir al punto de venta</Link>} />
        ) : (
          <>
            <PaymentList payments={data} canVoid={can("payments.void")} onVoid={setVoiding} />
            <div className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
              {data.map((p) => p.orderCode || p.saleCode).filter(Boolean).length} movimientos · los anulados no suman
            </div>
          </>
        )}
      </Card>
      <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}
