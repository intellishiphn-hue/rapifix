import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CreditCard, Printer } from "lucide-react";
import { formatMoney, PAYMENT_METHOD_LABELS, type Payment, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useOrderPayments } from "./api";
import { PaymentDialog, VoidPaymentDialog } from "./PaymentDialogs";

export function PaymentList({ payments, canVoid, onVoid }: { payments: Payment[]; canVoid: boolean; onVoid: (p: Payment) => void }) {
  return (
    <ul className="divide-y divide-slate-100">
      {payments.map((p) => (
        <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-5 py-3", p.status === "voided" && "opacity-60")}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-semibold">{p.code} {p.status === "voided" && <Badge tone="red">Anulado</Badge>}</div>
            <div className="text-xs text-slate-500">{[p.orderCode ?? p.saleCode, p.customerName].filter(Boolean).join(" · ")} · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ""} · {p.receivedByName} · {formatDate(p.at, true)}{p.voidReason ? ` · Motivo: ${p.voidReason}` : ""}</div>
          </div>
          <span className={cn("tabular font-bold", p.status === "voided" && "line-through")}>{formatMoney(p.amount)}</span>
          <Link to={`/imprimir/recibo/${p.id}`} target="_blank"><Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} aria-label="Imprimir recibo" /></Link>
          {canVoid && p.status === "valid" && <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Ban className="h-4 w-4" />} onClick={() => onVoid(p)} aria-label="Anular" />}
        </li>
      ))}
    </ul>
  );
}

/** Pestaña Pagos de la orden: abonos, pago total, saldo y recibos. */
export function OrderPayments({ order }: { order: WorkOrder }) {
  const { can } = useAuth();
  const canRead = can("payments.read");
  const { data, loading, error } = useOrderPayments(order.id, canRead);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const total = order.totals?.total ?? 0;
  const paid = order.paid ?? 0;
  const balance = order.balance ?? total - paid;

  if (!canRead) return <EmptyState icon={<CreditCard className="h-7 w-7" />} title="Sin acceso a pagos" description="Recepción y administración registran los pagos." />;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 p-5">
        {[["Total", total, ""], ["Pagado", paid, "text-emerald-700"], ["Saldo", balance, balance > 0 ? "text-red-600" : "text-emerald-700"]].map(([l, v, c]) => (
          <div key={String(l)} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className={`tabular text-lg font-bold ${c}`}>{formatMoney(v as number)}</div></div>
        ))}
      </div>
      {total === 0 && <p className="px-5 pb-3 text-sm text-slate-500">La orden aún no tiene total. Se toma de la cotización enviada/aprobada.</p>}
      {balance > 0 && can("sales.create") && (
        <div className="px-5 pb-4"><Button icon={<CreditCard className="h-4 w-4" />} onClick={() => setPaying(true)}>Registrar pago o abono</Button></div>
      )}
      {error ? <ErrorState message={error} /> : loading ? <div className="p-5"><Skeleton className="h-16" /></div> : !data.length ? (
        <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">Sin pagos registrados.</p>
      ) : (
        <div className="border-t border-slate-100"><PaymentList payments={data} canVoid={can("payments.void")} onVoid={setVoiding} /></div>
      )}
      <PaymentDialog open={paying} onClose={(rid) => { setPaying(false); if (rid) window.open(`/imprimir/recibo/${rid}`, "_blank"); }} target={{ orderId: order.id }} balance={balance} title={order.code} />
      <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}
