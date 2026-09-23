import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatMoney, PAYMENT_METHOD_LABELS, MANUAL_PAYMENT_METHODS, type Payment, type ManualPaymentMethod } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { registerPayment, voidPayment } from "./api";

export function PaymentDialog({ open, onClose, target, balance, title }: { open: boolean; onClose: (receiptId?: string) => void; target: { orderId?: string; saleId?: string }; balance: number; title: string }) {
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [received, setReceived] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setMethod("cash");
      setReference("");
      setReceived(0);
    }
  }, [open, balance]);

  const save = async () => {
    if (amount <= 0 || amount > balance) {
      toast.error(`El monto debe ser entre L 0.01 y ${formatMoney(balance)}`);
      return;
    }
    setSaving(true);
    try {
      const r = await registerPayment({ ...target, amount, method, reference: reference.trim() });
      toast.success(`Pago ${r.code} registrado${r.balance > 0 ? `. Saldo: ${formatMoney(r.balance)}` : ". Cuenta saldada"}`);
      onClose(r.paymentId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const change = method === "cash" && received > amount ? received - amount : 0;

  return (
    <Dialog open={open} onClose={() => onClose()} size="sm" title="Registrar pago" description={`${title} · saldo ${formatMoney(balance)}`} footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Registrar pago</Button></>}>
      <div className="space-y-4">
        <Field label="Monto" hint={amount < balance ? `Abono. Quedará un saldo de ${formatMoney(balance - amount)}` : "Pago total"}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Método">
          <div className="grid grid-cols-4 gap-1.5">
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${method === m ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>{PAYMENT_METHOD_LABELS[m]}</button>
            ))}
          </div>
        </Field>
        {method === "cash" ? (
          <Field label="Efectivo recibido" hint={change ? `Cambio: ${formatMoney(change)}` : "Opcional, para calcular el cambio"}><MoneyInput value={received} onChange={setReceived} /></Field>
        ) : (
          <Field label="Referencia" hint="Número de transferencia, voucher, etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
        )}
      </div>
    </Dialog>
  );
}

export function VoidPaymentDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  if (!payment) return null;
  const save = async () => {
    setSaving(true);
    try {
      await voidPayment({ paymentId: payment.id, reason: reason.trim() });
      toast.success("Pago anulado");
      setReason("");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={`Anular pago ${payment.code}`} description={`${formatMoney(payment.amount)} · ${PAYMENT_METHOD_LABELS[payment.method]}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => void save()} loading={saving} disabled={reason.trim().length < 3}>Anular</Button></>}>
      <Field label="Motivo" required hint="El pago no se borra: queda anulado en el historial."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
    </Dialog>
  );
}

