import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { getDoc } from "firebase/firestore";
import {
  FUEL_LABELS, FUEL_TYPES, TRANSMISSION_LABELS, TRANSMISSIONS, vehicleSchema,
  type Customer, type Vehicle, type VehicleInput,
} from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatPlate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { customerRef } from "@/features/customers/api";
import { CustomerPicker } from "./CustomerPicker";
import { createVehicle, findByPlate, updateVehicle } from "./api";

const MAKES = ["Toyota", "Nissan", "Honda", "Hyundai", "Kia", "Mitsubishi", "Mazda", "Ford", "Chevrolet", "Isuzu", "Suzuki", "Volkswagen", "BMW", "Mercedes-Benz", "Audi", "Jeep", "Dodge", "RAM", "Subaru", "Lexus", "Great Wall", "JAC", "Changan", "Chery"];

const empty = (customerId = ""): VehicleInput => ({
  customerId, make: "", model: "", year: new Date().getFullYear(), color: "", plate: "", vin: "",
  mileage: 0, fuelType: "gasolina", engine: "", transmission: "automatica", notes: "",
});

export function VehicleFormDialog({
  open,
  onClose,
  vehicle,
  defaultCustomer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  vehicle?: Vehicle | null;
  defaultCustomer?: Customer | null;
  onSaved?: (id: string) => void;
}) {
  const { user } = useAuth();
  const byName = useDisplayName();
  const editing = !!vehicle;
  const [owner, setOwner] = useState<Customer | null>(null);
  const [plateWarning, setPlateWarning] = useState<Vehicle | null>(null);

  const { register, handleSubmit, reset, control, setValue, formState } = useForm<VehicleInput>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: empty(),
  });
  const { errors, isSubmitting } = formState;

  useEffect(() => {
    if (!open) return;
    setPlateWarning(null);
    if (vehicle) {
      reset({
        customerId: vehicle.customerId, make: vehicle.make, model: vehicle.model, year: vehicle.year, color: vehicle.color,
        plate: formatPlate(vehicle.plate), vin: vehicle.vin, mileage: vehicle.mileage, fuelType: vehicle.fuelType,
        engine: vehicle.engine, transmission: vehicle.transmission, notes: vehicle.notes ?? "",
      });
      getDoc(customerRef(vehicle.customerId)).then((s) => s.exists() && setOwner({ id: s.id, ...s.data() } as Customer));
    } else {
      reset(empty(defaultCustomer?.id));
      setOwner(defaultCustomer ?? null);
    }
  }, [open, vehicle, defaultCustomer, reset]);

  const onSubmit = async (values: VehicleInput) => {
    if (!user || !owner) return;
    try {
      if (!plateWarning) {
        const dup = await findByPlate(values.plate);
        if (dup && dup.id !== vehicle?.id) {
          setPlateWarning(dup);
          return;
        }
      }
      if (editing) {
        await updateVehicle(vehicle.id, values, owner, vehicle.mileage, user.uid, byName);
        toast.success("Vehículo actualizado");
        onSaved?.(vehicle.id);
      } else {
        const id = await createVehicle(values, owner, user.uid, byName);
        toast.success("Vehículo registrado");
        onSaved?.(id);
      }
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? "Editar vehículo" : "Nuevo vehículo"}
      description={editing ? `${vehicle.make} ${vehicle.model} · ${formatPlate(vehicle.plate)}` : "Registre el vehículo y asígnelo a su propietario."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {plateWarning ? "Guardar de todos modos" : editing ? "Guardar cambios" : "Registrar vehículo"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {plateWarning && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
            La placa <b>{formatPlate(plateWarning.plate)}</b> ya está registrada: {plateWarning.make} {plateWarning.model} de <b>{plateWarning.customer?.fullName}</b>.
            Si el vehículo cambió de dueño, edite ese registro y cambie el propietario.
          </div>
        )}
        <Field label="Cliente propietario" required error={errors.customerId?.message} className="sm:col-span-2">
          <Controller
            control={control}
            name="customerId"
            render={({ fieldState }) => (
              <CustomerPicker
                value={owner}
                invalid={!!fieldState.error}
                onChange={(c) => {
                  setOwner(c);
                  setValue("customerId", c?.id ?? "", { shouldValidate: !!c });
                }}
              />
            )}
          />
        </Field>
        <Field label="Placa" required error={errors.plate?.message}>
          <Input {...register("plate", { onChange: () => setPlateWarning(null) })} placeholder="HAB-1234" className="uppercase" invalid={!!errors.plate} />
        </Field>
        <Field label="Marca" required error={errors.make?.message}>
          <Input {...register("make")} list="rf-makes" invalid={!!errors.make} />
          <datalist id="rf-makes">{MAKES.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="Modelo" required error={errors.model?.message}>
          <Input {...register("model")} invalid={!!errors.model} />
        </Field>
        <Field label="Año" required error={errors.year?.message}>
          <Input type="number" inputMode="numeric" {...register("year", { valueAsNumber: true })} invalid={!!errors.year} />
        </Field>
        <Field label="Color" error={errors.color?.message}>
          <Input {...register("color")} />
        </Field>
        <Field label="Kilometraje actual" required error={errors.mileage?.message}>
          <Input type="number" inputMode="numeric" {...register("mileage", { valueAsNumber: true })} invalid={!!errors.mileage} />
        </Field>
        <Field label="VIN / número de chasis" error={errors.vin?.message} className="sm:col-span-2">
          <Input {...register("vin")} className="uppercase" maxLength={17} invalid={!!errors.vin} />
        </Field>
        <Field label="Combustible">
          <Select {...register("fuelType")}>{FUEL_TYPES.map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}</Select>
        </Field>
        <Field label="Transmisión">
          <Select {...register("transmission")}>{TRANSMISSIONS.map((t) => <option key={t} value={t}>{TRANSMISSION_LABELS[t]}</option>)}</Select>
        </Field>
        <Field label="Motor" error={errors.engine?.message}>
          <Input {...register("engine")} placeholder="2.0L" />
        </Field>
        <Field label="Notas" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register("notes")} rows={2} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
