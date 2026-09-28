import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Gift, Printer } from "lucide-react";
import { computeWashCharge, formatMoney, formatPhone, VEHICLE_SIZE_LABELS, type Wash } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatPlate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { chargeWash } from "./api";
import { newPayLine, PaymentLines, payLinesError, payLinesInput, type PayLine } from "./PaymentLines";

export function ChargeDialog({ wash, onClose }: { wash: Wash | null; onClose: () => void }) {
  const [discount, setDiscount] = useState(0);
  const [lines, setLines] = useState<PayLine[]>([newPayLine(0)]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ saleId: string; code: string; earnedReward: boolean; stamps: number | null } | null>(null);

  useEffect(() => {
    if (!wash) return;
    setDiscount(0);
    setLines([newPayLine(wash.total)]);
    setDone(null);
  }, [wash?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const gross = wash ? wash.items.reduce((a, i) => a + i.price, 0) : 0;
  const charge = useMemo(
    () => (wash ? computeWashCharge(wash.items.map((i) => i.price), wash.taxRate, wash.taxMode, Math.min(discount, gross)) : null),
    [wash, discount, gross],
  );
  if (!wash || !charge) return null;
  const total = charge.totals.total;

  const save = async () => {
    if (discount > gross) return toast.error("El descuento es mayor que el total");
    const bad = payLinesError(lines, total);
    if (bad) return toast.error(bad);
    setSaving(true);
    try {
      const r = await chargeWash({ washId: wash.id, discount, payments: payLinesInput(lines) });
      setDone(r);
      toast.success(`Cobrado · venta ${r.code}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Dialog
        open
        onClose={onClose}
        size="sm"
        title={`${wash.code} cobrado`}
        description={`Venta ${done.code} · ${formatMoney(total)}`}
        footer={
          <>
            <Link to={`/imprimir/lavado/${wash.id}`} target="_blank"><Button variant="secondary" icon={<Printer className="h-4 w-4" />}>Imprimir ticket</Button></Link>
            <Button onClick={onClose}>Listo</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-600">
          <p>El pago quedó registrado y aparece en Pagos y en Finanzas como ingreso del carwash.</p>
          {done.earnedReward && (
            <p className="flex items-center gap-1.5 rounded-lg bg-violet-50 p-2.5 font-semibold text-violet-800"><Gift className="h-4 w-4" /> Completó la tarjeta: ganó un lavado gratis para su próxima visita.</p>
          )}
          <Link to={`/imprimir/venta/${done.saleId}`} target="_blank" className="inline-block font-semibold text-brand-700">Ver comprobante de venta (carta)</Link>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Cobrar ${wash.code}`}
      description={`${formatPlate(wash.plate)} · ${VEHICLE_SIZE_LABELS[wash.size]} · ${wash.customerName}${wash.phone ? ` · ${formatPhone(wash.phone)}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="lg" onClick={() => void save()} loading={saving} disabled={total <= 0}>Cobrar {formatMoney(total)}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          {wash.items.map((i) => (
            <div key={i.serviceId} className="flex justify-between gap-2">
              <span className="text-slate-700">{i.name}{i.covered === "membership" ? " · membresía" : i.covered === "reward" ? " · premio" : ""}</span>
              <span className="tabular">{i.price !== i.listPrice && <s className="mr-1.5 text-slate-400">{formatMoney(i.listPrice)}</s>}{formatMoney(i.price)}</span>
            </div>
          ))}
          <dl className="mt-2 space-y-0.5 border-t border-slate-200 pt-2">
            <div className="flex justify-between text-slate-600"><dt>Subtotal (sin ISV)</dt><dd className="tabular">{formatMoney(charge.totals.subtotal - charge.totals.discount)}</dd></div>
            <div className="flex justify-between text-slate-600"><dt>ISV ({wash.taxMode === "exempt" ? 0 : wash.taxRate}%)</dt><dd className="tabular">{formatMoney(charge.totals.tax)}</dd></div>
            <div className="flex justify-between text-lg font-extrabold"><dt>Total</dt><dd className="tabular">{formatMoney(total)}</dd></div>
          </dl>
        </div>
        <Field label="Descuento" hint={discount > 0 ? `Se descuenta ${formatMoney(Math.min(discount, gross))} del precio final.` : "Opcional."}>
          <MoneyInput value={discount} onChange={setDiscount} className="w-40" placeholder="0.00" />
        </Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Pago</div>
          <PaymentLines total={total} value={lines} onChange={setLines} />
        </div>
      </div>
    </Dialog>
  );
}
