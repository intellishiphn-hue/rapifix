import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Sparkles } from "lucide-react";
import {
  CARWASH_SERVICE_KIND_LABELS, formatMoney, VEHICLE_SIZE_LABELS, VEHICLE_SIZE_SHORT, VEHICLE_SIZES,
  type CarwashPrices, type CarwashService, type CarwashServiceKind, type CommissionType,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { reorderCarwashServices, saveCarwashService, seedCarwashMenu, useCarwashServices } from "./api";
import { CarwashTabs } from "./ui";

export function CarwashMenuPage() {
  const services = useCarwashServices();
  const [editing, setEditing] = useState<CarwashService | "new" | null>(null);
  const [newKind, setNewKind] = useState<CarwashServiceKind>("wash");
  const [seedOpen, setSeedOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [moving, setMoving] = useState(false);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await seedCarwashMenu();
      toast.success(r.created ? `Se agregaron ${r.created} servicios de ejemplo. Revise los precios.` : "El menú de ejemplo ya estaba cargado.");
      setSeedOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSeeding(false);
    }
  };

  const move = async (list: CarwashService[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    // Orden global: se intercambian dentro de su grupo y se conserva el resto
    const ids = services.data.map((s) => s.id);
    const a = ids.indexOf(list[index]!.id);
    const b = ids.indexOf(list[target]!.id);
    [ids[a], ids[b]] = [ids[b]!, ids[a]!];
    setMoving(true);
    try {
      await reorderCarwashServices({ ids });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMoving(false);
    }
  };

  const toggleActive = async (s: CarwashService) => {
    try {
      await saveCarwashService({ serviceId: s.id, name: s.name, description: s.description ?? "", kind: s.kind, prices: s.prices, minutes: s.minutes ?? 0, commission: s.commission ?? { type: "percent", value: 0 }, active: !s.active });
      toast.success(s.active ? `${s.name} desactivado` : `${s.name} activado`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (services.loading && !services.data.length) return <PageLoader />;

  const groups: Array<{ kind: CarwashServiceKind; title: string; description: string }> = [
    { kind: "wash", title: "Lavados", description: "El servicio principal. Se elige uno por carro." },
    { kind: "extra", title: "Extras", description: "Se agregan al lavado. Pueden ser varios." },
  ];

  return (
    <>
      <PageHeader
        title="Menú de lavados"
        description="Precios por tamaño de vehículo. Si deja vacío el precio de un tamaño, queda como precio a convenir."
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4" />} onClick={() => setSeedOpen(true)}>Cargar menú de ejemplo</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setNewKind("wash"); setEditing("new"); }}>Nuevo servicio</Button>
          </>
        }
      />
      <CarwashTabs />
      {services.error && <Card className="mb-4"><ErrorState message={services.error} /></Card>}

      {!services.data.length ? (
        <Card>
          <EmptyState
            icon={<ListChecks className="h-7 w-7" />}
            title="El menú está vacío"
            description="Cargue el menú de ejemplo (lavados y extras con precios sugeridos) y luego ajuste los precios, o cree sus servicios uno por uno."
            action={<Button icon={<Sparkles className="h-4 w-4" />} onClick={() => void seed()} loading={seeding}>Cargar menú de ejemplo</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const list = services.data.filter((s) => s.kind === g.kind);
            return (
              <Card key={g.kind} className="overflow-hidden">
                <CardHeader
                  title={g.title}
                  description={g.description}
                  action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => { setNewKind(g.kind); setEditing("new"); }}>Agregar</Button>}
                />
                {!list.length ? (
                  <p className="px-5 pb-5 text-sm text-slate-500">Sin {g.title.toLowerCase()}.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {list.map((s, i) => (
                      <li key={s.id} className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center", !s.active && "bg-slate-50/70")}>
                        <div className="flex items-start gap-2 sm:w-[34%]">
                          <div className="flex flex-col">
                            <button disabled={i === 0 || moving} onClick={() => void move(list, i, -1)} className="rounded p-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
                            <button disabled={i === list.length - 1 || moving} onClick={() => void move(list, i, 1)} className="rounded p-0.5 text-slate-400 hover:text-slate-800 disabled:opacity-30" aria-label="Bajar"><ArrowDown className="h-4 w-4" /></button>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900">
                              {s.name} {!s.active && <Badge tone="gray">Inactivo</Badge>}
                            </div>
                            {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
                            <p className="mt-0.5 text-xs text-slate-500">
                              {s.minutes ? `aprox. ${s.minutes} min · ` : ""}Comisión: {commissionText(s)}
                            </p>
                          </div>
                        </div>
                        <div className="grid flex-1 grid-cols-4 gap-2 text-center">
                          {VEHICLE_SIZES.map((z) => (
                            <div key={z} className="rounded-lg bg-slate-50 px-1 py-1.5">
                              <div className="text-[11px] text-slate-500">{VEHICLE_SIZE_SHORT[z]}</div>
                              <div className="tabular text-sm font-semibold text-slate-800">{typeof s.prices?.[z] === "number" ? formatMoney(s.prices[z]!) : <span className="text-xs font-medium text-amber-700">A convenir</span>}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 sm:justify-end">
                          <Button size="sm" variant="ghost" onClick={() => void toggleActive(s)}>{s.active ? "Desactivar" : "Activar"}</Button>
                          <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(s)}>Editar</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ServiceDialog service={editing === "new" ? null : editing} kind={newKind} open={!!editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        onConfirm={() => void seed()}
        loading={seeding}
        title="Cargar menú de ejemplo"
        message="Se agregan lavados y extras con precios sugeridos en lempiras (solo los que aún no existan por nombre). Después puede editar o desactivar cualquiera."
        confirmLabel="Cargar"
      />
    </>
  );
}

const commissionText = (s: CarwashService) => {
  const c = s.commission;
  if (!c || !(c.value > 0)) return "sin comisión";
  return c.type === "percent" ? `${c.value}%` : `${formatMoney(c.value)} fijo`;
};

const EMPTY_PRICES: CarwashPrices = { turismo: null, camioneta: null, pickup: null, oversize: null };

function ServiceDialog({ service, kind, open, onClose }: { service: CarwashService | null; kind: CarwashServiceKind; open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [k, setK] = useState<CarwashServiceKind>("wash");
  const [prices, setPrices] = useState<CarwashPrices>(EMPTY_PRICES);
  const [minutes, setMinutes] = useState("");
  const [cType, setCType] = useState<CommissionType>("percent");
  const [cValue, setCValue] = useState(0);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setK(service?.kind ?? kind);
    setPrices({ ...EMPTY_PRICES, ...(service?.prices ?? {}) });
    setMinutes(service?.minutes ? String(service.minutes) : "");
    setCType(service?.commission?.type ?? "percent");
    // porcentaje: se guarda como número; fijo: centavos (se edita con MoneyInput)
    setCValue(service?.commission?.value ?? 0);
    setActive(service?.active ?? true);
  }, [open, service, kind]);

  const save = async () => {
    if (name.trim().length < 2) return toast.error("Escriba el nombre");
    if (VEHICLE_SIZES.filter((z) => z !== "oversize").some((z) => prices[z] === null) && !window.confirm("Hay tamaños sin precio: quedarán como precio a convenir. ¿Continuar?")) return;
    if (cType === "percent" && cValue > 100) return toast.error("El porcentaje de comisión debe ser de 0 a 100");
    setSaving(true);
    try {
      await saveCarwashService({
        ...(service ? { serviceId: service.id } : {}),
        name: name.trim(),
        description: description.trim(),
        kind: k,
        prices,
        minutes: Math.max(0, Math.round(Number(minutes) || 0)),
        commission: { type: cType, value: cType === "percent" ? Math.max(0, cValue) : Math.round(cValue) },
        active,
      });
      toast.success(service ? "Servicio actualizado" : "Servicio creado");
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
      size="md"
      title={service ? `Editar ${service.name}` : "Nuevo servicio"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Nombre" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
          <Field label="Tipo">
            <Select value={k} onChange={(e) => setK(e.target.value as CarwashServiceKind)}>
              <option value="wash">{CARWASH_SERVICE_KIND_LABELS.wash}</option>
              <option value="extra">{CARWASH_SERVICE_KIND_LABELS.extra}</option>
            </Select>
          </Field>
        </div>
        <Field label="Descripción" hint="Opcional. Qué incluye.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} />
        </Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Precio por tamaño (con el ISV según la configuración)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {VEHICLE_SIZES.map((z) => (
              <div key={z} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                <span className="flex-1 text-sm font-medium text-slate-700">{VEHICLE_SIZE_LABELS[z]}</span>
                {prices[z] === null ? (
                  <button type="button" onClick={() => setPrices({ ...prices, [z]: 0 })} className="h-10 rounded-lg px-3 text-sm font-semibold text-amber-700 hover:bg-amber-50">A convenir</button>
                ) : (
                  <>
                    <MoneyInput value={prices[z] ?? 0} onChange={(v) => setPrices({ ...prices, [z]: v })} className="w-32" placeholder="0.00" />
                    <button type="button" onClick={() => setPrices({ ...prices, [z]: null })} className="text-xs text-slate-500 hover:text-slate-800" title="Dejar como precio a convenir">Quitar</button>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">"A convenir": al registrar el carro se escribe el precio a mano (útil para oversize).</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Duración (min)" hint="Aproximada.">
            <Input type="number" inputMode="numeric" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label="Comisión del lavador">
            <Select value={cType} onChange={(e) => { setCType(e.target.value as CommissionType); setCValue(0); }}>
              <option value="percent">Porcentaje del precio</option>
              <option value="fixed">Monto fijo</option>
            </Select>
          </Field>
          <Field label={cType === "percent" ? "Porcentaje" : "Monto"}>
            {cType === "percent" ? (
              <div className="relative">
                <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={cValue || ""} onChange={(e) => setCValue(Number(e.target.value) || 0)} className="pr-7" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
              </div>
            ) : (
              <MoneyInput value={cValue} onChange={setCValue} placeholder="0.00" />
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Activo (aparece al registrar carros)
        </label>
      </div>
    </Dialog>
  );
}
