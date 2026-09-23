import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PRIORITIES, PRIORITY_LABELS, WORK_TYPES, WORK_TYPE_LABELS, type Priority, type WorkOrder, type WorkType } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { toDate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { updateWorkOrder } from "./api";
import { TechnicianSelect } from "./TechnicianSelect";

const toLocalInput = (d: Date | null) => {
  if (!d) return "";
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

export function EditOrderDialog({ order, open, onClose }: { order: WorkOrder; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [type, setType] = useState<WorkType>("repair");
  const [priority, setPriority] = useState<Priority>("normal");
  const [techs, setTechs] = useState<string[]>([]);
  const [promised, setPromised] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason(order.reason);
    setType(order.type);
    setPriority(order.priority);
    setTechs(order.technicianIds ?? []);
    setPromised(toLocalInput(toDate(order.promisedAt)));
  }, [open, order]);

  const save = async () => {
    if (reason.trim().length < 3) {
      toast.error("Describa el motivo de ingreso");
      return;
    }
    setSaving(true);
    try {
      await updateWorkOrder({
        orderId: order.id,
        reason: reason.trim(),
        type,
        priority,
        technicianIds: techs,
        promisedAt: promised ? new Date(promised).toISOString() : null,
      });
      toast.success("Orden actualizada");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Editar orden" description={order.code} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Motivo de ingreso" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
        <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as WorkType)}>{WORK_TYPES.map((t) => <option key={t} value={t}>{WORK_TYPE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Prioridad"><Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select></Field>
        <Field label="Técnicos" className="sm:col-span-2"><TechnicianSelect value={techs} onChange={setTechs} /></Field>
        <Field label="Fecha prometida"><Input type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
