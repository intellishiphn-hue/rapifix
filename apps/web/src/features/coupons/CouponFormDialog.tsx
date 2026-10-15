import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Shuffle } from "lucide-react";
import {
  COUPON_SCOPE_LABELS, COUPON_SCOPES, COUPON_UNIT_LABELS, COUPON_UNITS, describeCoupon, generateCouponCode, hnDayKey, normalizeCouponCode, saveCouponSchema,
  type Coupon, type CouponScope, type CouponType, type CouponUnit, type SaveCouponInput,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { useCompanies } from "@/features/companies/api";
import { saveCoupon } from "./api";

type Form = Omit<SaveCouponInput, "editing">;

const blank = (): Form => ({
  code: generateCouponCode(), name: "", description: "", type: "percent", value: 10, maxDiscount: null, minPurchase: 0, appliesTo: "all",
  units: ["shop", "carwash", "pos"], validFrom: hnDayKey(Date.now()), validUntil: null, maxUses: null, maxUsesPerCustomer: 1,
  firstVisitOnly: false, customerApplicable: true, companyId: null, excludeCompanies: true, active: true,
});

export const couponToForm = (c: Coupon): Form => ({
  code: c.code, name: c.name, description: c.description ?? "", type: c.type, value: c.value, maxDiscount: c.maxDiscount ?? null, minPurchase: c.minPurchase ?? 0,
  appliesTo: c.appliesTo, units: c.units, validFrom: c.validFrom, validUntil: c.validUntil ?? null, maxUses: c.maxUses ?? null,
  maxUsesPerCustomer: c.maxUsesPerCustomer ?? 1, firstVisitOnly: !!c.firstVisitOnly, customerApplicable: c.customerApplicable !== false,
  companyId: c.companyId ?? null, excludeCompanies: c.excludeCompanies !== false, active: c.active !== false,
});

export async function copyText(text: string, okMsg = "Copiado") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    toast.error("No se pudo copiar. Selecciónelo y cópielo a mano.");
  }
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-sm hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span><span className="font-medium text-slate-800">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

/** Crear o editar un cupón (admin y gerencia). */
export function CouponFormDialog({ open, coupon, onClose }: { open: boolean; coupon: Coupon | null; onClose: (code?: string) => void }) {
  const editing = !!coupon;
  const [f, setF] = useState<Form>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const companies = useCompanies(open);

  useEffect(() => {
    if (!open) return;
    setF(coupon ? couponToForm(coupon) : blank());
    setErrors({});
  }, [open, coupon]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleUnit = (u: CouponUnit) => set("units", f.units.includes(u) ? f.units.filter((x) => x !== u) : COUPON_UNITS.filter((x) => x === u || f.units.includes(x)));
  const company = companies.data.find((c) => c.id === f.companyId);
  const preview = describeCoupon({ ...f, companyName: company?.name });

  const submit = async () => {
    const parsed = saveCouponSchema.safeParse({ ...f, editing });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message])));
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      const r = await saveCoupon(parsed.data);
      toast.success(editing ? "Cupón actualizado" : `Cupón ${r.code} creado`);
      onClose(r.code);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open} onClose={() => onClose()} size="lg"
      title={editing ? `Editar cupón ${coupon?.code}` : "Nuevo cupón"}
      description="Descuento para taller, carwash o punto de venta. Lo aplica el cliente en su link o el personal en el panel."
      footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button onClick={() => void submit()} loading={saving}>{editing ? "Guardar cambios" : "Crear cupón"}</Button></>}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" required error={errors.code} hint={editing ? "El código no se puede cambiar." : "3 a 20 letras, números o guiones. Así lo escribe el cliente."}>
            <div className="flex gap-2">
              <Input value={f.code} onChange={(e) => set("code", normalizeCouponCode(e.target.value))} disabled={editing} maxLength={20} className="font-mono font-semibold uppercase tracking-wide" invalid={!!errors.code} />
              {!editing && <Button variant="secondary" size="icon" onClick={() => set("code", generateCouponCode(undefined, 6, f.name.split(/\s+/)[0] ?? ""))} title="Generar código" aria-label="Generar código"><Shuffle className="h-4 w-4" /></Button>}
              <Button variant="secondary" size="icon" onClick={() => void copyText(f.code, "Código copiado")} title="Copiar código" aria-label="Copiar código"><Copy className="h-4 w-4" /></Button>
            </div>
          </Field>
          <Field label="Nombre (lo ve el cliente)" required error={errors.name}>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder="Ej. Promo de aniversario" invalid={!!errors.name} />
          </Field>
          <Field label="Descripción (opcional)" className="sm:col-span-2">
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={300} placeholder="Ej. Para clientes que vienen por la campaña de Facebook" />
          </Field>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Descuento</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium text-slate-700">Tipo</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(["percent", "fixed"] as CouponType[]).map((t) => (
                  <button key={t} type="button" onClick={() => setF((x) => ({ ...x, type: t, value: t === "percent" ? Math.min(x.value, 100) || 10 : x.value > 100 ? x.value : 10000 }))}
                    className={cn("h-10 rounded-[10px] border text-sm font-semibold", f.type === t ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                    {t === "percent" ? "Porcentaje (%)" : "Monto fijo (L)"}
                  </button>
                ))}
              </div>
            </div>
            <Field label={f.type === "percent" ? "Porcentaje" : "Monto"} required error={errors.value}>
              {f.type === "percent" ? (
                <div className="relative">
                  <Input type="number" inputMode="numeric" min={1} max={100} value={f.value || ""} onChange={(e) => set("value", Math.round(Number(e.target.value) || 0))} className="pr-8 text-right" invalid={!!errors.value} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                </div>
              ) : <MoneyInput value={f.value} onChange={(v) => set("value", v)} />}
            </Field>
            <Field label="Aplica a">
              <Select value={f.appliesTo} onChange={(e) => set("appliesTo", e.target.value as CouponScope)}>
                {COUPON_SCOPES.map((s) => <option key={s} value={s}>{COUPON_SCOPE_LABELS[s]}</option>)}
              </Select>
            </Field>
            {f.type === "percent" ? (
              <Field label="Descuento máximo (opcional)" hint="Tope en lempiras. Vacío = sin tope.">
                <MoneyInput value={f.maxDiscount ?? 0} onChange={(v) => set("maxDiscount", v > 0 ? v : null)} placeholder="Sin tope" />
              </Field>
            ) : <div className="hidden sm:block" />}
            <Field label="Compra mínima (opcional)" hint="Sobre lo que cubre el cupón, sin ISV.">
              <MoneyInput value={f.minPurchase} onChange={(v) => set("minPurchase", v)} placeholder="Sin mínimo" />
            </Field>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[13px] font-medium text-slate-700">Dónde se puede usar</div>
            <div className="flex flex-wrap gap-2">
              {COUPON_UNITS.map((u) => (
                <button key={u} type="button" onClick={() => toggleUnit(u)} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", f.units.includes(u) ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>
                  {COUPON_UNIT_LABELS[u]}
                </button>
              ))}
            </div>
            {errors.units && <p className="mt-1 text-xs text-red-600">{errors.units}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Vigencia y límites</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Válido desde" required error={errors.validFrom}><Input type="date" value={f.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></Field>
            <Field label="Válido hasta (opcional)" error={errors.validUntil} hint="Incluye ese día completo.">
              <Input type="date" value={f.validUntil ?? ""} min={f.validFrom} onChange={(e) => set("validUntil", e.target.value || null)} />
            </Field>
            <Field label="Usos en total (opcional)" error={errors.maxUses} hint="Vacío = sin límite.">
              <Input type="number" inputMode="numeric" min={1} value={f.maxUses ?? ""} onChange={(e) => set("maxUses", e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)))} placeholder="Sin límite" />
            </Field>
            <Field label="Usos por cliente" hint="0 = sin límite. Se cuenta por cliente, teléfono y placa.">
              <Input type="number" inputMode="numeric" min={0} value={f.maxUsesPerCustomer} onChange={(e) => set("maxUsesPerCustomer", Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </Field>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Check checked={f.customerApplicable} onChange={(v) => set("customerApplicable", v)} label="El cliente lo puede aplicar" hint="Lo escribe en el link de su cotización o de su lavado." />
            <Check checked={f.firstVisitOnly} onChange={(v) => set("firstVisitOnly", v)} label="Solo clientes nuevos" hint="Sin órdenes, ventas ni lavados pagados antes." />
            <Check checked={f.excludeCompanies} onChange={(v) => set("excludeCompanies", v)} label="No aplica a vehículos de empresas" hint="Las empresas ya tienen precio especial." />
            <Check checked={f.active} onChange={(v) => set("active", v)} label="Activo" hint="Desactívelo para que ya no se pueda usar." />
          </div>
          <Field label="Solo para una empresa (opcional)" className="mt-4">
            <Select value={f.companyId ?? ""} onChange={(e) => set("companyId", e.target.value || null)}>
              <option value="">Cualquier cliente</option>
              {companies.data.filter((c) => c.active !== false || c.id === f.companyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="rounded-xl bg-brand-50/70 p-4 text-sm text-brand-900" data-testid="coupon-preview">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Vista previa</div>
          <p className="mt-1"><span className="font-mono font-bold">{f.code || "CODIGO"}</span>{f.name ? ` · ${f.name}` : ""}</p>
          <p className="mt-0.5 font-medium">{preview.charAt(0).toUpperCase() + preview.slice(1)}{f.customerApplicable ? "." : ". Solo lo aplica el personal."}</p>
        </div>
      </div>
    </Dialog>
  );
}
