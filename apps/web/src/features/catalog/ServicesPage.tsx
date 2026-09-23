import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil, Plus, Search, Wrench } from "lucide-react";
import { formatMoney, serviceSchema, type Service, type ServiceInput } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { saveService, useServices } from "./api";

const EMPTY: ServiceInput = { code: "", name: "", category: "", price: 0, estimatedHours: 1, taxable: true, active: true };

function ServiceDialog({ service, onClose }: { service: Service | null | undefined; onClose: () => void }) {
  const { user } = useAuth();
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<ServiceInput>({ resolver: zodResolver(serviceSchema), defaultValues: EMPTY });
  const price = watch("price");
  useEffect(() => {
    if (service !== undefined) reset(service ? { code: service.code, name: service.name, category: service.category, price: service.price, estimatedHours: service.estimatedHours, taxable: service.taxable, active: service.active } : EMPTY);
  }, [service, reset]);
  if (service === undefined) return null;
  const submit = async (v: ServiceInput) => {
    if (!user) return;
    try {
      await saveService(service?.id ?? null, v, user.uid);
      toast.success("Servicio guardado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open onClose={onClose} title={service ? "Editar servicio" : "Nuevo servicio"} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={handleSubmit(submit)} loading={formState.isSubmitting}>Guardar</Button></>}>
      <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Nombre" required error={formState.errors.name?.message} className="sm:col-span-2"><Input {...register("name")} autoFocus placeholder="Ej. Alineado y balanceo" /></Field>
        <Field label="Código"><Input {...register("code")} className="uppercase" /></Field>
        <Field label="Categoría"><Input {...register("category")} placeholder="Frenos, suspensión, mantenimiento..." /></Field>
        <Field label="Precio" required><MoneyInput value={price} onChange={(v) => setValue("price", v)} /></Field>
        <Field label="Horas estimadas" error={formState.errors.estimatedHours?.message}><Input type="number" step="0.5" min={0} {...register("estimatedHours", { valueAsNumber: true })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("taxable")} /> Aplica ISV</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("active")} /> Activo</label>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function ServicesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<Service | null | undefined>(undefined);
  const debounced = useDebounced(search, 300);
  const { data, loading, error } = useServices(debounced, inactive);
  const manage = can("settings.write");

  return (
    <>
      <PageHeader title="Servicios" description="Mano de obra y servicios con precio fijo, para cotizar y vender más rápido." actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo servicio</Button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar servicio..." className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Mostrar inactivos</label>
        </div>
        {error ? <ErrorState message={error} /> : loading ? <div className="space-y-3 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<Wrench className="h-7 w-7" />} title="Sin servicios" description="Ej. cambio de aceite, alineado, diagnóstico computarizado, frenos." action={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo servicio</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-3 px-5 py-3", !s.active && "opacity-60")}>
                <div className="min-w-0 flex-1"><div className="truncate font-semibold">{s.name}</div><div className="text-xs text-slate-500">{[s.code, s.category, s.estimatedHours ? `${s.estimatedHours} h` : ""].filter(Boolean).join(" · ")}</div></div>
                <span className="tabular font-semibold">{formatMoney(s.price)}</span>
                {manage && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(s)} aria-label="Editar" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ServiceDialog service={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}
