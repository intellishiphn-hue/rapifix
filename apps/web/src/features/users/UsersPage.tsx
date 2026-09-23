import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ShieldCheck, UserPlus } from "lucide-react";
import { createStaffUserSchema, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type CreateStaffUserInput, type Role, type UserProfile } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/common/PageHeader";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { createStaffUser, updateStaffUser, useStaffUsers } from "./api";

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { register, handleSubmit, reset, watch, formState } = useForm<CreateStaffUserInput>({
    resolver: zodResolver(createStaffUserSchema),
    defaultValues: { displayName: "", email: "", password: "", role: "reception", phone: "" },
  });
  const { errors, isSubmitting } = formState;
  const role = watch("role");

  const submit = async (v: CreateStaffUserInput) => {
    try {
      await createStaffUser(v);
      toast.success(`Usuario creado. Comparta la contraseña con ${v.displayName} de forma privada.`);
      reset();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nuevo usuario"
      description="La persona entrará con este correo y contraseña. Podrá cambiarla con '¿Olvidó su contraseña?'."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={handleSubmit(submit)} loading={isSubmitting}>Crear usuario</Button></>}
    >
      <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Nombre completo" required error={errors.displayName?.message} className="sm:col-span-2"><Input {...register("displayName")} autoFocus /></Field>
        <Field label="Correo" required error={errors.email?.message}><Input type="email" {...register("email")} autoComplete="off" /></Field>
        <Field label="Teléfono" error={errors.phone?.message}><Input {...register("phone")} inputMode="tel" /></Field>
        <Field label="Contraseña temporal" required error={errors.password?.message} hint="Mínimo 8 caracteres"><Input type="text" {...register("password")} autoComplete="new-password" /></Field>
        <Field label="Rol" required>
          <Select {...register("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">{ROLE_DESCRIPTIONS[role as Role]}</p>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function UsersPage() {
  const { user } = useAuth();
  const { data, loading, error } = useStaffUsers();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const change = async (u: UserProfile, patch: { role?: Role; active?: boolean }) => {
    setBusy(u.id);
    try {
      await updateStaffUser({ uid: u.id, ...patch });
      toast.success("Usuario actualizado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        description="Quién entra al sistema y qué puede hacer cada uno. Los permisos se aplican en el servidor, no solo en pantalla."
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo usuario</Button>}
      />
      <Card>
        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data.length ? (
          <EmptyState icon={<ShieldCheck className="h-7 w-7" />} title="Sin usuarios" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((u) => {
              const self = u.id === user?.uid;
              return (
                <li key={u.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={u.displayName} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate font-semibold">
                        {u.displayName} {self && <Badge tone="blue">Usted</Badge>} {!u.active && <Badge tone="red">Desactivado</Badge>}
                      </div>
                      <div className="truncate text-sm text-slate-500">{u.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={u.role} disabled={self || busy === u.id} onChange={(e) => void change(u, { role: e.target.value as Role })} className="w-40">
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </Select>
                    <Button variant={u.active ? "ghost" : "secondary"} size="sm" disabled={self} loading={busy === u.id} onClick={() => void change(u, { active: !u.active })}>
                      {u.active ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h3 className="font-semibold">Qué puede hacer cada rol</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-xl bg-slate-50 p-3">
              <dt className="text-sm font-semibold">{ROLE_LABELS[r]}</dt>
              <dd className="mt-0.5 text-sm text-slate-600">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
