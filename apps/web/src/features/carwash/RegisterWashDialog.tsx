import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getDoc } from "firebase/firestore";
import { AlertTriangle, BadgeCheck, Car, Check, Gift, Info, Loader2, Plus, Search, Wrench } from "lucide-react";
import {
  buildWashItems, computeWashCharge, formatMoney, formatPhone, isPendingVehicle, isPlaceholderPlate, loyaltyText, priceForSize, rewardCap, washPlate,
  WASH_STATUS_LABELS, type CarwashLookupResult, type Customer, type Vehicle, type VehicleSize, type Wash,
} from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { formatDate, formatPlate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { customerRef } from "@/features/customers/api";
import { CustomerPicker } from "@/features/vehicles/CustomerPicker";
import { useCustomerVehicles } from "@/features/vehicles/api";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useSettings } from "@/features/settings/api";
import { carwashLookup, saveWash, useCarwashServices, useCarwashSettings, useWashers } from "./api";
import { PlaceholderPlateNotice, SizePicker } from "./ui";
import { PendingPhotosField, uploadWashPhotos, usePendingPhotos } from "./photos";

interface Sel { serviceId: string; price: number }

export function RegisterWashDialog({ open, onClose, wash }: { open: boolean; onClose: (washId?: string) => void; wash?: Wash | null }) {
  const { can, user } = useAuth();
  const byName = useDisplayName();
  const { settings: general } = useSettings();
  const { settings } = useCarwashSettings();
  const services = useCarwashServices();
  const washers = useWashers();
  const editing = !!wash;
  /** fotos de ingreso opcionales (solo al registrar; al editar se agregan desde el detalle) */
  const entryPhotos = usePendingPhotos(open);

  const [plate, setPlate] = useState("");
  const [lookup, setLookup] = useState<CarwashLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [size, setSize] = useState<VehicleSize | null>(null);
  const [sizeTouched, setSizeTouched] = useState(false);
  const [sel, setSel] = useState<Sel[]>([]);
  const [washerId, setWasherId] = useState("");
  const [notes, setNotes] = useState("");
  const [useMembership, setUseMembership] = useState(false);
  const [useReward, setUseReward] = useState(false);
  const [createCustomer, setCreateCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  /** cliente del taller elegido con el buscador (nombre o teléfono) */
  const [picked, setPicked] = useState<Customer | null>(null);
  const pickedVehicles = useCustomerVehicles(picked?.id);
  const ownVehicles = pickedVehicles.data.filter((v) => !v.archived);

  useEffect(() => {
    if (!open) return;
    setPlate(wash?.plate ?? "");
    setLookup(null);
    setName(wash?.customerName ?? "");
    setPhone(wash?.phone ? formatPhone(wash.phone) : "");
    setSize(wash?.size ?? null);
    setSizeTouched(!!wash);
    setSel(wash ? wash.items.map((i) => ({ serviceId: i.serviceId, price: i.listPrice })) : []);
    setWasherId(wash?.washerId ?? "");
    setNotes(wash?.notes ?? "");
    setUseMembership(!!wash?.membershipId);
    setUseReward(!!wash?.loyaltyRedeemed);
    setCreateCustomer(false);
    setPicked(null);
    let cancelled = false;
    if (open && wash?.customerId) {
      getDoc(customerRef(wash.customerId))
        .then((snap) => !cancelled && snap.exists() && setPicked({ id: snap.id, ...snap.data() } as Customer))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [open, wash]);

  // Al elegir el cliente del taller se llenan nombre y teléfono; con un solo carro, también la placa
  const pickCustomer = (c: Customer | null) => {
    setPicked(c);
    if (!c) return;
    setName(c.fullName);
    setPhone(formatPhone(c.whatsapp || c.phone));
    setCreateCustomer(false);
  };
  const pickVehicle = (v: Vehicle) => setPlate(v.plate);
  useEffect(() => {
    if (!picked || editing || pickedVehicles.loading || plate.trim()) return;
    if (ownVehicles.length === 1) setPlate(ownVehicles[0]!.plate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.id, pickedVehicles.loading]);

  // Búsqueda por placa (vehículo del taller, última visita, lealtad, membresía y mantenimientos)
  const normalized = washPlate(plate);
  const debounced = useDebounced(normalized, 450);
  // "PENDIENTE", "SIN PLACA"...: el aviso sale de inmediato; los marcadores cortos ("SP", "NA") al dejar de escribir
  const placeholder = normalized.length >= 2 && isPlaceholderPlate(normalized) && (normalized.length >= 4 || debounced === normalized);
  useEffect(() => {
    if (!placeholder) return;
    setUseReward(false);
    setUseMembership(false);
  }, [placeholder]);
  useEffect(() => {
    if (!open || debounced.length < 3 || isPlaceholderPlate(debounced)) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setLooking(true);
    carwashLookup({ plate: debounced })
      .then((r) => {
        if (cancelled) return;
        setLookup(r);
        if (editing) return;
        const n = r.customer?.name || r.history?.customerName || "";
        const p = r.customer?.phone || r.history?.phone || "";
        if (n) setName((cur) => cur || n);
        if (p) setPhone((cur) => cur || formatPhone(p));
        const suggested = r.membership?.size ?? r.history?.size ?? null;
        if (suggested) setSize((cur) => (sizeTouched && cur ? cur : suggested));
        setUseMembership(!!r.membership?.canUse);
      })
      .catch((err) => !cancelled && toast.error(errorMessage(err)))
      .finally(() => !cancelled && setLooking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, open]);

  const washes = services.active.filter((s) => s.kind === "wash");
  const extras = services.active.filter((s) => s.kind === "extra");
  const main = sel.find((x) => services.data.find((s) => s.id === x.serviceId)?.kind === "wash");

  const toggle = (serviceId: string, kind: "wash" | "extra") => {
    const has = sel.some((x) => x.serviceId === serviceId);
    if (has) return setSel(sel.filter((x) => x.serviceId !== serviceId));
    const base = kind === "wash" ? sel.filter((x) => services.data.find((s) => s.id === x.serviceId)?.kind !== "wash") : sel;
    setSel([...(kind === "wash" ? [{ serviceId, price: 0 }] : []), ...base, ...(kind === "extra" ? [{ serviceId, price: 0 }] : [])]);
  };

  const membership = placeholder ? null : (lookup?.membership ?? null);
  const keptMembership = editing && !!wash?.membershipId && !placeholder;
  const membershipIds = useMembership ? (membership?.includedServiceIds ?? (keptMembership ? wash?.items.filter((i) => i.covered === "membership").map((i) => i.serviceId) : null) ?? null) : null;
  const rewardsAvailable = lookup?.loyalty.rewardsAvailable ?? 0;
  const canReward = !placeholder && (rewardsAvailable > 0 || (editing && !!wash?.loyaltyRedeemed));
  const cap = size ? rewardCap(settings, services.data, size) : null;

  const preview = useMemo(() => {
    if (!size || !sel.length) return { items: [], total: 0, error: null as string | null };
    try {
      const items = buildWashItems({
        size,
        selections: sel.map((x) => ({ serviceId: x.serviceId, price: x.price || null })),
        services: services.data,
        membershipServiceIds: membershipIds,
        rewardCap: useReward ? cap : null,
      });
      const total = computeWashCharge(items.map((i) => i.price), general.taxRate, settings.taxMode).totals.total;
      return { items, total, error: null };
    } catch (err) {
      return { items: [], total: 0, error: (err as Error).message };
    }
  }, [size, sel, services.data, membershipIds, useReward, cap, general.taxRate, settings.taxMode]);

  const save = async () => {
    if (normalized.length < 2) return toast.error("Escriba la placa");
    if (!size) return toast.error("Seleccione el tamaño del vehículo");
    if (!sel.length) return toast.error("Seleccione el lavado");
    if (preview.error) return toast.error(preview.error);
    if (name.trim().length < 2) return toast.error("Escriba el nombre del cliente");
    setSaving(true);
    try {
      // El servidor valida que el vehículo sea de esta placa; si el cliente no la tiene, la agrega a sus vehículos
      const current = lookup && lookup.plate === normalized ? lookup : null;
      const vehicleId = isPlaceholderPlate(normalized) ? null : (current?.vehicle?.id ?? (wash && wash.plate === normalized ? wash.vehicleId : null) ?? null);
      const customerId = picked?.id ?? current?.customer?.id ?? wash?.customerId ?? null;
      const r = await saveWash({
        ...(wash ? { washId: wash.id } : {}),
        plate: normalized,
        size,
        ...(customerId ? { customerId } : {}),
        ...(vehicleId ? { vehicleId } : {}),
        customerName: name.trim(),
        phone: phone.trim(),
        items: sel.map((x) => {
          const s = services.data.find((y) => y.id === x.serviceId);
          const needsPrice = s ? priceForSize(s, size) === null : false;
          return needsPrice ? { serviceId: x.serviceId, price: x.price } : { serviceId: x.serviceId };
        }),
        ...(washerId ? { washerId } : {}),
        notes: notes.trim(),
        useReward: useReward && !isPlaceholderPlate(normalized),
        useMembership: useMembership && !isPlaceholderPlate(normalized),
        ...(createCustomer ? { createCustomer: true } : {}),
      });
      toast.success(editing ? `Lavado ${r.code} actualizado` : `${r.code} registrado${r.paid ? " (cubierto, sin cobro)" : ` · ${formatMoney(r.total)}`}`);
      if (r.vehicleCreated) toast.info(`Placa ${formatPlate(normalized)} agregada a los vehículos del cliente en el taller`);
      // Las fotos se suben en segundo plano: el registro no espera ni falla por ellas
      const files = editing ? [] : entryPhotos.take();
      if (files.length && user) void uploadWashPhotos({ id: r.washId, code: r.code }, "entry", files, { uid: user.uid, name: byName });
      onClose(r.washId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const priceLabel = (id: string) => {
    const s = services.data.find((x) => x.id === id);
    if (!s || !size) return "";
    const p = priceForSize(s, size);
    return p === null ? "A convenir" : formatMoney(p);
  };
  const noCustomer = !picked && !lookup?.customer && !wash?.customerId;
  const lookupNow = lookup && lookup.plate === normalized ? lookup : null;
  const plateIsOwn = !!picked && ownVehicles.some((v) => v.plate === normalized);

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      size="lg"
      title={editing ? `Editar ${wash?.code}` : "Registrar carro"}
      description={editing ? "Cambie servicios, tamaño, lavador o notas antes de cobrar." : "Placa, tamaño y lavado. Lo demás es opcional."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>Cancelar</Button>
          <Button size="lg" onClick={() => void save()} loading={saving} disabled={!sel.length || !size}>
            {editing ? "Guardar cambios" : "Registrar"}{preview.items.length ? ` · ${formatMoney(preview.total)}` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Placa */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Placa <span className="text-red-500">*</span></div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <Input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="HAB 1234"
              autoFocus={!editing}
              maxLength={15}
              className="h-14 pl-10 text-2xl font-bold uppercase tracking-widest"
            />
            {looking && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-brand-600" />}
          </div>
          {placeholder ? (
            <PlaceholderPlateNotice className="mt-2" />
          ) : (
            lookup && !lookup.placeholder && <LookupSummary r={lookup} every={settings.loyaltyEvery} />
          )}
        </div>

        {/* Cliente del taller: buscar por nombre o teléfono y elegir uno de sus carros */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">
            Cliente del taller <span className="font-normal text-slate-400">· opcional, buscar por nombre o teléfono</span>
          </div>
          <CustomerPicker
            value={picked}
            onChange={pickCustomer}
            placeholder="Nombre o teléfono del cliente..."
            emptyText="No está en el taller. Escriba nombre y teléfono abajo."
            className="h-12 text-base"
          />
          {picked && (
            <div className="mt-2">
              {pickedVehicles.loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando sus vehículos...</div>
              ) : ownVehicles.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ownVehicles.map((v) => {
                    const on = v.plate === normalized;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => pickVehicle(v)}
                        className={cn("flex min-h-16 flex-col items-start justify-center gap-1 rounded-xl border-2 px-3 py-2 text-left", on ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300 active:bg-slate-50")}
                      >
                        <PlateTag plate={v.plate} className="text-sm" />
                        <span className="w-full truncate text-xs font-medium text-slate-600">
                          {isPendingVehicle(v) ? "Datos por completar" : `${v.make} ${v.model}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {normalized.length >= 2 && !plateIsOwn && lookupNow && (
                lookupNow.vehicle && lookupNow.vehicle.customerId !== picked.id ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>La placa {formatPlate(normalized)} está registrada a nombre de {lookupNow.customer?.name || "otro cliente"}. El lavado se enlaza sin cambiar el dueño.</span>
                  </p>
                ) : !lookupNow.vehicle ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-sm text-sky-900">
                    <Plus className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>La placa {formatPlate(normalized)} se agregará a los vehículos de {picked.fullName}.</span>
                  </p>
                ) : null
              )}
              {!pickedVehicles.loading && !ownVehicles.length && normalized.length < 2 && (
                <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-500">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" /> No tiene vehículos registrados: escriba la placa y se agregará a sus vehículos.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Cliente */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre del cliente" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Nombre" />
          </Field>
          <Field label="Teléfono / WhatsApp" hint="Opcional. Para avisarle cuando esté listo.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} placeholder="9999-9999" />
          </Field>
        </div>
        {noCustomer && can("carwash.charge") && phone.replace(/\D/g, "").length >= 8 && !editing && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={createCustomer} onChange={(e) => setCreateCustomer(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Guardar también como cliente del taller
          </label>
        )}

        {/* Tamaño */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Tamaño <span className="text-red-500">*</span></div>
          <SizePicker value={size} onChange={(s) => { setSize(s); setSizeTouched(true); }} />
        </div>

        {/* Servicios */}
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Lavado <span className="text-red-500">*</span></div>
          {!services.loading && !washes.length ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">No hay lavados en el menú. Gerencia los agrega en Menú y planes.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {washes.map((s) => {
                const on = sel.some((x) => x.serviceId === s.id);
                return (
                  <button key={s.id} type="button" onClick={() => toggle(s.id, "wash")} className={cn("flex items-center gap-3 rounded-xl border-2 p-3 text-left", on ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300")}>
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{s.name}</span>
                      {s.minutes > 0 && <span className="block text-xs text-slate-500">aprox. {s.minutes} min</span>}
                    </span>
                    <span className="tabular text-sm font-semibold">{priceLabel(s.id)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {extras.length > 0 && (
            <>
              <div className="mb-1.5 mt-3 text-[13px] font-medium text-slate-700">Extras</div>
              <div className="flex flex-wrap gap-2">
                {extras.map((s) => {
                  const on = sel.some((x) => x.serviceId === s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggle(s.id, "extra")} className={cn("rounded-full border px-3 py-2 text-sm font-medium", on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
                      {s.name} <span className={cn("tabular", on ? "text-white/80" : "text-slate-500")}>{priceLabel(s.id)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {size && sel.filter((x) => { const s = services.data.find((y) => y.id === x.serviceId); return s && priceForSize(s, size) === null; }).map((x) => (
            <div key={x.serviceId} className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm">
              <span className="font-medium text-amber-900">Precio a convenir: {services.data.find((s) => s.id === x.serviceId)?.name}</span>
              <MoneyInput value={x.price} onChange={(v) => setSel(sel.map((y) => (y.serviceId === x.serviceId ? { ...y, price: v } : y)))} className="w-36" placeholder="0.00" />
            </div>
          ))}
        </div>

        {/* Membresía y premio */}
        {(membership || keptMembership) && (
          <label className={cn("flex items-start gap-3 rounded-xl border p-3", useMembership ? "border-emerald-300 bg-emerald-50" : "border-slate-200")}>
            <input type="checkbox" checked={useMembership} onChange={(e) => setUseMembership(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300" disabled={!!membership && !membership.canUse && !keptMembership} />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-900"><BadgeCheck className="h-4 w-4 text-emerald-600" /> Usar membresía{membership ? ` ${membership.code} · ${membership.planName}` : ""}</span>
              {membership && (
                <span className="block text-slate-600">
                  Incluye: {membership.includedNames.join(", ") || "servicios del plan"}. {membership.washesPerMonth === null ? "Ilimitado" : `Usados ${membership.usedInPeriod} de ${membership.washesPerMonth} este mes`}. Vence {formatDate(new Date(membership.paidUntil))}.
                </span>
              )}
              {membership && !membership.canUse && !keptMembership && <span className="block font-medium text-amber-700">Ya usó todos los lavados del mes: este se cobra normal.</span>}
            </span>
          </label>
        )}
        {canReward && settings.loyaltyEvery > 0 && (
          <label className={cn("flex items-start gap-3 rounded-xl border p-3", useReward ? "border-violet-300 bg-violet-50" : "border-slate-200")}>
            <input type="checkbox" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300" />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-900"><Gift className="h-4 w-4 text-violet-600" /> Aplicar lavado gratis (premio de lealtad)</span>
              <span className="block text-slate-600">
                {cap ? `Cubre el lavado hasta ${formatMoney(cap)}.` : "Configure el premio en Configuración carwash."} Los extras se cobran.
                {rewardsAvailable > 0 && ` Tiene ${rewardsAvailable} disponible${rewardsAvailable > 1 ? "s" : ""}.`}
              </span>
            </span>
          </label>
        )}

        {/* Lavador y notas */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lavador" hint="Opcional. Se puede asignar después.">
            <Select value={washerId} onChange={(e) => setWasherId(e.target.value)}>
              <option value="">Sin asignar</option>
              {washers.washers.length > 0 && (
                <optgroup label="Lavadores">{washers.washers.map((w) => <option key={w.id} value={w.id}>{w.displayName}</option>)}</optgroup>
              )}
              {washers.others.length > 0 && (
                <optgroup label="Otro personal">{washers.others.map((w) => <option key={w.id} value={w.id}>{w.displayName}</option>)}</optgroup>
              )}
            </Select>
          </Field>
          <Field label="Notas" hint="Rayones, golpes, objetos de valor dentro del carro.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </Field>
        </div>

        {!editing && <PendingPhotosField photos={entryPhotos.photos} onAdd={entryPhotos.add} onRemove={entryPhotos.remove} />}

        {/* Resumen */}
        {preview.error && sel.length > 0 && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{preview.error}</p>}
        {preview.items.length > 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            {preview.items.map((i) => (
              <div key={i.serviceId} className="flex justify-between gap-2">
                <span className="text-slate-700">{i.name}{i.covered === "membership" ? " · membresía" : i.covered === "reward" ? " · premio" : ""}</span>
                <span className="tabular">{i.price !== i.listPrice && <s className="mr-1.5 text-slate-400">{formatMoney(i.listPrice)}</s>}{formatMoney(i.price)}</span>
              </div>
            ))}
            <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold">
              <span>Total a cobrar</span>
              <span className="tabular">{formatMoney(preview.total)}</span>
            </div>
            <div className="text-xs text-slate-500">{settings.taxMode === "included" ? "Precio con ISV incluido." : settings.taxMode === "add" ? `Incluye ISV (${general.taxRate}%).` : "Sin ISV."}</div>
          </div>
        )}
        {main === undefined && sel.length > 0 && <p className="text-xs text-slate-500">Solo extras seleccionados (sin lavado principal).</p>}
      </div>
    </Dialog>
  );
}

function LookupSummary({ r, every }: { r: CarwashLookupResult; every: number }) {
  const oil = r.maintenance.find((m) => /aceite/i.test(m.serviceName));
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {r.vehicle ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700"><Car className="h-4 w-4" /> {r.vehicle.label} · {r.customer?.name ?? ""}</span>
        ) : r.history ? (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Cliente del carwash · {r.history.totalWashes} visita{r.history.totalWashes === 1 ? "" : "s"}</span>
        ) : (
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">Placa nueva: {formatPlate(r.plate)}</span>
        )}
        {r.membership && <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700"><BadgeCheck className="h-4 w-4" /> Membresía activa</span>}
        {every > 0 && (r.loyalty.count > 0 || r.loyalty.rewardsAvailable > 0) && (
          <span className={cn("inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold", r.loyalty.rewardsAvailable > 0 ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-700")}>
            <Gift className="h-4 w-4" />
            {r.loyalty.rewardsAvailable > 0 ? "Premio disponible" : `${r.loyalty.count}/${every} sellos`}
          </span>
        )}
      </div>
      {every > 0 && <Stamps count={Math.min(every - 1, r.loyalty.count + (r.loyalty.isNew ? r.loyalty.startStamps : 0))} every={every} gift={r.loyalty.isNew ? r.loyalty.startStamps : 0} />}
      {every > 0 && r.loyalty.isNew && r.loyalty.startStamps > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-sm font-medium text-violet-800">
          <Gift className="h-4 w-4 shrink-0" /> Tarjeta nueva: arranca con {r.loyalty.startStamps} sello{r.loyalty.startStamps === 1 ? "" : "s"} de regalo
          {r.loyalty.count === 0 ? ` (con su primer lavado cobrado queda en ${Math.min(every, r.loyalty.startStamps + 1)} de ${every})` : ""}.
        </p>
      )}
      {r.openWash && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" /> Esta placa ya está en la cola ({r.openWash.code}, {WASH_STATUS_LABELS[r.openWash.status].toLowerCase()}).
        </p>
      )}
      {r.maintenance.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-sm text-sky-900">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>Ofrecer en el taller:</b> {oil ? "le toca cambio de aceite" : r.maintenance.map((m) => m.serviceName).join(", ")}
            {oil && r.maintenance.length > 1 ? ` y ${r.maintenance.filter((m) => m !== oil).map((m) => m.serviceName.toLowerCase()).join(", ")}` : ""}.
          </span>
        </p>
      )}
      {every > 0 && r.loyalty.count === 0 && r.loyalty.rewardsAvailable === 0 && r.history && !(r.loyalty.isNew && r.loyalty.startStamps > 0) && <p className="text-xs text-slate-500">{loyaltyText(0, every)}</p>}
    </div>
  );
}

/** Sellos de la tarjeta de lealtad (círculos). */
export function Stamps({ count, every, gift = 0 }: { count: number; every: number; gift?: number }) {
  if (!(every > 0) || every > 20) return null;
  return (
    <div className="flex flex-wrap gap-1" aria-label={`${count} de ${every} sellos`}>
      {Array.from({ length: every }, (_, i) => (
        <span key={i} className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold", i < gift ? "border-violet-500 bg-violet-500 text-white" : i < count ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-300")}
          title={i < gift ? "Sello de regalo" : undefined}>
          {i === every - 1 ? <Gift className="h-3 w-3" /> : i < count ? <Check className="h-3 w-3" /> : null}
        </span>
      ))}
    </div>
  );
}
