import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Ban, BadgeCheck, Copy, CreditCard, Gift, Link2, Loader2, MessageCircle, Pencil, Printer, StickyNote, Undo2, User } from "lucide-react";
import {
  carwashReadyBody, formatMoney, formatPhone, loyaltyText, netOf, renderTemplate, templateMissingLink, VEHICLE_SIZE_LABELS, WASH_COVERAGE_LABELS,
  WASH_STATUS_LABELS, type Customer, type QueueStatus, type Wash,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { CustomerPicker } from "@/features/vehicles/CustomerPicker";
import { useCustomerVehicles } from "@/features/vehicles/api";
import { PendingProofsPanel } from "@/features/payments/proofs";
import { assignWasher, cancelWash, ensureWashPayUrl, linkWashCustomer, setWashStatus, useCarwashSettings, useLoyalty, useLoyaltyView, useWashers } from "./api";
import { AdjustStampsButton } from "./LoyaltyAdjust";
import { Stamps } from "./RegisterWashDialog";
import { formatMinutes, msOf, STATUS_STYLE } from "./ui";

const NEXT: Partial<Record<Wash["status"], QueueStatus>> = { waiting: "washing", washing: "ready", ready: "delivered" };
const PREV: Partial<Record<Wash["status"], QueueStatus>> = { washing: "waiting", ready: "washing" };
export const NEXT_LABEL: Partial<Record<Wash["status"], string>> = { waiting: "Empezar a lavar", washing: "Marcar listo", ready: "Entregar" };

export const nextStatus = (w: Wash) => NEXT[w.status];
/** El lavado tiene saldo por cobrar */
export const needsCharge = (w: Wash) => !w.paid && w.total > 0 && w.status !== "cancelled";

/** Minutos que lleva en la etapa actual (o duración total si ya se entregó). */
export function stageMinutes(w: Wash, now: number): number {
  const start =
    w.status === "washing" ? msOf(w.startedAt) : w.status === "ready" ? msOf(w.readyAt) : w.status === "delivered" ? msOf(w.createdAt) : msOf(w.createdAt);
  const end = w.status === "delivered" ? msOf(w.deliveredAt) : now;
  if (!start) return 0;
  return Math.max(0, (end - start) / 60000);
}

/** Cambia el estado con aviso de error. */
export async function moveWash(w: Wash, to: QueueStatus): Promise<boolean> {
  try {
    await setWashStatus({ washId: w.id, status: to });
    toast.success(`${w.code}: ${WASH_STATUS_LABELS[to].toLowerCase()}`);
    return true;
  } catch (err) {
    toast.error(errorMessage(err));
    return false;
  }
}

/** Lavado pagado o sin cobro (el mensaje no pide pago). */
const isSettled = (w: Wash) => w.paid || w.total === 0;

/**
 * Link público del lavado (/lavado/:token). Si el lavado es de antes y no tiene, se crea en el servidor.
 * "" mientras carga o si no se pudo (el mensaje sale sin link).
 */
export function useWashPayUrl(w: Wash | null) {
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = w?.id ?? null;
  const token = w?.payToken ?? null;
  const cancelled = w?.status === "cancelled";
  useEffect(() => {
    setError(null);
    if (!id || cancelled) return;
    let alive = true;
    ensureWashPayUrl({ id, payToken: token })
      .then((u) => alive && setUrl({ id, url: u }))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id, token, cancelled]);
  const ready = !!url && url.id === id;
  return { url: ready ? url.url : "", loading: !!id && !cancelled && !ready && !error, error };
}

/** Mensaje de WhatsApp "su vehículo está listo" con el link para pagar (o ver su lavado) y los sellos. */
export function useReadyMessage(w: Wash | null, link: string) {
  const { settings: general } = useSettings();
  const { settings } = useCarwashSettings();
  const lv = useLoyaltyView(w?.plate);
  if (!w) return "";
  const sellos = settings.loyaltyEvery > 0 && (lv.card || lv.gift > 0) ? loyaltyText(lv.count, settings.loyaltyEvery, lv.rewardsAvailable) : "";
  return renderTemplate(carwashReadyBody(isSettled(w)), {
    cliente: w.customerName || "",
    placa: formatPlate(w.plate),
    taller: general.name,
    sellos,
    total: formatMoney(w.total),
    link,
  });
}

export function WhatsAppReadyDialog({ wash, onClose }: { wash: Wash | null; onClose: () => void }) {
  const pay = useWashPayUrl(wash);
  const text = useReadyMessage(wash, pay.url);
  const { settings } = useCarwashSettings();
  const lv = useLoyaltyView(wash?.plate);
  if (!wash) return null;
  const templateKey = isSettled(wash) ? "carwashReadyPaid" : "carwashReady";
  return (
    <Dialog open onClose={onClose} size="md" title="Avisar por WhatsApp" description={`${wash.code} · ${formatPlate(wash.plate)} · ${wash.customerName}`}>
      <div className="space-y-4">
        {settings.loyaltyEvery > 0 && (lv.card || lv.gift > 0) && (
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Gift className="h-4 w-4 text-violet-600" /> Tarjeta de lealtad: {lv.count} de {settings.loyaltyEvery}{lv.gift > 0 && <span className="font-normal text-violet-700">(incluye {lv.gift} de regalo)</span>}</div>
            <Stamps count={lv.count} every={settings.loyaltyEvery} gift={lv.gift} />
          </div>
        )}
        {templateMissingLink(templateKey) && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> La plantilla editada no incluye {"{{link}}"}: el cliente no recibirá el link para pagar. Agréguelo en WhatsApp → Plantillas.
          </p>
        )}
        {pay.error && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">No se pudo generar el link de pago ({pay.error}). El mensaje sale sin link.</p>}
        {!wash.phone ? null : pay.loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Preparando el link de pago…</div>
        ) : (
          <WhatsAppComposer to={{ phone: wash.phone, name: wash.customerName || formatPlate(wash.plate) }} initial={text} context="carwash" onSent={onClose} />
        )}
        {wash.phone ? null : (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Este lavado no tiene teléfono. Edite el lavado para agregarlo.</p>
        )}
      </div>
    </Dialog>
  );
}

export function CancelWashDialog({ wash, onClose }: { wash: Wash | null; onClose: (cancelled?: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(""), [wash?.id]);
  if (!wash) return null;
  const save = async () => {
    if (reason.trim().length < 3) return toast.error("Indique el motivo");
    setSaving(true);
    try {
      await cancelWash({ washId: wash.id, reason: reason.trim() });
      toast.success(`${wash.code} cancelado`);
      onClose(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => onClose()}
      size="sm"
      title={`Cancelar ${wash.code}`}
      description={`${formatPlate(wash.plate)} · ${wash.customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>Volver</Button>
          <Button variant="danger" onClick={() => void save()} loading={saving}>Cancelar lavado</Button>
        </>
      }
    >
      <Field label="Motivo" required hint="Ej.: el cliente se fue, se registró dos veces.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} autoFocus />
      </Field>
      {(wash.loyaltyRedeemed || wash.membershipId) && (
        <p className="mt-3 text-xs text-slate-500">Se devuelve el premio de lealtad o el uso de la membresía.</p>
      )}
    </Dialog>
  );
}

/** Selector de lavador (se guarda al cambiar). */
export function WasherSelect({ wash, className }: { wash: Wash; className?: string }) {
  const washers = useWashers();
  const [saving, setSaving] = useState(false);
  const onChange = async (value: string) => {
    setSaving(true);
    try {
      await assignWasher({ washId: wash.id, washerId: value || null });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const known = washers.all.some((w) => w.id === wash.washerId);
  return (
    <Select value={wash.washerId ?? ""} onChange={(e) => void onChange(e.target.value)} disabled={saving} className={className} aria-label="Lavador">
      <option value="">Sin lavador</option>
      {!known && wash.washerId && <option value={wash.washerId}>{wash.washerName || "Lavador"}</option>}
      {washers.washers.length > 0 && <optgroup label="Lavadores">{washers.washers.map((w) => <option key={w.id} value={w.id}>{w.displayName}</option>)}</optgroup>}
      {washers.others.length > 0 && <optgroup label="Otro personal">{washers.others.map((w) => <option key={w.id} value={w.id}>{w.displayName}</option>)}</optgroup>}
    </Select>
  );
}

/** Detalle de un lavado: servicios, tiempos, cobro y acciones. */
export function WashDetailDialog({
  wash,
  onClose,
  onCharge,
  onEdit,
  onWhatsApp,
  onCancel,
}: {
  wash: Wash | null;
  onClose: () => void;
  onCharge?: (w: Wash) => void;
  onEdit?: (w: Wash) => void;
  onWhatsApp?: (w: Wash) => void;
  onCancel?: (w: Wash) => void;
}) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [copying, setCopying] = useState(false);
  const { settings: cw } = useCarwashSettings();
  const loyalty = useLoyalty(wash?.plate);
  const lv = useLoyaltyView(wash?.plate);
  useEffect(() => setLinking(false), [wash?.id]);
  if (!wash) return null;
  const w = wash;
  const money = can("carwash.charge");
  const open = w.status !== "delivered" && w.status !== "cancelled";
  const prev = PREV[w.status];
  const minutes = (a: unknown, b: unknown) => {
    const x = msOf(a as Wash["createdAt"]);
    const y = msOf(b as Wash["createdAt"]);
    return x && y ? formatMinutes((y - x) / 60000) : "";
  };
  const copyLink = async () => {
    setCopying(true);
    try {
      const url = await ensureWashPayUrl(w);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado. Péguelo en WhatsApp o donde quiera enviarlo.");
      } catch {
        window.prompt("Copie el link del lavado:", url);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCopying(false);
    }
  };
  const back = async () => {
    if (!prev) return;
    setBusy(true);
    await moveWash(w, prev);
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {w.code} <Badge tone={STATUS_STYLE[w.status].tone}>{WASH_STATUS_LABELS[w.status]}</Badge>
        </span>
      }
      description={`${formatPlate(w.plate)} · ${VEHICLE_SIZE_LABELS[w.size]}`}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div><dt className="text-xs text-slate-500">Cliente</dt><dd className="font-medium">{w.customerName || "Sin nombre"}</dd></div>
          <div><dt className="text-xs text-slate-500">Teléfono</dt><dd className="font-medium">{w.phone ? formatPhone(w.phone) : "Sin teléfono"}</dd></div>
          <div><dt className="text-xs text-slate-500">Registrado</dt><dd>{formatDate(w.createdAt, true)}<span className="block text-xs text-slate-500">por {w.createdByName}</span></dd></div>
          <div>
            <dt className="text-xs text-slate-500">Lavador</dt>
            <dd>{open || can("carwash.manage") ? <WasherSelect wash={w} className="mt-0.5 h-9" /> : w.washerName || "Sin asignar"}</dd>
          </div>
        </dl>

        {w.customerId && can("customers.read") && (
          <Link to={`/clientes/${w.customerId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
            <User className="h-4 w-4" /> Ver cliente en el taller
          </Link>
        )}
        {!w.customerId && can("carwash.charge") && w.status !== "cancelled" && (
          linking ? (
            <LinkCustomerPanel wash={w} onDone={() => setLinking(false)} />
          ) : (
            <Button variant="secondary" size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => setLinking(true)}>Vincular a cliente del taller</Button>
          )
        )}

        {w.notes && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-900"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" />{w.notes}</p>
        )}

        <div className="rounded-xl bg-slate-50 p-3">
          {w.items.map((i) => (
            <div key={i.serviceId} className="flex justify-between gap-2">
              <span className="text-slate-700">
                {i.name}
                {i.covered && <span className="ml-1.5 text-xs font-semibold text-emerald-700">{WASH_COVERAGE_LABELS[i.covered]}</span>}
              </span>
              {money && <span className="tabular">{i.price !== i.listPrice && <s className="mr-1.5 text-slate-400">{formatMoney(i.listPrice)}</s>}{formatMoney(i.price)}</span>}
            </div>
          ))}
          {money && (
            <dl className="mt-2 space-y-0.5 border-t border-slate-200 pt-2">
              {w.discount > 0 && <div className="flex justify-between text-slate-600"><dt>Descuento</dt><dd className="tabular">- {formatMoney(w.discount)}</dd></div>}
              {w.totals && <div className="flex justify-between text-slate-600"><dt>Sin ISV</dt><dd className="tabular">{formatMoney(netOf(w.totals))}</dd></div>}
              {w.totals && <div className="flex justify-between text-slate-600"><dt>ISV</dt><dd className="tabular">{formatMoney(w.totals.tax)}</dd></div>}
              <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd className="tabular">{formatMoney(w.total)}</dd></div>
            </dl>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {w.paid && w.total > 0 && <Badge tone="green">Cobrado{w.saleCode ? ` · ${w.saleCode}` : ""}</Badge>}
            {w.paid && w.total === 0 && <Badge tone="green">Sin cobro</Badge>}
            {needsCharge(w) && <Badge tone="amber">Pendiente de cobro</Badge>}
            {w.deliveredUnpaid && <Badge tone="red">Entregado sin cobrar</Badge>}
            {w.membershipCode && <Badge tone="blue"><BadgeCheck className="h-3 w-3" /> {w.membershipCode}</Badge>}
            {w.loyaltyRedeemed && <Badge tone="blue"><Gift className="h-3 w-3" /> Premio de lealtad</Badge>}
          </div>
          {money && w.commission > 0 && <p className="mt-2 text-xs text-slate-500">Comisión del lavador: {formatMoney(w.commission)}</p>}
        </div>

        {needsCharge(w) && <PendingProofsPanel washId={w.id} washTotal={w.total} />}

        {cw.loyaltyEvery > 0 && (loyalty.data || lv.gift > 0) && (
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Gift className="h-4 w-4 text-violet-600" /> Tarjeta de lealtad: {lv.count} de {cw.loyaltyEvery}
                {lv.gift > 0 && <span className="text-sm font-normal text-violet-700">(incluye {lv.gift} de regalo)</span>}
                {lv.rewardsAvailable > 0 && <Badge tone="blue">{lv.rewardsAvailable} gratis</Badge>}
              </span>
              {loyalty.data && <AdjustStampsButton loyalty={loyalty.data} every={cw.loyaltyEvery} />}
            </div>
            <Stamps count={lv.count} every={cw.loyaltyEvery} gift={lv.gift} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <TimeBox label="Espera" value={minutes(w.createdAt, w.startedAt)} />
          <TimeBox label="Lavado" value={minutes(w.startedAt, w.readyAt)} />
          <TimeBox label="Listo a entrega" value={minutes(w.readyAt, w.deliveredAt)} />
          <TimeBox label="Total" value={minutes(w.createdAt, w.deliveredAt)} />
        </div>

        {w.status === "cancelled" && (
          <p className="rounded-xl bg-red-50 p-3 text-red-800"><b>Cancelado</b>{w.cancelledAt ? ` el ${formatDate(w.cancelledAt, true)}` : ""}: {w.cancelReason}</p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {money && needsCharge(w) && onCharge && (
            <Button icon={<CreditCard className="h-4 w-4" />} onClick={() => onCharge(w)}>Cobrar {formatMoney(w.total)}</Button>
          )}
          {(w.status === "ready" || w.status === "delivered") && w.phone && onWhatsApp && (
            <Button variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => onWhatsApp(w)}>WhatsApp</Button>
          )}
          {w.status !== "cancelled" && (
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copyLink()} loading={copying}>
              {needsCharge(w) ? "Copiar link de pago" : "Copiar link del lavado"}
            </Button>
          )}
          <Link to={`/imprimir/lavado/${w.id}`} target="_blank"><Button variant="secondary" icon={<Printer className="h-4 w-4" />}>Ticket</Button></Link>
          {open && !w.paid && onEdit && can("carwash.create") && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(w)}>Editar</Button>
          )}
          {open && prev && (
            <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => void back()} loading={busy}>Regresar a {WASH_STATUS_LABELS[prev].toLowerCase()}</Button>
          )}
          {open && !w.saleId && onCancel && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Ban className="h-4 w-4" />} onClick={() => onCancel(w)}>Cancelar lavado</Button>
          )}
        </div>
        {w.saleId && money && (
          <Link to={`/imprimir/venta/${w.saleId}`} target="_blank" className="inline-block text-sm font-semibold text-brand-700">Ver comprobante de venta {w.saleCode}</Link>
        )}
      </div>
    </Dialog>
  );
}

function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-2.5 py-2">
      <div className="text-slate-500">{label}</div>
      <div className="tabular font-semibold text-slate-800">{value || "-"}</div>
    </div>
  );
}

/** Vincula un lavado sin cliente (y su placa) a un cliente del taller. Solo caja/recepción. */
function LinkCustomerPanel({ wash, onDone }: { wash: Wash; onDone: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const vehicles = useCustomerVehicles(customer?.id);
  const own = vehicles.data.find((v) => v.plate === wash.plate);
  const save = async () => {
    if (!customer) return toast.error("Busque y elija el cliente");
    setSaving(true);
    try {
      const r = await linkWashCustomer({ washId: wash.id, customerId: customer.id, ...(own ? { vehicleId: own.id } : {}) });
      toast.success(
        `${wash.code} vinculado a ${customer.fullName}` +
          (r.linkedWashes > 1 ? ` (con ${r.linkedWashes - 1} lavado${r.linkedWashes === 2 ? "" : "s"} más de la placa)` : "") +
          (r.vehicleCreated ? ". Placa agregada a sus vehículos." : ""),
      );
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="text-sm font-semibold text-slate-900">Vincular a cliente del taller</div>
      <CustomerPicker value={customer} onChange={setCustomer} placeholder="Nombre o teléfono del cliente..." emptyText="Sin resultados. Créelo primero en Clientes." />
      {customer && !vehicles.loading && (
        <p className="text-xs text-slate-600">
          {own
            ? `La placa ${formatPlate(wash.plate)} ya está en sus vehículos.`
            : `Se agregará la placa ${formatPlate(wash.plate)} a sus vehículos (si ya está registrada a otro cliente, solo se enlaza).`}{" "}
          También se vinculan los demás lavados de esta placa que no tienen cliente y su tarjeta de lealtad.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Cancelar</Button>
        <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => void save()} loading={saving} disabled={!customer}>Vincular</Button>
      </div>
    </div>
  );
}
