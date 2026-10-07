import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { AlertTriangle, Car, ClipboardCheck, ClipboardList, Copy, ExternalLink, FilePlus2, FileText, PencilLine, Printer, Save, Send, Trash2, UserPlus } from "lucide-react";
import {
  computeQuote, convertQuoteSchema, OPEN_QUOTE_STATUSES, templateBody, EMPTY_RECEPTION, normalizeUnit, formatMoney, PRIORITIES, PRIORITY_LABELS, renderTemplate, WORK_TYPES, WORK_TYPE_LABELS,
  type Customer, type Priority, type Quote, type QuoteItemInput, type ReceptionInput, type Vehicle, type WorkType,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { CustomerFormDialog } from "@/features/customers/CustomerFormDialog";
import { customerRef } from "@/features/customers/api";
import { VehicleFormDialog } from "@/features/vehicles/VehicleFormDialog";
import { vehicleRef } from "@/features/vehicles/api";
import { VehiclePicker } from "@/features/work-orders/VehiclePicker";
import { ReceptionForm } from "@/features/work-orders/ReceptionForm";
import { TechnicianSelect } from "@/features/work-orders/TechnicianSelect";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { convertQuoteToOrder, newQuoteVersion, saveQuote, sendQuote, useQuote, useQuoteVersions } from "./api";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import { blankLine, DecisionInfo, DiscardRevisionDialog, ModifyQuoteDialog, QuoteHistory, QuoteLinesEditor, QuoteView, RecordDecisionDialog, RevisionChanges, versionLabel } from "./parts";

const quoteLink = (q: Pick<Quote, "publicToken">) => (q.publicToken ? `${window.location.origin}/orden/${q.publicToken}` : "");

function directMessage(q: Quote, taller: string) {
  return renderTemplate(templateBody("cotizacion_directa"), {
    cliente: q.customerName.split(" ")[0],
    vehiculo: q.vehicleLabel,
    placa: formatPlate(q.plate),
    orden: q.code,
    total: formatMoney(q.totals.total),
    link: quoteLink(q),
    taller,
  });
}

/** Convertir en orden cuando llega el vehículo: recepción con la cotización ya aprobada. */
function ConvertDialog({ quote, open, onClose }: { quote: Quote; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [type, setType] = useState<WorkType>("repair");
  const [priority, setPriority] = useState<Priority>("normal");
  const [techs, setTechs] = useState<string[]>([]);
  const [promised, setPromised] = useState("");
  const [reception, setReception] = useState<ReceptionInput>(EMPTY_RECEPTION);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason(`Cotización ${quote.code} aprobada: ${quote.items.map((i) => i.description).join(", ")}`.slice(0, 900));
    if (quote.vehicleId) {
      getDoc(vehicleRef(quote.vehicleId)).then((s) => s.exists() && setReception((r) => ({ ...r, mileageIn: (s.data() as Vehicle).mileage, mileageUnit: normalizeUnit((s.data() as Vehicle).odometerUnit) })));
    }
  }, [open, quote]);

  const submit = async () => {
    const input = { quoteId: quote.id, reason, type, priority, technicianIds: techs, promisedAt: promised ? new Date(promised).toISOString() : null, reception };
    const parsed = convertQuoteSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path.at(-1)), i.message])));
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      const { orderId, code } = await convertQuoteToOrder(parsed.data);
      toast.success(`Orden ${code} creada en estado Aprobado. Tome las fotos de ingreso.`);
      navigate(`/ordenes/${orderId}?tab=fotos`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Convertir en orden de trabajo" description={`${quote.vehicleLabel} · ${formatPlate(quote.plate)} · el cliente conserva el mismo link`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => void submit()} loading={saving}>Recibir vehículo y crear orden</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Motivo de ingreso" required error={errors.reason} className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as WorkType)}>{WORK_TYPES.map((t) => <option key={t} value={t}>{WORK_TYPE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Prioridad"><Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</Select></Field>
          <Field label="Técnico" className="sm:col-span-2"><TechnicianSelect value={techs} onChange={setTechs} /></Field>
          <Field label="Fecha prometida"><Input type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} /></Field>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 font-semibold">Recepción del vehículo</h3>
          <ReceptionForm value={reception} onChange={setReception} errors={errors} />
        </div>
      </div>
    </Dialog>
  );
}

export function DirectQuotePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { settings } = useSettings();
  const { data: quote, loading, error, exists } = useQuote(id);
  // Si esta versión modifica una cotización aprobada, esa es la base para comparar
  const { data: baseQuote } = useQuote(quote?.revisionOf ?? undefined);
  const { data: versions } = useQuoteVersions(quote?.number);
  const showCost = can("dashboard.financials");
  const manage = can("quotes.manage");

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [lines, setLines] = useState<QuoteItemInput[]>([blankLine("labor")]);
  const [notes, setNotes] = useState("");
  const [validDays, setValidDays] = useState(7);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [converting, setConverting] = useState(false);
  const [modifying, setModifying] = useState<Quote | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [vehicleFor, setVehicleFor] = useState<Customer | null | undefined>(undefined);

  const isNew = !id;
  const draft = isNew || quote?.status === "draft";

  useEffect(() => {
    if (!quote || dirty || quote.status !== "draft") return;
    setLines(quote.items.map(({ lineTotal: _t, ...rest }) => rest));
    setNotes(quote.notes);
    setValidDays(quote.validDays);
  }, [quote, dirty]);

  const preview = useMemo(() => computeQuote(lines, settings.taxRate), [lines, settings.taxRate]);

  const selectVehicle = async (vid: string) => {
    const s = await getDoc(vehicleRef(vid));
    if (s.exists()) setVehicle({ id: s.id, ...s.data() } as Vehicle);
  };

  const persist = async (): Promise<string | null> => {
    if (lines.some((l) => !l.description.trim() || !(l.qty > 0))) {
      toast.error("Cada línea necesita descripción y cantidad");
      return null;
    }
    const vehicleId = quote?.vehicleId ?? vehicle?.id;
    if (!vehicleId) {
      toast.error("Seleccione el vehículo");
      return null;
    }
    const { quoteId } = await saveQuote({
      vehicleId, quoteId: quote?.id ?? null, items: lines.map((l) => ({ ...l, description: l.description.trim() })), notes: notes.trim(), validDays,
    });
    setDirty(false);
    return quoteId;
  };

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && loading) return <PageLoader />;
  if (!isNew && error) return <ErrorState message={error} />;
  if (!isNew && (!exists || !quote)) return <EmptyState icon={<FileText className="h-7 w-7" />} title="Cotización no encontrada" action={<Link to="/cotizaciones" className="font-semibold text-brand-700">Volver</Link>} />;
  if (quote?.orderId) {
    // Pertenece a una orden: se gestiona desde la orden
    return <Navigate to={`/ordenes/${quote.orderId}?tab=cotizacion`} replace />;
  }

  const base = quote?.revisionOf && baseQuote?.id === quote.revisionOf ? baseQuote : null;
  // Modificación abierta de una aprobada que sigue vigente
  const isRevision = !!quote && !!base && base.status === "approved" && OPEN_QUOTE_STATUSES.includes(quote.status);
  const openRevision = quote?.status === "approved" ? versions.find((v) => v.revisionOf === quote.id && OPEN_QUOTE_STATUSES.includes(v.status)) ?? null : null;
  const goTo = (qid: string) => { setDirty(false); navigate(`/cotizaciones/${qid}`); };

  const to = quote ? { phone: quote.customerPhone ?? "", name: quote.customerName } : undefined;

  return (
    <>
      <PageHeader
        back={{ to: "/cotizaciones", label: "Cotizaciones" }}
        title={quote ? <span className="flex flex-wrap items-center gap-3">{quote.code}{quote.version > 1 && <span className="text-slate-400">v{quote.version}</span>}<QuoteStatusBadge status={quote.status} /></span> : "Nueva cotización"}
        description={quote ? `${quote.customerName} · ${quote.vehicleLabel} · ${formatPlate(quote.plate)}` : "Cotización previa, sin orden. Cuando llegue el vehículo, la convierte en orden."}
        actions={quote && quote.status !== "draft" && (
          <>
            <Link to={`/imprimir/cotizacion/${quote.id}`} target="_blank"><Button variant="ghost" icon={<Printer className="h-4 w-4" />}>Imprimir</Button></Link>
            {quote.publicToken && <a href={quoteLink(quote)} target="_blank" rel="noreferrer"><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Ver link</Button></a>}
            {manage && quote.status === "approved" && !openRevision && <Button variant="secondary" icon={<PencilLine className="h-4 w-4" />} onClick={() => setModifying(quote)}>Modificar cotización</Button>}
            {manage && !["approved", "superseded"].includes(quote.status) && (!quote.revisionOf || isRevision) && <Button variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} loading={saving} onClick={() => void run(async () => { const r = await newQuoteVersion({ quoteId: quote.id }); toast.success(isRevision ? "Ya puede seguir editando los cambios" : "Nueva versión creada"); goTo(r.quoteId); })}>{isRevision ? "Continuar edición" : "Nueva versión"}</Button>}
          </>
        )}
      />

      <div className="mx-auto max-w-5xl space-y-5">
        {isNew && (
          <Card>
            <CardHeader title="1. Vehículo y cliente" />
            <div className="p-5">
              <VehiclePicker value={vehicle} onChange={setVehicle} />
              {!vehicle && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setNewCustomer(true)}>Cliente nuevo</Button>
                  <Button variant="secondary" icon={<Car className="h-4 w-4" />} onClick={() => setVehicleFor(null)}>Vehículo nuevo (cliente existente)</Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {isRevision && base && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Esta es una modificación de la cotización aprobada {versionLabel(base)}</p>
              <p className="mt-0.5">La aprobada ({formatMoney(base.totals.total)}) sigue vigente hasta que el cliente apruebe los cambios. <Link to={`/cotizaciones/${base.id}`} className="font-semibold underline">Ver la vigente</Link></p>
              {quote?.revisionReason && <p className="mt-1 text-xs">Motivo: {quote.revisionReason}{quote.revisionByName ? ` · ${quote.revisionByName}` : ""}</p>}
            </div>
          </div>
        )}
        {quote && openRevision && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="flex-1"><b>Modificación en curso: {versionLabel(openRevision)} · {openRevision.status === "draft" ? "Borrador" : openRevision.status === "sent" ? "Enviada al cliente" : "Vista por el cliente"}.</b> Esta cotización sigue vigente hasta que el cliente apruebe los cambios.</div>
            <Button variant="secondary" onClick={() => goTo(openRevision.id)}>{openRevision.status === "draft" ? "Continuar edición" : "Ver modificación"}</Button>
          </div>
        )}
        {quote?.status === "superseded" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Esta versión fue reemplazada por una más reciente que el cliente aprobó.{quote.supersededBy && <> <Link to={`/cotizaciones/${quote.supersededBy}`} className="font-semibold text-brand-700 underline">Ver la cotización vigente</Link></>}
          </div>
        )}

        {draft && manage && (
          <Card>
            <CardHeader title={isNew ? "2. Cotización" : "Editar borrador"} description={`ISV ${settings.taxRate}% · los totales finales los calcula el sistema al guardar`} />
            <div className="p-5">
              <QuoteLinesEditor
                lines={lines} onLines={(l) => { setLines(l); setDirty(true); }} preview={preview} showCost={showCost}
                notes={notes} onNotes={(v) => { setNotes(v); setDirty(true); }} validDays={validDays} onValidDays={(v) => { setValidDays(v); setDirty(true); }} taxRate={settings.taxRate}
              />
              {isRevision && base && <div className="mt-4"><RevisionChanges base={base} next={preview} /></div>}
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                {isRevision && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDiscarding(true)} className="mr-auto text-red-600">Descartar modificación</Button>}
                <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void run(async () => {
                  const qid = await persist();
                  if (qid) { toast.success("Borrador guardado"); if (isNew) navigate(`/cotizaciones/${qid}`, { replace: true }); }
                })}>Guardar borrador</Button>
                <Button icon={<Send className="h-4 w-4" />} loading={saving} onClick={() => void run(async () => {
                  const qid = await persist();
                  if (!qid) return;
                  await sendQuote({ quoteId: qid });
                  toast.success("Cotización enviada");
                  navigate(`/cotizaciones/${qid}?enviar=1`, { replace: true });
                })}>Enviar al cliente</Button>
              </div>
            </div>
          </Card>
        )}

        {quote && quote.status !== "draft" && (
          <Card>
            <CardHeader title="Detalle" description={[quote.sentAt && `Enviada ${formatDate(quote.sentAt, true)}`, quote.viewedAt && `vista ${formatDate(quote.viewedAt, true)}`, quote.validUntil && `vence ${formatDate(quote.validUntil)}`].filter(Boolean).join(" · ")} />
            <div className="space-y-4 p-5">
              {quote.status === "approved" && !quote.orderId && (
                <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center">
                  <ClipboardList className="h-6 w-6 shrink-0 text-brand-700" />
                  <div className="flex-1 text-sm"><b className="text-brand-900">Aprobada, pendiente de ingreso.</b> Cuando el cliente traiga el vehículo, conviértala en orden.</div>
                  {manage && <Button onClick={() => setConverting(true)} icon={<ClipboardCheck className="h-4 w-4" />}>Convertir en orden</Button>}
                </div>
              )}
              {manage && quote.status === "approved" && !openRevision && <p className="text-xs text-slate-500">Si hay que agregar o cambiar algo, use "Modificar cotización". La cotización aprobada sigue vigente hasta que el cliente apruebe los cambios.</p>}
              <DecisionInfo quote={quote} />
              {isRevision && base && <RevisionChanges base={base} next={quote} />}
              <QuoteView quote={quote} showCost={showCost} />
              {manage && ["sent", "viewed"].includes(quote.status) && (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setRecording(true)}>Registrar respuesta del cliente</Button>
                  <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setMessage(directMessage(quote, settings.name))}>Enviar por WhatsApp</Button>
                  {isRevision && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDiscarding(true)} className="ml-auto text-red-600">Descartar modificación</Button>}
                </div>
              )}
            </div>
          </Card>
        )}
        {quote && (
          <QuoteHistory
            quotes={versions} currentId={quote.id} linkTo={(v) => `/cotizaciones/${v.id}`}
            onResume={manage && quote.status === "approved" && !openRevision ? (v) => setModifying(v) : undefined}
          />
        )}
      </div>

      {quote && modifying && <ModifyQuoteDialog quote={modifying} open onClose={() => setModifying(null)} onOpened={goTo} />}
      {quote && isRevision && discarding && <DiscardRevisionDialog quote={quote} open onClose={() => setDiscarding(false)} onDone={() => base && goTo(base.id)} />}

      {/* Tras enviar, abrir el WhatsApp sugerido */}
      {quote && new URLSearchParams(window.location.search).get("enviar") === "1" && message === null && quote.status === "sent" && (
        <AutoOpen onOpen={() => { setMessage(directMessage(quote, settings.name)); navigate(`/cotizaciones/${quote.id}`, { replace: true }); }} />
      )}
      {message !== null && quote && (
        <Dialog open onClose={() => setMessage(null)} title="Enviar cotización por WhatsApp" description="Incluye el link donde el cliente la revisa y la aprueba." footer={<Button variant="ghost" onClick={() => setMessage(null)}>Cerrar</Button>}>
          <WhatsAppComposer context="cotización" to={to} initial={message} onSent={() => setMessage(null)} />
        </Dialog>
      )}
      {quote && recording && <RecordDecisionDialog quote={quote} open onClose={() => setRecording(false)} />}
      {quote && <ConvertDialog quote={quote} open={converting} onClose={() => setConverting(false)} />}
      <CustomerFormDialog open={newCustomer} onClose={() => setNewCustomer(false)} onSaved={async (cid) => {
        const s = await getDoc(customerRef(cid));
        if (s.exists()) setVehicleFor({ id: s.id, ...s.data() } as Customer);
      }} />
      <VehicleFormDialog open={vehicleFor !== undefined} onClose={() => setVehicleFor(undefined)} defaultCustomer={vehicleFor ?? null} onSaved={(vid) => void selectVehicle(vid)} />
    </>
  );
}

function AutoOpen({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    onOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
