import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BadgeCheck, Ban, Loader2, MessageCircle, Plus, Printer, RefreshCw, Search } from "lucide-react";
import {
  computeWashCharge, formatMoney, formatPhone, isPlaceholderPlate, MEMBERSHIP_STATUS_LABELS, renderTemplate, templateBody, VEHICLE_SIZE_LABELS, washPlate,
  type CarwashLookupResult, type CarwashMembership,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { formatDate, formatPlate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { StatCard } from "@/features/reports/ui";
import { cancelMembership, carwashLookup, sellMembership, useCarwashPlans, useCarwashSettings, useMemberships } from "./api";
import { newPayLine, PaymentLines, payLinesError, payLinesInput, type PayLine } from "./PaymentLines";
import { CarwashTabs, MEMBERSHIP_TONE, membershipNow } from "./ui";

type Filter = "active" | "expiring" | "expired" | "cancelled" | "all";
const FILTERS: Array<[Filter, string]> = [
  ["active", "Activas"],
  ["expiring", "Vencen en 5 días"],
  ["expired", "Vencidas"],
  ["cancelled", "Canceladas"],
  ["all", "Todas"],
];

type Row = { m: CarwashMembership; view: ReturnType<typeof membershipNow> };

export function MembershipsPage() {
  const { can } = useAuth();
  const memberships = useMemberships();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [sell, setSell] = useState<{ open: boolean; renew: CarwashMembership | null }>({ open: false, renew: null });
  const [whatsapp, setWhatsapp] = useState<Row | null>(null);
  const [cancel, setCancel] = useState<CarwashMembership | null>(null);

  const rows: Row[] = useMemo(() => {
    const now = Date.now();
    return memberships.data.map((m) => ({ m, view: membershipNow(m, now) })).sort((a, b) => a.view.paidUntil - b.view.paidUntil);
  }, [memberships.data]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.view.status === "active");
    return {
      active: active.length,
      recurring: active.reduce((a, r) => a + (r.m.plan?.price ?? 0), 0),
      expiring: active.filter((r) => r.view.daysLeft <= 5).length,
      expired: rows.filter((r) => r.view.status === "expired").length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qp = washPlate(search);
    return rows.filter((r) => {
      const s = r.view.status;
      if (filter === "active" && s !== "active") return false;
      if (filter === "expiring" && !(s === "active" && r.view.daysLeft <= 5)) return false;
      if (filter === "expired" && s !== "expired") return false;
      if (filter === "cancelled" && s !== "cancelled") return false;
      if (!q) return true;
      return (qp.length >= 2 && r.m.plate.includes(qp)) || r.m.customerName.toLowerCase().includes(q) || r.m.code.toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  if (memberships.loading && !memberships.data.length) return <PageLoader />;

  return (
    <>
      <PageHeader
        title="Membresías"
        description="Lavados mensuales por placa. Vender o renovar genera el cobro y extiende un mes."
        actions={<Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setSell({ open: true, renew: null })}>Vender membresía</Button>}
      />
      <CarwashTabs />
      {memberships.error && <Card className="mb-4"><ErrorState message={memberships.error} /></Card>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Activas" value={stats.active} />
        <StatCard label="Ingreso mensual recurrente" value={formatMoney(stats.recurring)} hint="Suma del precio mensual de las activas." />
        <StatCard label="Vencen en 5 días" value={stats.expiring} tone={stats.expiring ? "text-amber-700" : undefined} />
        <StatCard label="Vencidas" value={stats.expired} />
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            <div className="flex rounded-[10px] bg-slate-200/70 p-1">
              {FILTERS.map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", filter === k ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>{l}</button>
              ))}
            </div>
          </div>
          <div className="relative lg:ml-auto lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Placa, cliente o código" className="pl-9" />
          </div>
        </div>
      </Card>

      {!visible.length ? (
        <Card>
          <EmptyState icon={<BadgeCheck className="h-7 w-7" />} title="Sin membresías" description={rows.length ? "Ninguna coincide con el filtro." : "Venda la primera membresía con el botón de arriba."} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {visible.map((r) => {
              const { m, view } = r;
              const soon = view.status === "active" && view.daysLeft <= 5;
              return (
                <li key={m.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-extrabold tracking-wider text-slate-900">{formatPlate(m.plate)}</span>
                      <Badge tone={MEMBERSHIP_TONE[view.status]}>{MEMBERSHIP_STATUS_LABELS[view.status]}</Badge>
                      {soon && <Badge tone="amber">Vence en {Math.max(0, view.daysLeft)} día{view.daysLeft === 1 ? "" : "s"}</Badge>}
                    </div>
                    <div className="text-sm text-slate-700">{m.customerName}{m.phone ? ` · ${formatPhone(m.phone)}` : ""}</div>
                    <div className="text-xs text-slate-500">
                      {m.code} · {m.planName} ({VEHICLE_SIZE_LABELS[m.plan?.size ?? "turismo"]}) · {formatMoney(m.plan?.price ?? 0)}/mes
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs sm:w-64">
                    <span className="text-slate-500">Pagada hasta</span>
                    <span className="text-right font-semibold text-slate-800">{formatDate(new Date(view.paidUntil))}</span>
                    <span className="text-slate-500">Uso este mes</span>
                    <span className="text-right font-semibold text-slate-800">
                      {view.status === "active" ? `${view.usedInPeriod}${m.plan?.washesPerMonth === null ? " (ilimitado)" : ` de ${m.plan?.washesPerMonth}`}` : "-"}
                    </span>
                    <span className="text-slate-500">Total pagado</span>
                    <span className="tabular text-right font-semibold text-slate-800">{formatMoney(m.totalPaid ?? 0)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {m.phone && view.status !== "cancelled" && (
                      <Button size="sm" variant="secondary" icon={<MessageCircle className="h-4 w-4 text-[#1faa53]" />} onClick={() => setWhatsapp(r)}>WhatsApp</Button>
                    )}
                    {view.status !== "cancelled" && (
                      <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setSell({ open: true, renew: m })}>Renovar</Button>
                    )}
                    {can("carwash.manage") && view.status !== "cancelled" && (
                      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Ban className="h-4 w-4" />} onClick={() => setCancel(m)} aria-label="Cancelar membresía" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <SellMembershipDialog open={sell.open} renew={sell.renew} onClose={() => setSell({ open: false, renew: null })} />
      <ExpiringWhatsApp row={whatsapp} onClose={() => setWhatsapp(null)} />
      <CancelMembershipDialog membership={cancel} onClose={() => setCancel(null)} />
    </>
  );
}

function ExpiringWhatsApp({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { settings } = useSettings();
  if (!row) return null;
  const { m, view } = row;
  const text = renderTemplate(templateBody("carwashMembershipExpiring"), {
    cliente: m.customerName,
    placa: formatPlate(m.plate),
    plan: m.planName,
    fecha: formatDate(new Date(view.paidUntil)),
    total: formatMoney(m.plan?.price ?? 0),
    taller: settings.name,
  });
  return (
    <Dialog open onClose={onClose} title="Recordar renovación" description={`${m.code} · ${formatPlate(m.plate)} · ${m.customerName}`}>
      <WhatsAppComposer to={{ phone: m.phone, name: m.customerName }} initial={text} context="carwash-membresia" onSent={onClose} />
    </Dialog>
  );
}

function CancelMembershipDialog({ membership, onClose }: { membership: CarwashMembership | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(""), [membership?.id]);
  if (!membership) return null;
  const save = async () => {
    if (reason.trim().length < 3) return toast.error("Indique el motivo");
    setSaving(true);
    try {
      await cancelMembership({ membershipId: membership.id, reason: reason.trim() });
      toast.success(`Membresía ${membership.code} cancelada`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`Cancelar ${membership.code}`}
      description="Deja de cubrir lavados desde hoy. No anula los pagos ya hechos (eso se hace en Pagos)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Volver</Button>
          <Button variant="danger" onClick={() => void save()} loading={saving}>Cancelar membresía</Button>
        </>
      }
    >
      <Field label="Motivo" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} autoFocus /></Field>
    </Dialog>
  );
}

/** Vender una membresía nueva o renovar una existente (cobro). */
export function SellMembershipDialog({ open, renew, onClose }: { open: boolean; renew: CarwashMembership | null; onClose: () => void }) {
  const plans = useCarwashPlans();
  const { settings: general } = useSettings();
  const { settings } = useCarwashSettings();
  const [plate, setPlate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState("");
  const [months, setMonths] = useState(1);
  const [lines, setLines] = useState<PayLine[]>([newPayLine(0)]);
  const [lookup, setLookup] = useState<CarwashLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ code: string; saleId: string; saleCode: string; paidUntil: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlate(renew?.plate ?? "");
    setName(renew?.customerName ?? "");
    setPhone(renew?.phone ? formatPhone(renew.phone) : "");
    setPlanId(renew?.planId ?? "");
    setMonths(1);
    setLookup(null);
    setDone(null);
  }, [open, renew]);

  const normalized = washPlate(plate);
  const debounced = useDebounced(normalized, 450);
  useEffect(() => {
    if (!open || renew || debounced.length < 3) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setLooking(true);
    carwashLookup({ plate: debounced })
      .then((r) => {
        if (cancelled) return;
        setLookup(r);
        const n = r.customer?.name || r.history?.customerName || "";
        const p = r.customer?.phone || r.history?.phone || "";
        if (n) setName((cur) => cur || n);
        if (p) setPhone((cur) => cur || formatPhone(p));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLooking(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open, renew]);

  const plan = plans.data.find((p) => p.id === planId) ?? null;
  const total = plan ? computeWashCharge([plan.price * months], general.taxRate, settings.taxMode).totals.total : 0;
  useEffect(() => setLines([newPayLine(total)]), [total]);

  const selectable = plans.data.filter((p) => p.active || p.id === renew?.planId);
  const suggestedSize = lookup?.history?.size ?? null;

  const save = async () => {
    if (!renew && normalized.length < 2) return toast.error("Escriba la placa");
    if (!plan) return toast.error("Seleccione el plan");
    if (!renew && name.trim().length < 2) return toast.error("Escriba el nombre del cliente");
    const bad = payLinesError(lines, total);
    if (bad) return toast.error(bad);
    setSaving(true);
    try {
      const customerId = lookup?.customer?.id ?? renew?.customerId ?? null;
      const r = await sellMembership({
        ...(renew ? { membershipId: renew.id } : {}),
        planId: plan.id,
        ...(customerId ? { customerId } : {}),
        customerName: name.trim(),
        phone: phone.trim(),
        plate: renew?.plate ?? normalized,
        months,
        payments: payLinesInput(lines),
      });
      setDone(r);
      toast.success(renew ? `Membresía ${r.code} renovada` : `Membresía ${r.code} vendida`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  if (done) {
    return (
      <Dialog
        open
        onClose={onClose}
        size="sm"
        title={`Membresía ${done.code}`}
        description={`Venta ${done.saleCode} · ${formatMoney(total)}`}
        footer={
          <>
            <Link to={`/imprimir/venta/${done.saleId}`} target="_blank"><Button variant="secondary" icon={<Printer className="h-4 w-4" />}>Comprobante</Button></Link>
            <Button onClick={onClose}>Listo</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Pagada hasta el <b>{formatDate(new Date(done.paidUntil))}</b>. El pago aparece en Pagos y en Finanzas como ingreso del carwash.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={renew ? `Renovar ${renew.code}` : "Vender membresía"}
      description={renew ? `${formatPlate(renew.plate)} · ${renew.customerName}` : "Una placa por membresía."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="lg" onClick={() => void save()} loading={saving} disabled={!plan}>Cobrar {formatMoney(total)}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!renew && (
          <>
            <Field label="Placa" required>
              <div className="relative">
                <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={15} placeholder="HAB 1234" className="h-12 text-xl font-bold uppercase tracking-widest" autoFocus />
                {looking && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-brand-600" />}
              </div>
            </Field>
            {normalized.length >= 4 && isPlaceholderPlate(normalized) && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Sin placa real no se puede vender una membresía. Escriba la placa del carro.</p>
            )}
            {lookup?.membership && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                Esta placa ya tiene la membresía activa {lookup.membership.code} ({lookup.membership.planName}). Renuévela desde la lista.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
              <Field label="Teléfono / WhatsApp"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} /></Field>
            </div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Plan" required hint={suggestedSize ? `Tamaño en su última visita: ${VEHICLE_SIZE_LABELS[suggestedSize]}` : undefined}>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Seleccione...</option>
              {selectable.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {VEHICLE_SIZE_LABELS[p.size]} · {formatMoney(p.price)}/mes</option>
              ))}
            </Select>
          </Field>
          <Field label="Meses">
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "mes" : "meses"}</option>)}
            </Select>
          </Field>
        </div>
        {!plans.loading && !selectable.length && <p className="text-sm text-amber-700">No hay planes activos. Gerencia los crea en Carwash, Planes.</p>}
        {plan && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            {plan.washesPerMonth === null ? "Lavados ilimitados" : `${plan.washesPerMonth} lavados al mes`}.
            {renew && ` Se suma a partir del ${formatDate(renew.paidUntil)} si aún está vigente.`}
            <div className="mt-1 text-base font-bold text-slate-900">Total: {formatMoney(total)}</div>
            <div className="text-xs text-slate-500">{settings.taxMode === "included" ? "Precio con ISV incluido." : settings.taxMode === "add" ? `Incluye ISV (${general.taxRate}%).` : "Sin ISV."}</div>
          </div>
        )}
        {plan && total > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-slate-700">Pago</div>
            <PaymentLines total={total} value={lines} onChange={setLines} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
