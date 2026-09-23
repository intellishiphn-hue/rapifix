import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Vehicle } from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatKm } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { addMileage } from "./api";

export function MileageDialog({ open, onClose, vehicle }: { open: boolean; onClose: () => void; vehicle: Vehicle }) {
  const { user } = useAuth();
  const byName = useDisplayName();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(String(vehicle.mileage));
      setNote("");
    }
  }, [open, vehicle.mileage]);

  const km = Number(value);
  const invalid = value === "" || !Number.isInteger(km) || km < 0 || km > 2_000_000;
  const lower = !invalid && km < vehicle.mileage;

  const save = async () => {
    if (!user || invalid) return;
    setSaving(true);
    try {
      await addMileage(vehicle.id, km, note.trim(), user.uid, byName);
      toast.success("Kilometraje actualizado");
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
      title="Actualizar kilometraje"
      description={`Actual: ${formatKm(vehicle.mileage)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving} disabled={invalid}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nuevo kilometraje" required error={value !== "" && invalid ? "Kilometraje no válido" : undefined}>
          <Input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        {lower && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">El valor es menor al registrado. Úselo solo si se cambió el tablero u odómetro, y explíquelo en la nota.</p>}
        <Field label="Nota">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej. lectura en recepción" />
        </Field>
      </div>
    </Dialog>
  );
}
