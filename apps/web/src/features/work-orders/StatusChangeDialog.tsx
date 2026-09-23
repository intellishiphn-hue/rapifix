import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { STATUS_META, type WorkOrder, type WorkOrderStatus } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatKm } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { changeWorkOrderStatus } from "./api";
import { StatusBadge } from "./StatusBadge";
import { WhatsAppComposer } from "./WhatsAppComposer";
import { messageForStatus } from "./whatsapp";

export function StatusChangeDialog({ order, to, onClose }: { order: WorkOrder; to: WorkOrderStatus | null; onClose: () => void }) {
  const { settings } = useSettings();
  const [note, setNote] = useState("");
  const [km, setKm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (to) {
      setNote("");
      setKm(String(order.reception?.mileageIn ?? ""));
      setMessage(null);
    }
  }, [to, order.reception?.mileageIn]);

  if (!to) return null;
  const cancelling = to === "CANCELLED";
  const delivering = to === "DELIVERED";
  const warnings: string[] = [];
  if (to === "AWAITING_QUOTE" && !order.diagnosis?.completedAt) warnings.push("El diagnóstico todavía no está marcado como completado.");
  if (to === "READY" && !order.qc?.passedAt) warnings.push("El control de calidad no ha sido aprobado.");
  if (delivering && (order.balance ?? 0) > 0) warnings.push("La orden tiene saldo pendiente.");

  const kmNum = Number(km);
  const kmInvalid = delivering && km !== "" && (!Number.isInteger(kmNum) || kmNum < 0);

  const submit = async () => {
    if (cancelling && !note.trim()) {
      toast.error("Indique el motivo de la cancelación");
      return;
    }
    setSaving(true);
    try {
      // Solo se envían los campos con valor (Firebase convierte undefined en null)
      await changeWorkOrderStatus({
        orderId: order.id,
        toStatus: to,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(delivering && km !== "" && !kmInvalid ? { mileageOut: kmNum } : {}),
      });
      toast.success(`Orden ${order.code}: ${STATUS_META[to].label}`);
      const msg = cancelling ? null : messageForStatus(order, to, settings);
      if (msg) setMessage(msg);
      else onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (message !== null) {
    return (
      <Dialog open onClose={onClose} title="Avisar al cliente" description="Mensaje preparado según el nuevo estado. Puede editarlo antes de enviar." footer={<Button variant="ghost" onClick={onClose}>Ahora no</Button>}>
        <WhatsAppComposer order={order} initial={message} onSent={onClose} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={cancelling ? "Cancelar orden" : "Cambiar estado"}
      description={`${order.code} · ${order.vehicle.make} ${order.vehicle.model}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Volver</Button>
          <Button variant={cancelling ? "danger" : "primary"} onClick={() => void submit()} loading={saving} disabled={kmInvalid}>
            {cancelling ? "Cancelar orden" : "Confirmar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          <ArrowRight className="h-4 w-4 text-slate-400" />
          <StatusBadge status={to} />
        </div>
        {warnings.map((w) => (
          <div key={w} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
          </div>
        ))}
        {delivering && (
          <Field label="Kilometraje de salida" hint={`Ingreso: ${formatKm(order.reception?.mileageIn ?? 0)}`} error={kmInvalid ? "Kilometraje no válido" : undefined}>
            <Input type="number" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          </Field>
        )}
        <Field label={cancelling ? "Motivo de la cancelación" : "Nota (opcional)"} required={cancelling}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder={cancelling ? "Ej. el cliente decidió no reparar" : "Se guarda en el historial"} />
        </Field>
      </div>
    </Dialog>
  );
}
