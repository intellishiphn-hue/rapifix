import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { customerSchema, formatPhone, type Customer, type CustomerInput } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { createCustomer, findByPhone, updateCustomer } from "./api";

const EMPTY: CustomerInput = {
  firstName: "", lastName: "", phone: "", whatsapp: "", email: "", idNumber: "", rtn: "",
  address: "", city: "Tegucigalpa", notes: "", status: "active",
};

function fromCustomer(c: Customer): CustomerInput {
  return {
    firstName: c.firstName, lastName: c.lastName, phone: formatPhone(c.phone), whatsapp: c.whatsapp === c.phone ? "" : formatPhone(c.whatsapp),
    email: c.email, idNumber: c.idNumber, rtn: c.rtn, address: c.address, city: c.city, notes: c.notes, status: c.status,
  };
}

export function CustomerFormDialog({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer | null;
  onSaved?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [duplicate, setDuplicate] = useState<Customer | null>(null);
  const editing = !!customer;
  const { register, handleSubmit, reset, formState } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY,
  });
  const { errors, isSubmitting } = formState;

  useEffect(() => {
    if (open) {
      reset(customer ? fromCustomer(customer) : EMPTY);
      setDuplicate(null);
    }
  }, [open, customer, reset]);

  const onSubmit = async (values: CustomerInput) => {
    if (!user) return;
    try {
      if (!editing && !duplicate) {
        const dups = await findByPhone(values.phone);
        if (dups[0]) {
          setDuplicate(dups[0]);
          return;
        }
      }
      if (editing) {
        await updateCustomer(customer.id, values, user.uid);
        toast.success("Cliente actualizado");
        onSaved?.(customer.id);
      } else {
        const id = await createCustomer(values, user.uid);
        toast.success("Cliente creado");
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
      title={editing ? "Editar cliente" : "Nuevo cliente"}
      description={editing ? customer.fullName : "Registre los datos de contacto del cliente."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {duplicate ? "Crear de todos modos" : editing ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {duplicate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
            Ya existe <b>{duplicate.fullName}</b> con ese teléfono. Verifique que no sea el mismo cliente antes de crearlo.
          </div>
        )}
        <Field label="Nombre" required error={errors.firstName?.message}>
          <Input {...register("firstName")} invalid={!!errors.firstName} autoFocus />
        </Field>
        <Field label="Apellido" required error={errors.lastName?.message}>
          <Input {...register("lastName")} invalid={!!errors.lastName} />
        </Field>
        <Field label="Teléfono" required error={errors.phone?.message}>
          <Input {...register("phone", { onChange: () => setDuplicate(null) })} inputMode="tel" placeholder="9999-8888" invalid={!!errors.phone} />
        </Field>
        <Field label="WhatsApp" error={errors.whatsapp?.message} hint="Vacío = mismo que el teléfono">
          <Input {...register("whatsapp")} inputMode="tel" placeholder="9999-8888" invalid={!!errors.whatsapp} />
        </Field>
        <Field label="Correo electrónico" error={errors.email?.message}>
          <Input {...register("email")} type="email" invalid={!!errors.email} />
        </Field>
        <Field label="Identidad" error={errors.idNumber?.message}>
          <Input {...register("idNumber")} placeholder="0801-1990-12345" />
        </Field>
        <Field label="RTN" error={errors.rtn?.message} hint="Para facturas a nombre de empresa">
          <Input {...register("rtn")} />
        </Field>
        <Field label="Ciudad" error={errors.city?.message}>
          <Input {...register("city")} />
        </Field>
        <Field label="Dirección" error={errors.address?.message} className="sm:col-span-2">
          <Input {...register("address")} />
        </Field>
        <Field label="Notas" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register("notes")} placeholder="Preferencias, horarios de contacto, etc." />
        </Field>
        {editing && (
          <Field label="Estado">
            <Select {...register("status")}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </Select>
          </Field>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
