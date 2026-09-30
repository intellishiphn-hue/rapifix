import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatOdometer, isOdometerLower, normalizeUnit, odometerNoun, type OdometerUnit, type Vehicle } from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { OdometerUnitSelect } from "@/components/common/OdometerUnitSelect";
import { addMileage } from "./api";

export function MileageDialog({ open, onClose, vehicle }: { open: boolean; onClose: () => void; vehicle: Vehicle }) {
  const { user } = useAuth();
  const byName = useDisplayName();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const vehicleUnit = normalizeUnit(vehicle.odometerUnit);
  const [unit, setUnit] = useState<OdometerUnit>(vehicleUnit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(String(vehicle.mileage));
      setNote("");
      setUnit(vehicleUnit);
    }
  }, [open, vehicle.mileage, vehicleUnit]);

  const km = Number(value);
  const invalid = value === "" || !Number.isInteger(km) || km < 0 || km > 2_000_000;
  const lower = !invalid && isOdometerLower(km, unit, vehicle.mileage, vehicleUnit);
  const noun = odometerNoun(unit).toLowerCase();

  const save = async () => {
    if (!user || invalid) return;
    setSaving(true);
    try {
      await addMileage(vehicle.id, km, unit, note.trim(), user.uid, byName);
      toast.success(`${odometerNoun(unit)} actualizado`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={`Actualizar ${noun}`}
      description={`Actual: ${formatOdometer(vehicle.mileage, vehicleUnit)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving} disabled={invalid}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={`Nuevo ${noun} (${unit})`} required error={value !== "" && invalid ? `${odometerNoun(unit)} no válido` : undefined}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </div>
            <OdometerUnitSelect value={unit} onChange={setUnit} />
          </div>
        </Field>
        {unit !== vehicleUnit && (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            El vehículo quedará en {unit === "mi" ? "millas" : "kilómetros"}. Escriba el número tal como lo marca el tablero, sin convertirlo.
          </p>
        )}
        {lower && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">El valor es menor al registrado. Úselo solo si se cambió el tablero u odómetro, y explíquelo en la nota.</p>}
        <Field label="Nota">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej. lectura en recepción" />
        </Field>
      </div>
    </Dialog>
  );
}
