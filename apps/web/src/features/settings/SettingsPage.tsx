import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Database, ImagePlus, Save } from "lucide-react";
import { formatPhone, settingsSchema, type SettingsInput } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/common/PageHeader";
import { LogoMark } from "@/components/common/Logo";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";
import { seedDemoData } from "@/features/users/api";
import { saveSettings, uploadLogo, useSettings } from "./api";

export function SettingsPage() {
  const { user, can, role } = useAuth();
  const { settings, loading, error } = useSettings();
  const canWrite = can("settings.write");
  const [logoPct, setLogoPct] = useState<number | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState } = useForm<SettingsInput>({ resolver: zodResolver(settingsSchema) });
  const { errors, isSubmitting, isDirty } = formState;

  useEffect(() => {
    if (loading) return;
    reset({
      name: settings.name, subtitle: settings.subtitle, legalName: settings.legalName, rtn: settings.rtn, address: settings.address,
      city: settings.city, phone: formatPhone(settings.phone), whatsapp: formatPhone(settings.whatsapp), email: settings.email,
      website: settings.website, hours: settings.hours, currency: settings.currency, taxRate: settings.taxRate,
      workOrderPrefix: settings.workOrderPrefix, quotePrefix: settings.quotePrefix,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settings.updatedAt?.toMillis?.()]);

  const onSubmit = async (values: SettingsInput) => {
    if (!user) return;
    try {
      await saveSettings(values, user.uid);
      toast.success("Configuración guardada");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file || !user) return;
    try {
      setLogoPct(0);
      await uploadLogo(file, user.uid, setLogoPct);
      toast.success("Logo actualizado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLogoPct(null);
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await seedDemoData();
      toast.success(`Datos demo cargados: ${r.customers} clientes y ${r.vehicles} vehículos`);
      setSeedOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSeeding(false);
    }
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Datos del taller que aparecen en documentos, portal del cliente y mensajes."
        actions={canWrite && <Button icon={<Save className="h-4 w-4" />} onClick={handleSubmit(onSubmit)} loading={isSubmitting} disabled={!isDirty}>Guardar cambios</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <fieldset disabled={!canWrite} className="space-y-5">
            <Card>
              <CardHeader title="Datos del taller" />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Nombre comercial" required error={errors.name?.message}><Input {...register("name")} /></Field>
                <Field label="Subtítulo" error={errors.subtitle?.message}><Input {...register("subtitle")} /></Field>
                <Field label="Razón social" error={errors.legalName?.message}><Input {...register("legalName")} /></Field>
                <Field label="RTN" error={errors.rtn?.message}><Input {...register("rtn")} /></Field>
                <Field label="Dirección" error={errors.address?.message} className="sm:col-span-2"><Input {...register("address")} /></Field>
                <Field label="Ciudad" error={errors.city?.message}><Input {...register("city")} /></Field>
                <Field label="Horario" error={errors.hours?.message}><Input {...register("hours")} /></Field>
              </div>
            </Card>
            <Card>
              <CardHeader title="Contacto" description="El WhatsApp se usa en el botón 'Contactar a RAPIFIX' del portal del cliente." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Teléfono" error={errors.phone?.message}><Input {...register("phone")} inputMode="tel" /></Field>
                <Field label="WhatsApp del taller" error={errors.whatsapp?.message}><Input {...register("whatsapp")} inputMode="tel" /></Field>
                <Field label="Correo" error={errors.email?.message}><Input {...register("email")} type="email" /></Field>
                <Field label="Sitio web" error={errors.website?.message}><Input {...register("website")} placeholder="rapifix.com" /></Field>
              </div>
            </Card>
            <Card>
              <CardHeader title="Impuestos y numeración" />
              <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Moneda">
                  <Select {...register("currency")}><option value="HNL">Lempiras (HNL)</option><option value="USD">Dólares (USD)</option></Select>
                </Field>
                <Field label="ISV (%)" error={errors.taxRate?.message}><Input type="number" step="0.01" {...register("taxRate", { valueAsNumber: true })} /></Field>
                <Field label="Prefijo de órdenes" error={errors.workOrderPrefix?.message} hint="Ej. OT-1024"><Input {...register("workOrderPrefix")} className="uppercase" /></Field>
                <Field label="Prefijo de cotizaciones" error={errors.quotePrefix?.message} hint="Ej. COT-0045"><Input {...register("quotePrefix")} className="uppercase" /></Field>
              </div>
            </Card>
          </fieldset>
          <button type="submit" className="hidden" />
        </form>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Logo" description="PNG con fondo transparente, idealmente horizontal." />
            <div className="p-5">
              <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
                {settings.logoUrl ? <img src={settings.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <LogoMark className="h-16 w-16" />}
              </div>
              {canWrite && (
                <>
                  <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void onLogo(e.target.files?.[0])} />
                  <Button variant="secondary" className="mt-3 w-full" icon={<ImagePlus className="h-4 w-4" />} loading={logoPct !== null} onClick={() => logoInput.current?.click()}>
                    {logoPct !== null ? `Subiendo ${logoPct}%` : settings.logoUrl ? "Cambiar logo" : "Subir logo"}
                  </Button>
                </>
              )}
            </div>
          </Card>

          {role === "admin" && (
            <Card>
              <CardHeader title="Datos de demostración" description="Clientes y vehículos de ejemplo para probar el sistema." />
              <div className="p-5">
                <p className="text-sm text-slate-600">Crea 3 clientes (Juan Pérez, María López, Carlos Hernández) y 5 vehículos. Solo se puede cargar una vez.</p>
                <Button variant="secondary" className="mt-3 w-full" icon={<Database className="h-4 w-4" />} onClick={() => setSeedOpen(true)}>Cargar datos demo</Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        onConfirm={() => void seed()}
        loading={seeding}
        title="Cargar datos de demostración"
        message="Se crearán clientes y vehículos de ejemplo marcados como demo. Puede desactivarlos o archivarlos después."
        confirmLabel="Cargar datos"
      />
    </>
  );
}
