import { Check, Fuel } from "lucide-react";
import { RECEPTION_CHECKLIST, type ReceptionInput } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { Field, Input, Textarea } from "@/components/ui/Field";

const FUEL_LABELS = ["Vacío", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Lleno"];

export function FuelGauge({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div>
      <div className="flex gap-1">
        {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={!onChange}
            onClick={() => onChange?.(value === n ? n - 1 : n)}
            className={cn(
              "h-9 flex-1 rounded-md border transition",
              n <= value ? (value <= 2 ? "border-red-500 bg-red-500" : value <= 4 ? "border-amber-400 bg-amber-400" : "border-emerald-500 bg-emerald-500") : "border-slate-200 bg-slate-100",
              onChange && "hover:opacity-80",
            )}
            aria-label={`Combustible ${FUEL_LABELS[n]}`}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Fuel className="h-3 w-3" /> E</span>
        <span className="font-semibold text-slate-700">{FUEL_LABELS[value]}</span>
        <span>F</span>
      </div>
    </div>
  );
}

export function ReceptionForm({
  value,
  onChange,
  errors = {},
}: {
  value: ReceptionInput;
  onChange: (v: ReceptionInput) => void;
  errors?: Record<string, string>;
}) {
  const set = <K extends keyof ReceptionInput>(k: K, v: ReceptionInput[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Kilometraje de ingreso" required error={errors.mileageIn}>
        <Input
          type="number"
          inputMode="numeric"
          value={Number.isNaN(value.mileageIn) ? "" : value.mileageIn}
          onChange={(e) => set("mileageIn", e.target.value === "" ? Number.NaN : Number(e.target.value))}
          invalid={!!errors.mileageIn}
        />
      </Field>
      <Field label="Nivel de combustible">
        <FuelGauge value={value.fuelLevel} onChange={(v) => set("fuelLevel", v)} />
      </Field>
      <div className="sm:col-span-2">
        <div className="mb-1.5 text-[13px] font-medium text-slate-700">El vehículo trae</div>
        <div className="flex flex-wrap gap-2">
          {RECEPTION_CHECKLIST.map((item) => {
            const on = value.checklist[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => set("checklist", { ...value.checklist, [item.key]: !on })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                  on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                )}
              >
                {on && <Check className="h-3.5 w-3.5" />} {item.label}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Estado exterior" hint="Golpes, rayones, vidrios, llantas">
        <Textarea value={value.exteriorNotes} onChange={(e) => set("exteriorNotes", e.target.value)} rows={2} />
      </Field>
      <Field label="Estado interior" hint="Tapicería, tablero, olores, luces encendidas">
        <Textarea value={value.interiorNotes} onChange={(e) => set("interiorNotes", e.target.value)} rows={2} />
      </Field>
      <Field label="Accesorios">
        <Input value={value.accessories} onChange={(e) => set("accessories", e.target.value)} placeholder="Radio, alfombras, cargador..." />
      </Field>
      <Field label="Otros objetos dentro del vehículo">
        <Input value={value.otherObjects} onChange={(e) => set("otherObjects", e.target.value)} />
      </Field>
    </div>
  );
}
