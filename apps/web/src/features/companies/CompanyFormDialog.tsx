import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_CREDIT_DAYS, DEFAULT_MONTHLY_DUE_DAYS, PAYMENT_TERMS, PAYMENT_TERMS_HINTS, PAYMENT_TERMS_LABELS, paymentTermsDetail, saveCompanySchema,
  type Company, type PaymentTermsType, type SaveCompanyForm,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { saveCompany } from "./api";

const EMPTY: SaveCompanyForm = {
  name: "", legalName: "", rtn: "", contactName: "", contactPhone: "", contactEmail: "", address: "", notes: "", active: true,
  paymentTerms: "cash", creditDays: DEFAULT_CREDIT_DAYS, cutoffDay: null, monthlyDueDays: DEFAULT_MONTHLY_DUE_DAYS,
  creditLimit: null, discountPct: null, approverName: "", approverPhone: "",
};

function fromCompany(c: Company): SaveCompanyForm {
  return {
    name: c.name, legalName: c.legalName ?? "", rtn: c.rtn ?? "", contactName: c.contactName ?? "", contactPhone: c.contactPhone ?? "",
    contactEmail: c.contactEmail ?? "", address: c.address ?? "", notes: c.notes ?? "", active: c.active !== false,
    paymentTerms: c.paymentTerms ?? "cash", creditDays: c.creditDays ?? DEFAULT_CREDIT_DAYS, cutoffDay: c.cutoffDay ?? null,
    monthlyDueDays: c.monthlyDueDays ?? DEFAULT_MONTHLY_DUE_DAYS, creditLimit: c.creditLimit ?? null, discountPct: c.discountPct ?? null,
    approverName: c.approverName ?? "", approverPhone: c.approverPhone ?? "",
  };
}

const int = (v: string) => Math.round(Number(v) || 0);

/** Crear o editar una empresa con flota. La forma de pago y el crédito solo los cambia administración o gerencia. */
export function CompanyFormDialog({ open, company, onClose }: { open: boolean; company?: Company | null; onClose: (id?: string) => void }) {
  const { role } = useAuth();
  const canMoney = role === "admin" || role === "manager";
  const [form, setForm] = useState<SaveCompanyForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(company ? fromCompany(company) : EMPTY);
  }, [open, company]);

  const set = <K extends keyof SaveCompanyForm>(k: K, v: SaveCompanyForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const parsed = saveCompanySchema.safeParse({ ...form, ...(company ? { companyId: company.id } : {}) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      const { companyId: _c, ...rest } = parsed.data;
      const r = await saveCompany({ ...rest, ...(company ? { companyId: company.id } : {}) });
      toast.success(company ? "Empresa actualizada" : "Empresa creada");
      onClose(r.companyId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const terms = form.paymentTerms as PaymentTermsType;

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      size="lg"
      title={company ? `Editar ${company.name}` : "Nueva empresa"}
      description="Empresas que traen varios vehículos (flotas). El dueño de cada vehículo sigue siendo su cliente."
      footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}
    >
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre comercial" required error={errors.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} autoFocus placeholder="Ej. INTELLISHIP" /></Field>
          <Field label="Razón social" error={errors.legalName}><Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={120} placeholder="Ej. Grupo Logístico SACA, S.A." /></Field>
          <Field label="RTN" error={errors.rtn}><Input value={form.rtn} onChange={(e) => set("rtn", e.target.value)} maxLength={20} /></Field>
          <Field label="Estado">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Empresa activa</label>
          </Field>
          <Field label="Persona de contacto" error={errors.contactName}><Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={80} /></Field>
          <Field label="Teléfono de contacto" error={errors.contactPhone}><PhoneInput value={form.contactPhone} onChange={(v) => set("contactPhone", v)} /></Field>
          <Field label="Correo" error={errors.contactEmail}><Input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} maxLength={120} /></Field>
          <Field label="Dirección" error={errors.address}><Input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={250} /></Field>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Encargado de flota</h3>
          <p className="mb-3 text-xs text-slate-500">Opcional. Si lo indica, las cotizaciones y avisos por WhatsApp se pueden mandar a él en lugar del chofer.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" error={errors.approverName}><Input value={form.approverName} onChange={(e) => set("approverName", e.target.value)} maxLength={80} /></Field>
            <Field label="WhatsApp" error={errors.approverPhone}><PhoneInput value={form.approverPhone} onChange={(v) => set("approverPhone", v)} /></Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Forma de pago</h3>
          {!canMoney && <p className="mt-1 text-xs text-amber-700">Solo administración o gerencia cambia la forma de pago, el crédito y el descuento.</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PAYMENT_TERMS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={!canMoney}
                onClick={() => set("paymentTerms", t)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                  terms === t ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div className={cn("text-sm font-semibold", terms === t ? "text-brand-700" : "text-slate-800")}>{PAYMENT_TERMS_LABELS[t]}</div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">{PAYMENT_TERMS_HINTS[t]}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {terms === "credit" && (
              <Field label="Días de crédito" error={errors.creditDays}>
                <Input type="number" min={1} max={180} disabled={!canMoney} value={form.creditDays} onChange={(e) => set("creditDays", int(e.target.value))} />
              </Field>
            )}
            {terms === "monthly" && (
              <>
                <Field label="Día de corte" hint="Por defecto el último día del mes" error={errors.cutoffDay}>
                  <Select disabled={!canMoney} value={form.cutoffDay ?? ""} onChange={(e) => set("cutoffDay", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Último día del mes</option>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Día {d}</option>)}
                  </Select>
                </Field>
                <Field label="Días para pagar después del corte" error={errors.monthlyDueDays}>
                  <Input type="number" min={0} max={90} disabled={!canMoney} value={form.monthlyDueDays} onChange={(e) => set("monthlyDueDays", int(e.target.value))} />
                </Field>
              </>
            )}
            {terms !== "cash" && (
              <Field label="Límite de crédito" hint="Opcional. Se avisa (sin bloquear) al crear órdenes si lo supera." error={errors.creditLimit}>
                <MoneyInput disabled={!canMoney} value={form.creditLimit ?? 0} onChange={(v) => set("creditLimit", v > 0 ? v : null)} placeholder="Sin límite" />
              </Field>
            )}
            <Field label="Descuento sugerido (%)" hint="Opcional. Se ofrece al armar sus cotizaciones." error={errors.discountPct}>
              <Input type="number" min={0} max={50} step="0.5" disabled={!canMoney} value={form.discountPct ?? ""} placeholder="Ninguno" onChange={(e) => set("discountPct", e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">{paymentTermsDetail({ paymentTerms: terms, creditDays: form.creditDays, cutoffDay: form.cutoffDay, monthlyDueDays: form.monthlyDueDays })}</p>
        </section>

        <Field label="Notas" error={errors.notes}><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} rows={2} /></Field>
      </div>
    </Dialog>
  );
}
