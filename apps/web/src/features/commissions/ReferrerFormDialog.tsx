import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_COMMISSION_PCT, saveReferrerSchema, type Referrer, type SaveReferrerInput } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { saveReferrer } from "./api";

const EMPTY: SaveReferrerInput = { name: "", phone: "", email: "", idNumber: "", paymentMethod: "", notes: "", active: true, defaultPct: DEFAULT_COMMISSION_PCT };

/** Persona que trae clientes al taller y gana comisión. */
export function ReferrerFormDialog({ open, referrer, onClose }: { open: boolean; referrer?: Referrer | null; onClose: (id?: string) => void }) {
  const [form, setForm] = useState<SaveReferrerInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(referrer ? {
      name: referrer.name, phone: referrer.phone, email: referrer.email ?? "", idNumber: referrer.idNumber ?? "",
      paymentMethod: referrer.paymentMethod ?? "", notes: referrer.notes ?? "", active: referrer.active !== false, defaultPct: referrer.defaultPct ?? DEFAULT_COMMISSION_PCT,
    } : EMPTY);
  }, [open, referrer]);

  const set = <K extends keyof SaveReferrerInput>(k: K, v: SaveReferrerInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const parsed = saveReferrerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      const r = await saveReferrer({ ...parsed.data, ...(referrer ? { referrerId: referrer.id } : {}) });
      toast.success(referrer ? "Referido actualizado" : "Referido creado");
      onClose(r.referrerId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title={referrer ? `Editar ${referrer.name}` : "Nuevo referido"}
      description="Persona que trae clientes o empresas al taller y gana comisión."
      footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required error={errors.name} className="sm:col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} autoFocus /></Field>
        <Field label="Teléfono / WhatsApp" required error={errors.phone}><PhoneInput value={form.phone} onChange={(v) => set("phone", v)} /></Field>
        <Field label="Correo" error={errors.email}><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={120} /></Field>
        <Field label="Identidad" error={errors.idNumber}><Input value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} maxLength={20} /></Field>
        <Field label="Comisión por defecto (%)" hint="De la utilidad de cada orden" error={errors.defaultPct}>
          <Input type="number" min={0.1} max={50} step="0.5" value={form.defaultPct} onChange={(e) => set("defaultPct", Number(e.target.value) || 0)} />
        </Field>
        <Field label="Cómo se le paga" hint="Ej. Transferencia BAC cuenta 7301-XXXX, o efectivo" error={errors.paymentMethod} className="sm:col-span-2">
          <Input value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Notas" error={errors.notes} className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={1000} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Referido activo</label>
      </div>
    </Dialog>
  );
}
