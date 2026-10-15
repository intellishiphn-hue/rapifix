import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { AlertTriangle, Building2, Car, ClipboardCheck, UserPlus } from "lucide-react";
import {
  createWorkOrderSchema, EMPTY_RECEPTION, formatMoney, isCreditTerms, paymentTermsLabel, normalizeUnit, PRIORITIES, PRIORITY_LABELS, WORK_TYPES, WORK_TYPE_LABELS,
  type Customer, type Priority, type ReceptionInput, type Vehicle, type WorkType,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { CustomerFormDialog } from "@/features/customers/CustomerFormDialog";
import { customerRef } from "@/features/customers/api";
import { VehicleFormDialog } from "@/features/vehicles/VehicleFormDialog";
import { vehicleRef } from "@/features/vehicles/api";
import { createWorkOrder } from "./api";
import { ReceptionForm } from "./ReceptionForm";
import { TechnicianSelect } from "./TechnicianSelect";
import { VehiclePicker } from "./VehiclePicker";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { useCompany } from "@/features/companies/api";

export function NewWorkOrderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [reason, setReason] = useState("");
  const [type, setType] = useState<WorkType>("repair");
  const [priority, setPriority] = useState<Priority>("normal");
  const [techs, setTechs] = useState<string[]>([]);
  const [promised, setPromised] = useState("");
  const [reception, setReception] = useState<ReceptionInput>(EMPTY_RECEPTION);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [vehicleFor, setVehicleFor] = useState<Customer | null | undefined>(undefined);

  const selectVehicle = async (id: string) => {
    const snap = await getDoc(vehicleRef(id));
    if (snap.exists()) setVehicle({ id: snap.id, ...snap.data() } as Vehicle);
  };

  useEffect(() => {
    const id = params.get("vehiculo");
    if (id) void selectVehicle(id);
  }, [params]);

  useEffect(() => {
    if (vehicle) setReception((r) => ({ ...r, mileageIn: vehicle.mileage, mileageUnit: normalizeUnit(vehicle.odometerUnit) }));
  }, [vehicle]);

  const submit = async () => {
    const input = {
      vehicleId: vehicle?.id ?? "",
      reason,
      type,
      priority,
      technicianIds: techs,
      promisedAt: promised ? new Date(promised).toISOString() : null,
      reception,
    };
    const parsed = createWorkOrderSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path.at(-1))] = issue.message;
      setErrors(e);
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { orderId, code } = await createWorkOrder(parsed.data);
      toast.success(`Orden ${code} creada. Ahora tome las fotos de recepción.`);
      navigate(`/ordenes/${orderId}?tab=fotos`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader back={{ to: "/ordenes", label: "Órdenes" }} title="Nueva orden de trabajo" description="Recepción del vehículo. Después podrá tomar las fotos de ingreso." />
      <div className="mx-auto max-w-4xl space-y-5">
        <Card>
          <CardHeader title="1. Vehículo" description="Busque por placa. Si es nuevo, regístrelo aquí mismo." />
          <div className="p-5">
            <VehiclePicker value={vehicle} onChange={setVehicle} />
            {errors.vehicleId && <p className="mt-2 text-sm text-red-600">{errors.vehicleId}</p>}
            {vehicle?.companyId && <CompanyNotice companyId={vehicle.companyId} companyName={vehicle.companyName ?? ""} />}
            {!vehicle && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setNewCustomer(true)}>Cliente nuevo</Button>
                <Button variant="secondary" icon={<Car className="h-4 w-4" />} onClick={() => setVehicleFor(null)}>Vehículo nuevo (cliente existente)</Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="2. Motivo de ingreso" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="¿Qué reporta el cliente?" required error={errors.reason} className="sm:col-span-2">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Ej. ruido al frenar, luz de check engine encendida..." invalid={!!errors.reason} />
            </Field>
            <Field label="Tipo de trabajo">
              <Select value={type} onChange={(e) => setType(e.target.value as WorkType)}>{WORK_TYPES.map((t) => <option key={t} value={t}>{WORK_TYPE_LABELS[t]}</option>)}</Select>
            </Field>
            <Field label="Prioridad">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select>
            </Field>
            <Field label="Técnico asignado" className="sm:col-span-2">
              <TechnicianSelect value={techs} onChange={setTechs} />
            </Field>
            <Field label="Fecha prometida de entrega" hint="Opcional">
              <Input type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="3. Recepción del vehículo" description="Cómo llega el vehículo al taller." />
          <div className="p-5">
            <ReceptionForm value={reception} onChange={setReception} errors={errors} />
          </div>
        </Card>

        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button variant="secondary" onClick={() => navigate("/ordenes")}>Cancelar</Button>
          <Button size="lg" icon={<ClipboardCheck className="h-5 w-5" />} loading={saving} onClick={() => void submit()}>Crear orden</Button>
        </div>
      </div>

      <CustomerFormDialog
        open={newCustomer}
        onClose={() => setNewCustomer(false)}
        onSaved={async (id) => {
          const s = await getDoc(customerRef(id));
          if (s.exists()) setVehicleFor({ id: s.id, ...s.data() } as Customer);
        }}
      />
      <VehicleFormDialog
        open={vehicleFor !== undefined}
        onClose={() => setVehicleFor(undefined)}
        defaultCustomer={vehicleFor ?? null}
        onSaved={(id) => void selectVehicle(id)}
      />
    </>
  );
}

/** Vehículo de empresa: forma de pago y aviso si supera el límite de crédito (no bloquea). */
function CompanyNotice({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { can } = useAuth();
  const company = useCompany(companyId, can("companies.read"));
  const c = company.data;
  const over = c?.creditLimit ? (c.balanceDue ?? 0) >= c.creditLimit : false;
  return (
    <div className={cn("mt-3 flex gap-2 rounded-xl border px-3 py-2.5 text-sm", over ? "border-amber-200 bg-amber-50 text-amber-900" : "border-brand-100 bg-brand-50/60 text-slate-700")}>
      {over ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
      <div>
        <span className="font-semibold">{c?.name ?? companyName}</span>
        {c && <> · {paymentTermsLabel(c)}</>}
        {over && c?.creditLimit && <div className="mt-0.5">Supera su límite de crédito: debe {formatMoney(c.balanceDue)} de un límite de {formatMoney(c.creditLimit)}. Puede continuar; avise a administración.</div>}
        {!over && c && isCreditTerms(c) && <div className="mt-0.5 text-xs text-slate-500">La orden se puede entregar con saldo; se cobra según su forma de pago.</div>}
      </div>
    </div>
  );
}
