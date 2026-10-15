import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import {
  allocatePayment, formatMoney, validateAllocations,
  type Company, type ManualPaymentMethod,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { MethodPicker } from "@/features/finance/parts";
import { detailError, EMPTY_DETAIL, PaymentDetailFields, type PaymentDetail } from "@/features/payments/PaymentDetailFields";
import { keyLabel, registerCompanyPayment } from "./api";
import type { StatementRow } from "./statement";

/**
 * Pago de la empresa repartido entre varias órdenes. Por defecto cubre de la más vieja a la más nueva;
 * cada monto se puede cambiar a mano. Cada orden recibe su propio recibo.
 */
export function CompanyPaymentDialog({ open, onClose, company, rows }: { open: boolean; onClose: () => void; company: Company; rows: StatementRow[] }) {
  const totalDue = rows.reduce((a, r) => a + r.balance, 0);
  const [received, setReceived] = useState(totalDue);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<ManualPaymentMethod>("transfer");
  const [detail, setDetail] = useState<PaymentDetail>(EMPTY_DETAIL);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const auto = (amount: number) => {
    const r = allocatePayment(amount, rows.map((x) => ({ id: x.order.id, balance: x.balance, sortKey: x.dueKey, number: x.order.number })));
    setAmounts(Object.fromEntries(r.allocations.map((a) => [a.orderId, a.amount])));
  };

  useEffect(() => {
    if (!open) return;
    setReceived(totalDue);
    setMethod("transfer");
    setDetail(EMPTY_DETAIL);
    setNotes("");
    auto(totalDue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allocated = useMemo(() => Object.values(amounts).reduce((a, v) => a + (v || 0), 0), [amounts]);
  const diff = received - allocated;

  const save = async () => {
    const allocations = rows.map((r) => ({ orderId: r.order.id, amount: amounts[r.order.id] ?? 0 })).filter((a) => a.amount > 0);
    const bad = validateAllocations(allocations, Object.fromEntries(rows.map((r) => [r.order.id, r.balance])));
    if (bad) return void toast.error(bad);
    if (diff !== 0) return void toast.error(diff > 0 ? `Falta repartir ${formatMoney(diff)}` : `Lo repartido supera lo recibido por ${formatMoney(-diff)}`);
    const d = detailError(method, detail);
    if (d) return void toast.error(d);
    setSaving(true);
    try {
      const cash = method === "cash";
      const r = await registerCompanyPayment({
        companyId: company.id, method, reference: cash ? "" : detail.reference.trim(), allocations,
        ...(!cash && detail.bank.trim() ? { bank: detail.bank.trim() } : {}),
        ...(!cash && detail.receiptPath ? { receiptPath: detail.receiptPath } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(`Pago ${r.code} por ${formatMoney(r.amount)} registrado (${r.receipts.length} ${r.receipts.length === 1 ? "recibo" : "recibos"})`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Registrar pago de la empresa"
      description={`${company.name} · saldo ${formatMoney(totalDue)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={allocated <= 0}>Registrar {allocated > 0 ? formatMoney(allocated) : "pago"}</Button></>}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Monto recibido" hint="Se reparte de la orden más vieja a la más nueva. Puede cambiar cada monto.">
            <MoneyInput value={received} onChange={(v) => { setReceived(v); auto(v); }} />
          </Field>
          <Button variant="secondary" icon={<Wand2 className="h-4 w-4" />} onClick={() => auto(received)}>Repartir de nuevo</Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[1fr_110px_120px_150px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
            <span>Orden</span><span>Vence</span><span className="text-right">Saldo</span><span className="text-right">Abono</span>
          </div>
          <ul className="max-h-[42vh] divide-y divide-slate-100 overflow-y-auto">
            {rows.map((r) => {
              const v = amounts[r.order.id] ?? 0;
              return (
                <li key={r.order.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[1fr_110px_120px_150px]", v > 0 && "bg-brand-50/40")}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{r.order.code} <span className="font-normal text-slate-500">· {formatPlate(r.order.vehicle.plate)}</span></div>
                    <div className="truncate text-xs text-slate-500">{r.order.vehicle.make} {r.order.vehicle.model}</div>
                  </div>
                  <div className="text-right text-xs sm:text-left">
                    {r.dueKey ? <span className={r.daysOverdue > 0 ? "font-semibold text-red-600" : "text-slate-600"}>{keyLabel(r.dueKey)}</span> : <Badge tone="gray">En taller</Badge>}
                  </div>
                  <div className="tabular text-sm text-slate-700 sm:text-right"><span className="text-xs text-slate-400 sm:hidden">Saldo </span>{formatMoney(r.balance)}</div>
                  <div className="flex items-center justify-end gap-1.5">
                    <button type="button" className="text-[11px] font-semibold text-brand-700 hover:underline" onClick={() => setAmounts((a) => ({ ...a, [r.order.id]: v === r.balance ? 0 : r.balance }))}>{v === r.balance ? "Quitar" : "Todo"}</button>
                    <MoneyInput className="w-[120px]" value={v} onChange={(n) => setAmounts((a) => ({ ...a, [r.order.id]: Math.min(Math.max(0, n), r.balance) }))} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
            <span className="text-slate-600">Repartido <b className="tabular text-slate-900">{formatMoney(allocated)}</b> de {formatMoney(received)}</span>
            {diff !== 0 && <span className={cn("font-semibold", diff > 0 ? "text-amber-700" : "text-red-600")}>{diff > 0 ? `Falta repartir ${formatMoney(diff)}` : `Sobran ${formatMoney(-diff)}`}</span>}
          </div>
        </div>

        <Field label="Método"><MethodPicker value={method} onChange={setMethod} /></Field>
        <PaymentDetailFields method={method} value={detail} onChange={setDetail} />
        <Field label="Nota (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ej. pago de septiembre" /></Field>
      </div>
    </Dialog>
  );
}
