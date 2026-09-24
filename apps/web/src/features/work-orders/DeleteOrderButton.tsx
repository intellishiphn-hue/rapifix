import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { WorkOrder } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";

const deleteWorkOrder = callable<{ orderId: string; reason: string }, { ok: boolean; code: string }>("deleteWorkOrder");

/** Eliminar la orden por completo (solo administración y gerencia). */
export function DeleteOrderButton({ order }: { order: WorkOrder }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await deleteWorkOrder({ orderId: order.id, reason: reason.trim() });
      toast.success(`Orden ${r.code} eliminada`);
      navigate("/ordenes", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setOpen(true)}>Eliminar orden</Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Eliminar la orden ${order.code}`}
        description="Se borran la orden, su historial, fotos, cotizaciones y el link del cliente. No se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Volver</Button>
            <Button className="bg-red-600 hover:bg-red-700" icon={<Trash2 className="h-4 w-4" />} loading={busy} disabled={reason.trim().length < 3} onClick={() => void run()}>Eliminar definitivamente</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-amber-50 p-3 text-amber-800">
            Si la orden tiene pagos, primero anúlelos en la pestaña Pagos. Si ya se descontaron repuestos del inventario, mejor cámbiela a <b>Cancelado</b> para no descuadrar el inventario.
          </p>
          <Field label="Motivo" hint="Queda guardado en la auditoría (ej. orden duplicada, creada por error).">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} autoFocus />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
