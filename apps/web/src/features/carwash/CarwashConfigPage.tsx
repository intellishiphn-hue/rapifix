import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Receipt, Save, SlidersHorizontal } from "lucide-react";
import {
  CARWASH_TAX_MODE_LABELS, CARWASH_TAX_MODES, carwashSettingsFrom, formatMoney, loyaltyText, rewardCap, VEHICLE_SIZE_LABELS, VEHICLE_SIZES,
  type CarwashSettings, type CarwashTaxMode, type RewardMode,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { useSettings } from "@/features/settings/api";
import { saveCarwashSettings, useCarwashServices, useCarwashSettings } from "./api";
import { CarwashTabs } from "./ui";

type Form = Omit<CarwashSettings, "updatedAt" | "updatedBy">;

export function CarwashConfigPage() {
  const { user, can } = useAuth();
  const state = useCarwashSettings();
  const services = useCarwashServices();
  const { settings: general } = useSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.loading || form) return;
    const { updatedAt: _a, updatedBy: _b, ...rest } = state.settings;
    setForm(rest);
  }, [state.loading, state.settings, form]);

  if (state.loading || !form) return <PageLoader />;
  if (state.error) return <ErrorState message={state.error} />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const editable = can("carwash.manage");

  const save = async () => {
    if (!user) return;
    const clean = carwashSettingsFrom(form);
    if (clean.rewardMode === "upTo" && clean.loyaltyEvery > 0 && clean.rewardMaxPrice <= 0) return toast.error("Indique hasta qué precio cubre el lavado gratis.");
    setSaving(true);
    try {
      await saveCarwashSettings(
        {
          loyaltyEvery: clean.loyaltyEvery,
          rewardMode: clean.rewardMode,
          rewardMaxPrice: clean.rewardMaxPrice,
          taxMode: clean.taxMode,
          ticketHeader: form.ticketHeader.trim().slice(0, 300),
          ticketFooter: form.ticketFooter.trim().slice(0, 300),
        },
        user.uid,
      );
      toast.success("Configuración del carwash guardada");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const preview = carwashSettingsFrom(form);

  return (
    <>
      <PageHeader
        title="Configuración del carwash"
        description="Tarjeta de lealtad, ISV y textos del ticket. Los cambios aplican a los carros que se registren desde ahora."
        actions={editable && <Button icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={saving}>Guardar</Button>}
      />
      <CarwashTabs />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Gift className="h-4 w-4 text-violet-600" /> Tarjeta de lealtad</span>} description="Se cuenta un sello por cada lavado cobrado (no cuentan los de membresía ni los premios)." />
          <div className="space-y-4 px-5 pb-5">
            <Field label="Cada cuántos lavados pagados se gana uno gratis" hint="0 = tarjeta desactivada">
              <Input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={form.loyaltyEvery}
                onChange={(e) => set("loyaltyEvery", Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))))}
                className="w-32"
                disabled={!editable}
              />
            </Field>
            {form.loyaltyEvery > 0 && (
              <>
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-slate-700">Qué cubre el lavado gratis</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Choice
                      active={form.rewardMode === "cheapest"}
                      onClick={() => set("rewardMode", "cheapest" as RewardMode)}
                      title="El lavado más barato"
                      text="Cubre el precio del lavado de menor precio para el tamaño del carro. Si elige uno más caro, paga la diferencia."
                      disabled={!editable}
                    />
                    <Choice
                      active={form.rewardMode === "upTo"}
                      onClick={() => set("rewardMode", "upTo" as RewardMode)}
                      title="Hasta un precio"
                      text="Cubre cualquier lavado hasta el monto que indique. Lo que pase de ese monto se cobra."
                      disabled={!editable}
                    />
                  </div>
                </div>
                {form.rewardMode === "upTo" && (
                  <Field label="Cubre hasta (con ISV)">
                    <MoneyInput value={form.rewardMaxPrice} onChange={(v) => set("rewardMaxPrice", v)} className="w-40" disabled={!editable} />
                  </Field>
                )}
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="mb-1 font-medium text-slate-700">Así queda el premio por tamaño</div>
                  <ul className="space-y-0.5 text-slate-600">
                    {VEHICLE_SIZES.map((s) => {
                      const cap = rewardCap(preview, services.data, s);
                      return (
                        <li key={s} className="flex justify-between gap-2">
                          <span>{VEHICLE_SIZE_LABELS[s]}</span>
                          <span className="tabular font-medium">{cap === null ? "Sin lavado con precio" : `hasta ${formatMoney(cap)}`}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">Ejemplo en el ticket y WhatsApp: "{loyaltyText(Math.max(0, preview.loyaltyEvery - 3), preview.loyaltyEvery)}"</p>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-brand-600" /> ISV de los lavados</span>} description={`Tasa de ISV del taller: ${general.taxRate}% (se cambia en Configuración general).`} />
          <div className="space-y-2 px-5 pb-5">
            {CARWASH_TAX_MODES.map((m) => (
              <Choice
                key={m}
                active={form.taxMode === m}
                onClick={() => set("taxMode", m as CarwashTaxMode)}
                title={CARWASH_TAX_MODE_LABELS[m]}
                text={
                  m === "included"
                    ? "El precio del menú es lo que paga el cliente. El sistema separa el ISV para Finanzas."
                    : m === "add"
                      ? `Al precio del menú se le suma el ${general.taxRate}% de ISV al cobrar.`
                      : "Los lavados no llevan ISV."
                }
                disabled={!editable}
              />
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-slate-600" /> Ticket del carwash</span>} description="Ticket de 80 mm que se imprime al registrar o cobrar un carro." />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Texto arriba del ticket" hint="Opcional. Ej.: horario de atención o promoción.">
              <Textarea value={form.ticketHeader} onChange={(e) => set("ticketHeader", e.target.value)} maxLength={300} rows={3} disabled={!editable} />
            </Field>
            <Field label="Texto al pie del ticket">
              <Textarea value={form.ticketFooter} onChange={(e) => set("ticketFooter", e.target.value)} maxLength={300} rows={3} disabled={!editable} />
            </Field>
          </div>
        </Card>
      </div>

      {editable && (
        <div className="mt-5 flex justify-end">
          <Button size="lg" icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={saving}>Guardar configuración</Button>
        </div>
      )}
    </>
  );
}

function Choice({ active, onClick, title, text, disabled }: { active: boolean; onClick: () => void; title: string; text: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-xl border-2 px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
        active ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300",
      )}
    >
      <span className={cn("block text-sm font-semibold", active ? "text-brand-700" : "text-slate-800")}>{title}</span>
      <span className="block text-xs text-slate-500">{text}</span>
    </button>
  );
}
