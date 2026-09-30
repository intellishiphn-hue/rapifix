import { ODOMETER_UNIT_LABELS, ODOMETER_UNITS, type OdometerUnit } from "@rapifix/shared";
import { Select } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

/** Selector compacto "Kilómetros / Millas" para poner junto al campo de kilometraje. */
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
  return (
    <Select
      aria-label="Unidad del odómetro"
      value={value === "mi" ? "mi" : "km"}
      onChange={(e) => onChange(e.target.value as OdometerUnit)}
      disabled={disabled}
      className={cn("w-32 shrink-0", className)}
    >
      {ODOMETER_UNITS.map((u) => <option key={u} value={u}>{ODOMETER_UNIT_LABELS[u]}</option>)}
    </Select>
  );
}
