import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Pencil, Plus } from "lucide-react";
import { formatMoney, VEHICLE_SIZE_LABELS, VEHICLE_SIZES, type CarwashPlan, type VehicleSize } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Field, Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { saveCarwashPlan, useCarwashPlans, useCarwashServices, useMemberships } from "./api";
import { CarwashTabs, membershipNow } from "./ui";

export function CarwashPlansPage() {
  const plans = useCarwashPlans();
  const services = useCarwashServices();
  const memberships = useMemberships();
  const [editing, setEditing] = useState<CarwashPlan | "new" | null>(null);

  const activeByPlan = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, number>();
    for (const m of memberships.data) if (membershipNow(m, now).status === "active") map.set(m.planId, (map.get(m.planId) ?? 0) + 1);
    return map;
  }, [memberships.data]);

  if (plans.loading && !plans.data.length) return <PageLoader />;
  const nameOf = (id: string) => services.data.find((s) => s.id === id)?.name ?? "Servicio eliminado";

  return (
    <>
      <PageHeader
        title="Planes de membresía"
        description="Planes mensuales por tamaño de vehículo. La membresía se vende y se renueva en Membresías."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")} disabled={!services.data.length}>Nuevo plan</Button>}
      />
      <CarwashTabs />
      {plans.error && <Card className="mb-4"><ErrorState message={plans.error} /></Card>}
      {!services.loading && !services.data.length && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Primero cree el menú de lavados: los planes incluyen servicios del menú.</p>
      )}
      {!plans.data.length ? (
        <Card>
          <EmptyState
            icon={<BadgeCheck className="h-7 w-7" />}
            title="Sin planes"
            description="Ejemplo: Plan Turismo, L 800 al mes, 4 lavados básicos. O ilimitado."
            action={services.data.length ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>Crear plan</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => (
            <Card key={p.id} className={cn("flex flex-col p-5", !p.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{VEHICLE_SIZE_LABELS[p.size]}</div>
                </div>
                {p.active ? <Badge tone="green">Activo</Badge> : <Badge tone="gray">Inactivo</Badge>}
              </div>
              <div className="tabular mt-3 text-2xl font-extrabold text-slate-900">{formatMoney(p.price)}<span className="text-sm font-medium text-slate-500"> / mes</span></div>
              <div className="mt-1 text-sm font-medium text-slate-700">{p.washesPerMonth === null ? "Lavados ilimitados" : `${p.washesPerMonth} lavado${p.washesPerMonth === 1 ? "" : "s"} al mes`}</div>
              <ul className="mt-2 flex-1 space-y-0.5 text-sm text-slate-600">
                {p.includedServiceIds.map((id) => <li key={id}>· {nameOf(id)}</li>)}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs text-slate-500">{activeByPlan.get(p.id) ?? 0} membresías activas</span>
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)}>Editar</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <PlanDialog open={!!editing} plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
    </>
  );
}

function PlanDialog({ open, plan, onClose }: { open: boolean; plan: CarwashPlan | null; onClose: () => void }) {
  const services = useCarwashServices();
  const [name, setName] = useState("");
  const [size, setSize] = useState<VehicleSize>("turismo");
  const [price, setPrice] = useState(0);
  const [included, setIncluded] = useState<string[]>([]);
  const [unlimited, setUnlimited] = useState(false);
  const [perMonth, setPerMonth] = useState("4");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? "");
    setSize(plan?.size ?? "turismo");
    setPrice(plan?.price ?? 0);
    setIncluded(plan?.includedServiceIds ?? []);
    setUnlimited(plan ? plan.washesPerMonth === null : false);
    setPerMonth(plan?.washesPerMonth ? String(plan.washesPerMonth) : "4");
    setActive(plan?.active ?? true);
  }, [open, plan]);

  const save = async () => {
    if (name.trim().length < 2) return toast.error("Escriba el nombre del plan");
    if (price <= 0) return toast.error("Indique el precio mensual");
    if (!included.length) return toast.error("Seleccione al menos un servicio incluido");
    const n = Math.round(Number(perMonth));
    if (!unlimited && !(n >= 1 && n <= 100)) return toast.error("Lavados al mes: de 1 a 100");
    setSaving(true);
    try {
      await saveCarwashPlan({
        ...(plan ? { planId: plan.id } : {}),
        name: name.trim(), size, price, includedServiceIds: included, washesPerMonth: unlimited ? null : n, active,
      });
      toast.success(plan ? "Plan actualizado" : "Plan creado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => setIncluded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={plan ? `Editar ${plan.name}` : "Nuevo plan"}
      description="Los cambios aplican a las membresías que se vendan o renueven después."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Plan Turismo" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tamaño del vehículo">
            <Select value={size} onChange={(e) => setSize(e.target.value as VehicleSize)}>
              {VEHICLE_SIZES.map((z) => <option key={z} value={z}>{VEHICLE_SIZE_LABELS[z]}</option>)}
            </Select>
          </Field>
          <Field label="Precio mensual" required hint="Con el ISV según la configuración del carwash.">
            <MoneyInput value={price} onChange={setPrice} placeholder="0.00" />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Servicios incluidos <span className="text-red-500">*</span></div>
          <div className="flex flex-wrap gap-2">
            {services.data.filter((s) => s.active || included.includes(s.id)).map((s) => {
              const on = included.includes(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggle(s.id)} className={cn("rounded-full border px-3 py-2 text-sm font-medium", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Lavados ilimitados
          </label>
          {!unlimited && (
            <Field label="Lavados al mes">
              <Input type="number" inputMode="numeric" min={1} max={100} value={perMonth} onChange={(e) => setPerMonth(e.target.value)} />
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Activo (se puede vender)
        </label>
      </div>
    </Dialog>
  );
}
