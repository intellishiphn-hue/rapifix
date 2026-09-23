import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardCheck, Pencil, ShieldCheck, X } from "lucide-react";
import {
  PRIORITY_LABELS, QC_CHECKLIST, RECEPTION_CHECKLIST, WORK_TYPE_LABELS, receptionSchema,
  type ReceptionInput, type WorkOrder,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatKm } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { saveWorkOrderSection } from "./api";
import { EditOrderDialog } from "./EditOrderDialog";
import { FuelGauge, ReceptionForm } from "./ReceptionForm";

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value || <span className="font-normal text-slate-400">—</span>}</dd>
    </div>
  );
}

function ReceptionDialog({ order, open, onClose }: { order: WorkOrder; open: boolean; onClose: () => void }) {
  const [value, setValue] = useState<ReceptionInput>(order.reception);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setValue({ ...order.reception });
  }, [open, order.reception]);

  const save = async () => {
    const parsed = receptionSchema.safeParse(value);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path.at(-1)), i.message])));
      return;
    }
    setSaving(true);
    try {
      await saveWorkOrderSection({ orderId: order.id, section: "reception", data: parsed.data });
      toast.success("Recepción actualizada");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Recepción del vehículo" description={order.code} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <ReceptionForm value={value} onChange={setValue} errors={errors} />
    </Dialog>
  );
}

function QualityControlCard({ order }: { order: WorkOrder }) {
  const { can } = useAuth();
  const [checks, setChecks] = useState<Record<string, boolean>>(order.qc?.checklist ?? {});
  const [notes, setNotes] = useState(order.qc?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const editable = can("orders.diagnose") && order.isOpen;
  const allChecked = QC_CHECKLIST.every((c) => checks[c.key]);

  const save = async (pass: boolean) => {
    setSaving(true);
    try {
      await saveWorkOrderSection({ orderId: order.id, section: "qc", data: { checklist: checks, notes }, pass });
      toast.success(pass ? "Control de calidad aprobado" : "Control de calidad guardado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-600" /> Control de calidad</span>}
        description={order.qc?.passedAt ? `Aprobado ${formatDate(order.qc.passedAt, true)}` : "Revise cada punto antes de marcar el vehículo como listo."}
      />
      <div className="space-y-2 p-5">
        {QC_CHECKLIST.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!editable}
            onClick={() => setChecks((s) => ({ ...s, [c.key]: !s[c.key] }))}
            className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm", checks[c.key] ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white")}
          >
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", checks[c.key] ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300")}>
              {checks[c.key] && <Check className="h-3.5 w-3.5" />}
            </span>
            {c.label}
          </button>
        ))}
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} rows={2} placeholder="Observaciones de calidad" />
        {editable && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="secondary" onClick={() => void save(false)} loading={saving}>Guardar</Button>
            <Button onClick={() => void save(true)} loading={saving} disabled={!allChecked} icon={<ClipboardCheck className="h-4 w-4" />}>Aprobar calidad</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function OrderSummary({ order }: { order: WorkOrder }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [editingReception, setEditingReception] = useState(false);
  const r = order.reception;
  const canEdit = can("orders.create") && order.isOpen;
  const showQc = ["QUALITY_CONTROL", "READY", "DELIVERED"].includes(order.status) || !!order.qc;

  return (
    <div className="grid gap-5 p-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="Datos de la orden" action={canEdit && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>} />
        <dl className="grid grid-cols-2 gap-4 p-5">
          <div className="col-span-2"><Item label="Motivo de ingreso" value={<span className="whitespace-pre-line font-normal">{order.reason}</span>} /></div>
          <Item label="Tipo" value={WORK_TYPE_LABELS[order.type]} />
          <Item label="Prioridad" value={PRIORITY_LABELS[order.priority]} />
          <Item label="Técnicos" value={order.technicians?.map((t) => t.name).join(", ")} />
          <Item label="Fecha prometida" value={formatDate(order.promisedAt, true)} />
          <Item label="Ingreso" value={formatDate(order.createdAt, true)} />
          {order.deliveredAt && <Item label="Entregado" value={formatDate(order.deliveredAt, true)} />}
          {order.status === "CANCELLED" && <div className="col-span-2"><Item label="Motivo de cancelación" value={order.cancelReason} /></div>}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Recepción" action={canEdit && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditingReception(true)}>Editar</Button>} />
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <Item label="Kilometraje ingreso" value={<span className="tabular">{formatKm(r?.mileageIn ?? 0)}</span>} />
            {order.mileageOut != null && <Item label="Kilometraje salida" value={<span className="tabular">{formatKm(order.mileageOut)}</span>} />}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Combustible</div>
            <FuelGauge value={r?.fuelLevel ?? 0} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RECEPTION_CHECKLIST.map((c) => (
              <span key={c.key} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", r?.checklist?.[c.key] ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400 line-through")}>
                {r?.checklist?.[c.key] ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{c.label}
              </span>
            ))}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item label="Exterior" value={r?.exteriorNotes} />
            <Item label="Interior" value={r?.interiorNotes} />
            <Item label="Accesorios" value={r?.accessories} />
            <Item label="Otros objetos" value={r?.otherObjects} />
          </dl>
        </div>
      </Card>

      {showQc && <div className="xl:col-span-2"><QualityControlCard order={order} /></div>}

      <EditOrderDialog order={order} open={editing} onClose={() => setEditing(false)} />
      <ReceptionDialog order={order} open={editingReception} onClose={() => setEditingReception(false)} />
    </div>
  );
}
