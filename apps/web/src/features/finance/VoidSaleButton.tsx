import { useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { formatMoney, type Sale } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";

const voidSale = callable<{ saleId: string; reason: string }, { ok: boolean; code: string }>("voidSale");

/** Anular una venta del POS (admin y gerencia): anula sus pagos y devuelve los productos al inventario. */
export function VoidSaleButton({ sale }: { sale: Sale }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await voidSale({ saleId: sale.id, reason: reason.trim() });
      toast.success(`Venta ${r.code} anulada`);
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Ban className="h-4 w-4" />} onClick={() => setOpen(true)} aria-label="Anular venta" title="Anular venta" />
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Anular la venta ${sale.code}`}
        description={`Total ${formatMoney(sale.totals?.total ?? 0)}${sale.paid ? ` · pagado ${formatMoney(sale.paid)}` : ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Volver</Button>
            <Button className="bg-red-600 hover:bg-red-700" icon={<Ban className="h-4 w-4" />} loading={busy} disabled={reason.trim().length < 3} onClick={() => void run()}>Anular venta</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
            La venta queda marcada como anulada (no se borra). Sus pagos se anulan y los productos regresan al inventario. Sale de cuentas por cobrar y de los reportes.
          </p>
          <Field label="Motivo" hint="Ej. venta de prueba, error al registrar.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} autoFocus />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
