import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ClipboardCheck, Copy, FilePlus2, FileText, Plus, Printer, Save, Send } from "lucide-react";
import {
  computeQuote, DEFAULT_TEMPLATES, formatMoney, QUOTE_ITEM_LABELS, renderTemplate,
  type QuoteItemInput, type QuoteItemType, type WorkOrder,
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
import { blankLine, DecisionInfo, QuoteLinesEditor, QuoteView, RecordDecisionDialog } from "./parts";

/** Pestaña Cotización de una orden. */
export function QuoteEditor({ order }: { order: WorkOrder }) {
  const { can } = useAuth();
  const { settings } = useSettings();
  const { data: quotes, loading, error } = useOrderQuotes(order.id);
  const current = quotes[0] ?? null;
  const manage = can("quotes.manage") && order.isOpen;
  const showCost = can("dashboard.financials");

  const [lines, setLines] = useState<QuoteItemInput[] | null>(null);
  const [notes, setNotes] = useState("");
  const [validDays, setValidDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

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
    renderTemplate(DEFAULT_TEMPLATES.find((x) => x.key === "cotizacion_enviada")!.body, { ...orderVars(order, settings), total: formatMoney(total) });

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

  return (
    <div className="space-y-5 p-5">
      {lines && manage && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2">{current?.status === "draft" ? `${current.code}${current.version > 1 ? ` · v${current.version}` : ""}` : "Nueva cotización"} <QuoteStatusBadge status="draft" /></span>}
            description={`ISV ${settings.taxRate}% · los totales finales los calcula el sistema al guardar`}
          />
          <div className="p-5">
            <QuoteLinesEditor
              lines={lines} onLines={(l) => { setLines(l); setDirty(true); }} preview={preview} showCost={showCost}
              notes={notes} onNotes={(v) => { setNotes(v); setDirty(true); }} validDays={validDays} onValidDays={(v) => { setValidDays(v); setDirty(true); }} taxRate={settings.taxRate}
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!lines.length} onClick={() => void run(async () => { if (await persist()) toast.success("Borrador guardado"); })}>Guardar borrador</Button>
              <Button icon={<Send className="h-4 w-4" />} loading={saving} disabled={!lines.length} onClick={() => void run(async () => {
                const id = await persist();
                if (!id) return;
                await sendQuote({ quoteId: id });
                toast.success("Cotización enviada. Ya está en el portal del cliente.");
                setMessage(quoteMessage(preview?.totals.total ?? 0));
              })}>Enviar al cliente</Button>
            </div>
          </div>
        </Card>
      )}

      {current && current.status !== "draft" && (
        <Card>
          <CardHeader
            title={<span className="flex flex-wrap items-center gap-2">{current.code}{current.version > 1 && <span className="text-slate-400">v{current.version}</span>} <QuoteStatusBadge status={current.status} /></span>}
            description={[current.sentAt && `Enviada ${formatDate(current.sentAt, true)}`, current.viewedAt && `vista ${formatDate(current.viewedAt, true)}`, current.validUntil && `vence ${formatDate(current.validUntil)}`].filter(Boolean).join(" · ")}
            action={
              <div className="flex gap-2">
                <Link to={`/imprimir/cotizacion/${current.id}`} target="_blank"><Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />}>Imprimir</Button></Link>
                {manage && current.status !== "approved" && <Button size="sm" variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} loading={saving} onClick={() => void run(async () => { await newQuoteVersion({ quoteId: current.id }); toast.success("Nueva versión creada. Edítela y vuelva a enviarla."); })}>Nueva versión</Button>}
              </div>
            }
          />
          <div className="space-y-4 p-5">
            <DecisionInfo quote={current} />
            <QuoteView quote={current} showCost={showCost} />
            {manage && ["sent", "viewed"].includes(current.status) && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setRecording(true)}>Registrar respuesta del cliente</Button>
                <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setMessage(quoteMessage(current.totals.total))}>Reenviar por WhatsApp</Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {quotes.length > 1 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-medium text-slate-600">Versiones anteriores ({quotes.length - 1})</summary>
          <ul className="mt-3 divide-y divide-slate-100">
            {quotes.slice(1).map((q) => (
              <li key={q.id} className="flex items-center justify-between py-2">
                <span>{q.code} v{q.version} · {formatDate(q.createdAt)}</span>
                <span className="flex items-center gap-3"><span className="tabular">{formatMoney(q.totals.total)}</span><QuoteStatusBadge status={q.status} /></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {message !== null && (
        <Dialog open onClose={() => setMessage(null)} title="Enviar cotización por WhatsApp" description="El mensaje incluye el link donde el cliente la revisa y aprueba." footer={<Button variant="ghost" onClick={() => setMessage(null)}>Cerrar</Button>}>
          <WhatsAppComposer order={order} initial={message} onSent={() => setMessage(null)} />
        </Dialog>
      )}
      {current && recording && <RecordDecisionDialog quote={current} open onClose={() => setRecording(false)} />}
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
