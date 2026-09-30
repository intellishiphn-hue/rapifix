import { type OdometerUnit } from "@rapifix/shared";
import { cn } from "@/lib/cn";

/** Interruptor compacto "km | mi" para poner a la derecha del campo de kilometraje. */
export function OdometerUnitSelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: OdometerUnit | null | undefined;
  onChange: (unit: OdometerUnit) => void;
  className?: string;
  disabled?: boolean;
}) {
  const current: OdometerUnit = value === "mi" ? "mi" : "km";
  const opts: Array<[OdometerUnit, string, string]> = [["km", "km", "Kilómetros"], ["mi", "mi", "Millas"]];
  return (
    <div role="radiogroup" aria-label="Unidad del odómetro" className={cn("flex h-10 shrink-0 rounded-lg bg-slate-100 p-1", className)}>
      {opts.map(([u, short, long]) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={current === u}
          title={long}
          disabled={disabled}
          onClick={() => onChange(u)}
          className={cn(
            "min-w-[44px] rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60",
            current === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {short}
        </button>
      ))}
    </div>
  );
}
