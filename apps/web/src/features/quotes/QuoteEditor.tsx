import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ClipboardCheck, Copy, FilePlus2, FileText, PencilLine, Plus, Printer, Save, Send, Trash2 } from "lucide-react";
import {
  computeQuote, templateBody, formatMoney, OPEN_QUOTE_STATUSES, QUOTE_ITEM_LABELS, renderTemplate,
  type Quote, type QuoteItemInput, type QuoteItemType, type WorkOrder,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { orderVars } from "@/features/work-orders/whatsapp";
import { newQuoteVersion, saveQuote, sendQuote, useOrderQuotes } from "./api";
import { consumeOrderPart } from "@/features/catalog/api";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import { blankLine, DecisionInfo, DiscardRevisionDialog, ModifyQuoteDialog, QuoteHistory, QuoteLinesEditor, QuoteView, RecordDecisionDialog, RevisionChanges, versionLabel } from "./parts";

const REVISION_STATE: Record<string, string> = { draft: "Borrador", sent: "Enviada al cliente", viewed: "Vista por el cliente" };

/** Pestaña Cotización de una orden. */
export function QuoteEditor({ order }: { order: WorkOrder }) {
  const { can, role } = useAuth();
  const { settings } = useSettings();
  const { data: quotes, loading, error } = useOrderQuotes(order.id);
  // Cotización aprobada vigente (una sola por orden) y su modificación abierta, si la hay
  const approved = quotes.find((q) => q.status === "approved") ?? null;
  const revision = approved ? quotes.find((q) => q.revisionOf === approved.id && OPEN_QUOTE_STATUSES.includes(q.status)) ?? null : null;
  const current = revision ?? approved ?? quotes[0] ?? null;
  // Orden entregada: solo gerencia o administración pueden modificar la cotización aprobada
  const closedOk = !order.isOpen && order.status !== "CANCELLED" && !!approved && (role === "admin" || role === "manager");
  const manage = can("quotes.manage") && (order.isOpen || closedOk);
  const showCost = can("dashboard.financials");

  const [lines, setLines] = useState<QuoteItemInput[] | null>(null);
  const [notes, setNotes] = useState("");
  const [validDays, setValidDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [modifying, setModifying] = useState<Quote | null>(null);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (dirty) return;
    if (current?.status === "draft") {
      setLines(current.items.map(({ lineTotal: _t, ...rest }) => rest));
      setNotes(current.notes);
      setValidDays(current.validDays);
    } else setLines(null);
  }, [current, dirty]);

  const preview = useMemo(() => (lines ? computeQuote(lines, settings.taxRate) : null), [lines, settings.taxRate]);
  const quoteMessage = (total: number) =>
    renderTemplate(templateBody("cotizacion_enviada"), { ...orderVars(order, settings), total: formatMoney(total) });

  const persist = async (): Promise<string | null> => {
    if (!lines) return null;
    if (lines.some((l) => !l.description.trim() || !(l.qty > 0))) {
      toast.error("Cada línea necesita descripción y cantidad");
      return null;
    }
    const { quoteId } = await saveQuote({
      orderId: order.id,
      quoteId: current?.status === "draft" ? current.id : null,
      items: lines.map((l) => ({ ...l, description: l.description.trim() })),
      notes: notes.trim(),
      validDays,
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

  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="p-5"><Skeleton className="h-48" /></div>;

  if (!current && !lines) {
    return (
      <EmptyState
        icon={<FileText className="h-7 w-7" />}
        title="Sin cotización"
        description={manage ? "Arme la cotización con mano de obra, repuestos y servicios. El cliente la aprueba desde su link, o usted la registra si lo confirma por teléfono." : "Recepción todavía no ha creado la cotización."}
        action={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setLines([blankLine("labor")]); setDirty(true); }}>Crear cotización</Button>}
      />
    );
  }

  const isRevision = !!revision;
  const sendCurrent = async () => {
    const id = await persist();
    if (!id) return null;
    await sendQuote({ quoteId: id });
    return id;
  };

  return (
    <div className="space-y-5 p-5">
      {/* Aviso: hay una modificación abierta de la cotización aprobada */}
      {revision && approved && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Modificación en curso: {versionLabel(revision)} · {REVISION_STATE[revision.status]}</p>
            <p className="mt-0.5">La cotización aprobada ({versionLabel(approved)}, {formatMoney(approved.totals.total)}) sigue vigente hasta que el cliente apruebe los cambios. Los cobros siguen usando ese total.</p>
            {revision.revisionReason && <p className="mt-1 text-xs">Motivo: {revision.revisionReason}{revision.revisionByName ? ` · ${revision.revisionByName}` : ""}</p>}
          </div>
        </div>
      )}

      {lines && manage && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2">{current?.status === "draft" ? `${isRevision ? "Modificación " : ""}${versionLabel(current)}` : "Nueva cotización"} <QuoteStatusBadge status="draft" /></span>}
            description={`ISV ${settings.taxRate}% · los totales finales los calcula el sistema al guardar`}
          />
          <div className="p-5">
            <QuoteLinesEditor
              lines={lines} onLines={(l) => { setLines(l); setDirty(true); }} preview={preview} showCost={showCost}
              notes={notes} onNotes={(v) => { setNotes(v); setDirty(true); }} validDays={validDays} onValidDays={(v) => { setValidDays(v); setDirty(true); }} taxRate={settings.taxRate}
            />
            {isRevision && approved && preview && (
              <div className="mt-4"><RevisionChanges base={approved} next={preview} paid={order.paid ?? 0} consumed={order.consumed} /></div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              {isRevision && revision && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={saving} onClick={() => setDiscarding(true)} className="mr-auto text-red-600">Descartar modificación</Button>}
              <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!lines.length} onClick={() => void run(async () => { if (await persist()) toast.success("Borrador guardado"); })}>Guardar borrador</Button>
              {isRevision && (
                <Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} loading={saving} disabled={!lines.length} title="Para cuando el cliente ya aprobó por teléfono, en persona o por WhatsApp" onClick={() => void run(async () => {
                  if (await sendCurrent()) setRecording(true);
                })}>Registrar aprobación</Button>
              )}
              <Button icon={<Send className="h-4 w-4" />} loading={saving} disabled={!lines.length} onClick={() => void run(async () => {
                if (!(await sendCurrent())) return;
                toast.success(isRevision ? "Cambios enviados. El cliente los ve en su link para aprobarlos." : "Cotización enviada. Ya está en el portal del cliente.");
                setMessage(quoteMessage(preview?.totals.total ?? 0));
              })}>Enviar al cliente</Button>
            </div>
          </div>
        </Card>
      )}

      {current && current.status !== "draft" && (
        <Card>
          <CardHeader
            title={<span className="flex flex-wrap items-center gap-2">{isRevision && "Modificación "}{current.code}{current.version > 1 && <span className="text-slate-400">v{current.version}</span>} <QuoteStatusBadge status={current.status} discarded={!!current.discardedAt} /></span>}
            description={[current.sentAt && `Enviada ${formatDate(current.sentAt, true)}`, current.viewedAt && `vista ${formatDate(current.viewedAt, true)}`, current.validUntil && `vence ${formatDate(current.validUntil)}`].filter(Boolean).join(" · ")}
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <Link to={`/imprimir/cotizacion/${current.id}`} target="_blank"><Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />}>Imprimir</Button></Link>
                {manage && current.status === "approved" && <Button size="sm" variant="secondary" icon={<PencilLine className="h-4 w-4" />} onClick={() => setModifying(current)}>Modificar cotización</Button>}
                {manage && current.status !== "approved" && <Button size="sm" variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} loading={saving} onClick={() => void run(async () => { await newQuoteVersion({ quoteId: current.id }); toast.success(isRevision ? "Ya puede seguir editando los cambios." : "Nueva versión creada. Edítela y vuelva a enviarla."); })}>{isRevision ? "Continuar edición" : "Nueva versión"}</Button>}
              </div>
            }
          />
          <div className="space-y-4 p-5">
            {manage && current.status === "approved" && <p className="text-xs text-slate-500">Si aparece trabajo adicional o hay que cambiar un repuesto, use "Modificar cotización". La cotización aprobada sigue vigente hasta que el cliente apruebe los cambios.</p>}
            <DecisionInfo quote={current} />
            {isRevision && approved && <RevisionChanges base={approved} next={current} paid={order.paid ?? 0} consumed={order.consumed} />}
            <QuoteView quote={current} showCost={showCost} />
            {manage && ["sent", "viewed"].includes(current.status) && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setRecording(true)}>{isRevision ? "Registrar aprobación" : "Registrar respuesta del cliente"}</Button>
                <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setMessage(quoteMessage(current.totals.total))}>{isRevision ? "Enviar al cliente por WhatsApp" : "Reenviar por WhatsApp"}</Button>
                {isRevision && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDiscarding(true)} className="ml-auto text-red-600">Descartar modificación</Button>}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Mientras hay una modificación abierta, la aprobada vigente se sigue viendo */}
      {revision && approved && (
        <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-medium text-slate-700">
            Cotización vigente: {versionLabel(approved)} <QuoteStatusBadge status="approved" /> <span className="tabular ml-auto font-semibold">{formatMoney(approved.totals.total)}</span>
          </summary>
          <div className="mt-4 space-y-4">
            <DecisionInfo quote={approved} />
            <QuoteView quote={approved} showCost={showCost} />
            <Link to={`/imprimir/cotizacion/${approved.id}`} target="_blank"><Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />}>Imprimir</Button></Link>
          </div>
        </details>
      )}

      <QuoteHistory quotes={quotes} currentId={current?.id} onResume={manage && approved && !revision ? (q) => setModifying(q) : undefined} />

      {message !== null && (
        <Dialog open onClose={() => setMessage(null)} title="Enviar cotización por WhatsApp" description="El mensaje incluye el link donde el cliente la revisa y aprueba." footer={<Button variant="ghost" onClick={() => setMessage(null)}>Cerrar</Button>}>
          <WhatsAppComposer context="cotización" order={order} initial={message} onSent={() => setMessage(null)} />
        </Dialog>
      )}
      {current && recording && ["sent", "viewed"].includes(current.status) && <RecordDecisionDialog quote={current} open onClose={() => setRecording(false)} />}
      {modifying && <ModifyQuoteDialog quote={modifying} open onClose={() => setModifying(null)} onOpened={() => setDirty(false)} />}
      {revision && discarding && <DiscardRevisionDialog quote={revision} open onClose={() => setDiscarding(false)} onDone={() => setDirty(false)} />}
    </div>
  );
}

/** Líneas aprobadas por tipo (tabs Servicios y Repuestos de la orden). Los repuestos del catálogo se descuentan del inventario. */
export function ApprovedItems({ order, types, empty }: { order: WorkOrder; types: QuoteItemType[]; empty: string }) {
  const { can, role, user } = useAuth();
  const { data, loading } = useOrderQuotes(order.id);
  const [busy, setBusy] = useState<string | null>(null);
  const items = data.filter((q) => q.status === "approved").flatMap((q) => q.items.filter((it) => types.includes(it.type)).map((it) => ({ ...it, code: q.code, quoteId: q.id })));
  const canConsume = (can("inventory.manage") || can("quotes.manage") || (role === "technician" && !!user && order.technicianIds.includes(user.uid))) && order.isOpen;
  if (loading) return <div className="p-5"><Skeleton className="h-24" /></div>;
  if (!items.length) return <EmptyState icon={<FileText className="h-7 w-7" />} title={empty} description="Aparecen aquí cuando el cliente aprueba la cotización." />;

  const consume = async (quoteId: string, itemId: string) => {
    setBusy(itemId);
    try {
      const r = await consumeOrderPart({ orderId: order.id, quoteId, itemId });
      toast.success(`Descontado del inventario. Quedan ${r.stock}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => {
        const used = order.consumed?.[`${it.quoteId}_${it.id}`];
        return (
          <li key={`${it.code}-${it.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1"><div className="font-medium">{it.description}</div><div className="text-xs text-slate-500">{QUOTE_ITEM_LABELS[it.type]} · {it.qty} × {formatMoney(it.unitPrice)} · {it.code}</div></div>
            {it.type === "part" && (used ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Descontado del inventario</span>
            ) : it.productId ? (
              canConsume && <Button size="sm" variant="secondary" loading={busy === it.id} onClick={() => void consume(it.quoteId, it.id)}>Descontar del inventario</Button>
            ) : (
              <span className="text-xs text-slate-400">No enlazado al catálogo</span>
            ))}
            <div className="tabular font-semibold">{formatMoney(it.lineTotal)}</div>
          </li>
        );
      })}
    </ul>
  );
}
