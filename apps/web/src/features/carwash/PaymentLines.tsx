import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatMoney, methodNeedsBank, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type CreateSaleInput, type ManualPaymentMethod } from "@rapifix/shared";
import { newId } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { ReceiptUpload } from "@/features/payments/PaymentDetailFields";
import { useSettings } from "@/features/settings/api";

export interface PayLine { id: string; method: ManualPaymentMethod; amount: number; reference: string; bank: string; receiptPath: string | null }

export const newPayLine = (amount: number, method: ManualPaymentMethod = "cash"): PayLine => ({ id: newId(), method, amount, reference: "", bank: "", receiptPath: null });

/** Valida los pagos contra el total. Devuelve el mensaje de error o null. */
export function payLinesError(lines: PayLine[], total: number): string | null {
  const used = lines.filter((p) => p.amount > 0);
  if (!used.length) return "Agregue el pago";
  const paid = used.reduce((a, p) => a + p.amount, 0);
  if (paid !== total) return `Los pagos (${formatMoney(paid)}) deben sumar exactamente ${formatMoney(total)}`;
  const missingBank = used.find((p) => methodNeedsBank(p.method) && !p.bank.trim());
  if (missingBank) return `Indique el banco del pago por ${PAYMENT_METHOD_LABELS[missingBank.method].toLowerCase()}`;
  return null;
}

/** Pagos para la Cloud Function (sin campos vacíos: Firebase convierte undefined en null). */
export function payLinesInput(lines: PayLine[]): CreateSaleInput["payments"] {
  return lines.filter((p) => p.amount > 0).map((p) => {
    const cash = p.method === "cash";
    return {
      amount: p.amount, method: p.method, reference: cash ? "" : p.reference.trim(),
      ...(!cash && p.bank.trim() ? { bank: p.bank.trim() } : {}),
      ...(!cash && p.receiptPath ? { receiptPath: p.receiptPath } : {}),
    };
  });
}

/**
 * Métodos de pago como en el punto de venta: efectivo con cambio, tarjeta ROKI, transferencia o depósito
 * con banco y comprobante, y dividir el pago.
 */
export function PaymentLines({ total, value, onChange }: { total: number; value: PayLine[]; onChange: (v: PayLine[]) => void }) {
  const { settings } = useSettings();
  const [received, setReceived] = useState(0);
  const [touched, setTouched] = useState(false);

  // Con un solo pago, el monto sigue al total mientras no lo toquen
  useEffect(() => {
    if (!touched && value.length === 1 && value[0]!.amount !== total) onChange([{ ...value[0]!, amount: total }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, touched]);

  const upd = (id: string, patch: Partial<PayLine>) => onChange(value.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const paid = value.reduce((a, p) => a + p.amount, 0);
  const cashPaid = value.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0);
  const change = received > cashPaid && cashPaid > 0 ? received - cashPaid : 0;

  return (
    <div className="space-y-3">
      {value.map((p) => {
        const opts = methodNeedsBank(p.method) ? settings.bankAccounts ?? [] : p.method === "card" ? settings.cardTerminals ?? [] : [];
        return (
          <div key={p.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => upd(p.id, { method: m })}
                  className={cn("rounded-lg border px-2 py-2 text-xs font-semibold", p.method === m ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600")}
                >
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <MoneyInput value={p.amount} onChange={(v) => { setTouched(true); upd(p.id, { amount: v }); }} className="min-w-0 flex-1" placeholder="0.00" />
              {value.length > 1 && (
                <button type="button" onClick={() => onChange(value.filter((x) => x.id !== p.id))} className="p-2 text-slate-400 hover:text-red-600" aria-label="Quitar pago">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {p.method !== "cash" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                {(methodNeedsBank(p.method) || (p.method === "card" && opts.length > 1)) && (
                  <div className="w-40 shrink-0">
                    <Select value={p.bank} onChange={(e) => upd(p.id, { bank: e.target.value })} aria-label={p.method === "card" ? "Terminal" : "Banco"}>
                      <option value="">{p.method === "card" ? "Terminal…" : "Banco…"}</option>
                      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </div>
                )}
                <Input value={p.reference} onChange={(e) => upd(p.id, { reference: e.target.value })} placeholder={p.method === "card" ? "No. autorización" : "No. referencia"} className="min-w-0 flex-1" maxLength={80} />
                <ReceiptUpload compact value={p.receiptPath} onChange={(receiptPath) => upd(p.id, { receiptPath })} />
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {value.length < 3 ? (
          <button
            type="button"
            onClick={() => { setTouched(true); onChange([...value, newPayLine(Math.max(0, total - paid), "card")]); }}
            className="text-sm font-semibold text-brand-700"
          >
            + Dividir pago
          </button>
        ) : <span />}
        {paid !== total && <span className="text-xs font-semibold text-amber-700">Falta cuadrar: {formatMoney(total - paid)}</span>}
      </div>
      {cashPaid > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Recibido en efectivo</span>
          <MoneyInput value={received} onChange={setReceived} className="w-32" />
          {change > 0 && <b className="text-emerald-700">Cambio {formatMoney(change)}</b>}
        </div>
      )}
    </div>
  );
}
