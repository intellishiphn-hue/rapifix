import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Copy, FilePlus2, FileText, HelpCircle, Plus, Printer, Save, Send, Trash2, XCircle } from "lucide-react";
import {
  computeQuote, formatMoney, QUOTE_ITEM_LABELS, QUOTE_ITEM_TYPES, renderTemplate, DEFAULT_TEMPLATES,
  type Quote, type QuoteItemInput, type QuoteItemType, type WorkOrder,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { newId } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { orderVars } from "@/features/work-orders/whatsapp";
import { newQuoteVersion, saveQuote, sendQuote, useOrderQuotes } from "./api";
import { MoneyInput } from "./MoneyInput";
import { QuoteStatusBadge } from "./QuoteStatusBadge";

const blankLine = (type: QuoteItemType = "labor"): QuoteItemInput => ({ id: newId(), type, description: "", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true });

function TotalsBox({ totals, taxRate }: { totals: Quote["totals"]; taxRate: number }) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
      {totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Descuento</dt><dd className="tabular text-red-600">- {formatMoney(totals.discount)}</dd></div>}
      <div className="flex justify-between"><dt className="text-slate-500">ISV ({taxRate}%)</dt><dd className="tabular">{formatMoney(totals.tax)}</dd></div>
      <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
    </dl>
  );
}

function QuoteView({ quote, showCost }: { quote: Quote; showCost: boolean }) {
  const margin = quote.items.reduce((a, it) => a + it.lineTotal - Math.round(it.qty * it.unitCost), 0);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2 text-right">Cant.</th><th className="px-3 py-2 text-right">Precio</th><th className="px-3 py-2 text-right">Desc.</th><th className="px-3 py-2 text-right">Total</th></tr>
          </thead>
          <tbody>
            {quote.items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{QUOTE_ITEM_LABELS[it.type]}</td>
                <td className="px-3 py-2">{it.description}{!it.taxable && <span className="ml-1 text-xs text-slate-400">(exento)</span>}</td>
                <td className="tabular px-3 py-2 text-right">{it.qty}</td>
                <td className="tabular px-3 py-2 text-right">{formatMoney(it.unitPrice)}</td>
                <td className="tabular px-3 py-2 text-right">{it.discount ? formatMoney(it.discount) : ""}</td>
                <td className="tabular px-3 py-2 text-right font-semibold">{formatMoney(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2 text-sm">
          {quote.notes && <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{quote.notes}</p>}
          {showCost && <p className="text-xs text-slate-500">Margen estimado (sin ISV): <b className="tabular text-slate-800">{formatMoney(margin)}</b></p>}
        </div>
        <TotalsBox totals={quote.totals} taxRate={quote.taxRate} />
      </div>
    </div>
  );
}

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

  // Cargar el borrador existente en el editor
  useEffect(() => {
    if (dirty) return;
    if (current?.status === "draft") {
      setLines(current.items.map(({ lineTotal: _t, ...rest }) => rest));
      setNotes(current.notes);
      setValidDays(current.validDays);
    } else setLines(null);
  }, [current, dirty]);

  const preview = useMemo(() => (lines ? computeQuote(lines, settings.taxRate) : null), [lines, settings.taxRate]);

  const edit = (id: string, patch: Partial<QuoteItemInput>) => {
    setLines((ls) => ls?.map((l) => (l.id === id ? { ...l, ...patch } : l)) ?? null);
    setDirty(true);
  };

  const persist = async (): Promise<string | null> => {
    if (!lines) return null;
    const bad = lines.find((l) => !l.description.trim() || !(l.qty > 0));
    if (bad) {
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

  const save = async () => {
    setSaving(true);
    try {
      if (await persist()) toast.success("Borrador guardado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    setSaving(true);
    try {
      const id = await persist();
      if (!id) return;
      await sendQuote({ quoteId: id });
      toast.success("Cotización enviada. Ya está en el portal del cliente.");
      const t = DEFAULT_TEMPLATES.find((x) => x.key === "cotizacion_enviada")!;
      const total = preview ? formatMoney(preview.totals.total) : "";
      setMessage(renderTemplate(t.body, { ...orderVars(order, settings), total }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const version = async () => {
    if (!current) return;
    setSaving(true);
    try {
      await newQuoteVersion({ quoteId: current.id });
      toast.success("Nueva versión creada. Edítela y vuelva a enviarla.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="p-5"><Skeleton className="h-48" /></div>;

  // Sin cotización todavía
  if (!current && !lines) {
    return (
      <EmptyState
        icon={<FileText className="h-7 w-7" />}
        title="Sin cotización"
        description={manage ? "Arme la cotización con mano de obra, repuestos y servicios. El cliente la aprueba desde su link." : "Recepción todavía no ha creado la cotización."}
        action={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setLines([blankLine("labor")]); setDirty(true); }}>Crear cotización</Button>}
      />
    );
  }

  return (
    <div className="space-y-5 p-5">
      {/* Editor de borrador */}
      {lines && manage && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2">{current?.status === "draft" ? `${current.code}${current.version > 1 ? ` · v${current.version}` : ""}` : "Nueva cotización"} <QuoteStatusBadge status="draft" /></span>}
            description={`ISV ${settings.taxRate}% · los totales finales los calcula el sistema al guardar`}
          />
          <div className="space-y-3 p-5">
            {lines.map((l, i) => (
              <div key={l.id} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-end">
                <Field label={i === 0 ? "Tipo" : ""} className="sm:col-span-2">
                  <Select value={l.type} onChange={(e) => edit(l.id, { type: e.target.value as QuoteItemType })}>
                    {QUOTE_ITEM_TYPES.map((t) => <option key={t} value={t}>{QUOTE_ITEM_LABELS[t]}</option>)}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Descripción" : ""} className="col-span-2 sm:col-span-4">
                  <Input value={l.description} onChange={(e) => edit(l.id, { description: e.target.value })} placeholder="Ej. Pastillas de freno delanteras" />
                </Field>
                <Field label={i === 0 ? "Cant." : ""} className="sm:col-span-1">
                  <Input type="number" inputMode="decimal" min={0} step="any" value={Number.isNaN(l.qty) ? "" : l.qty} onChange={(e) => edit(l.id, { qty: e.target.value === "" ? Number.NaN : Number(e.target.value) })} className="text-right" />
                </Field>
                <Field label={i === 0 ? "Precio" : ""} className="sm:col-span-2"><MoneyInput value={l.unitPrice} onChange={(v) => edit(l.id, { unitPrice: v })} /></Field>
                <Field label={i === 0 ? "Descuento" : ""} className="sm:col-span-2"><MoneyInput value={l.discount} onChange={(v) => edit(l.id, { discount: v })} /></Field>
                <div className="flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
                  <span className="tabular text-sm font-semibold sm:hidden">{formatMoney(preview?.items[i]?.lineTotal ?? 0)}</span>
                  <button type="button" onClick={() => { setLines((ls) => ls!.filter((x) => x.id !== l.id)); setDirty(true); }} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar línea"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 sm:col-span-12">
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={l.taxable} onChange={(e) => edit(l.id, { taxable: e.target.checked })} /> Aplica ISV</label>
                  {showCost && (
                    <span className="inline-flex items-center gap-2">Costo interno <MoneyInput value={l.unitCost} onChange={(v) => edit(l.id, { unitCost: v })} className="w-28" /></span>
                  )}
                  <span className="tabular ml-auto hidden font-semibold text-slate-800 sm:inline">{formatMoney(preview?.items[i]?.lineTotal ?? 0)}</span>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {QUOTE_ITEM_TYPES.map((t) => (
                <Button key={t} size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => { setLines((ls) => [...(ls ?? []), blankLine(t)]); setDirty(true); }}>{QUOTE_ITEM_LABELS[t]}</Button>
              ))}
            </div>
            <div className="grid gap-4 pt-2 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <Field label="Notas para el cliente"><Textarea value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} rows={3} placeholder="Garantía, tiempo estimado, condiciones..." /></Field>
                <Field label="Vigencia (días)" className="max-w-[140px]"><Input type="number" min={1} max={90} value={validDays} onChange={(e) => { setValidDays(Math.max(1, Math.min(90, Number(e.target.value) || 7))); setDirty(true); }} /></Field>
              </div>
              {preview && <TotalsBox totals={preview.totals} taxRate={settings.taxRate} />}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="secondary" icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={saving} disabled={!lines.length}>Guardar borrador</Button>
              <Button icon={<Send className="h-4 w-4" />} onClick={() => void send()} loading={saving} disabled={!lines.length}>Enviar al cliente</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Cotización enviada / respondida */}
      {current && current.status !== "draft" && (
        <Card>
          <CardHeader
            title={<span className="flex flex-wrap items-center gap-2">{current.code}{current.version > 1 && <span className="text-slate-400">v{current.version}</span>} <QuoteStatusBadge status={current.status} /></span>}
            description={[current.sentAt && `Enviada ${formatDate(current.sentAt, true)}`, current.viewedAt && `vista ${formatDate(current.viewedAt, true)}`, current.validUntil && `vence ${formatDate(current.validUntil)}`].filter(Boolean).join(" · ")}
            action={
              <div className="flex gap-2">
                <Link to={`/imprimir/cotizacion/${current.id}`} target="_blank"><Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />}>Imprimir</Button></Link>
                {manage && <Button size="sm" variant="secondary" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => void version()} loading={saving}>Nueva versión</Button>}
              </div>
            }
          />
          <div className="space-y-4 p-5">
            {current.decision && (
              <div className={cn("flex gap-3 rounded-xl p-4 text-sm", current.decision.result === "approved" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
                {current.decision.result === "approved" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
                <div>
                  <p className="font-semibold">{current.decision.result === "approved" ? "Aprobada" : "Rechazada"} por {current.decision.name} el {formatDate(current.decision.at, true)}</p>
                  {current.decision.comment && <p className="mt-1">"{current.decision.comment}"</p>}
                  <p className="mt-1 break-all text-xs opacity-70">ID de aprobación: {current.decision.approvalId}{current.decision.ip ? ` · IP ${current.decision.ip}` : ""}</p>
                </div>
              </div>
            )}
            {current.questions?.length > 0 && (
              <div className="space-y-2">
                {current.questions.map((q, i) => (
                  <div key={i} className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div><b>{q.name}</b> preguntó ({formatDate(q.at, true)}): {q.text}</div>
                  </div>
                ))}
              </div>
            )}
            <QuoteView quote={current} showCost={showCost} />
            {manage && ["sent", "viewed"].includes(current.status) && (
              <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setMessage(renderTemplate(DEFAULT_TEMPLATES.find((x) => x.key === "cotizacion_enviada")!.body, { ...orderVars(order, settings), total: formatMoney(current.totals.total) }))}>
                Reenviar por WhatsApp
              </Button>
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
    </div>
  );
}

/** Líneas aprobadas por tipo (tabs Servicios y Repuestos de la orden). */
export function ApprovedItems({ order, types, empty }: { order: WorkOrder; types: QuoteItemType[]; empty: string }) {
  const { data, loading } = useOrderQuotes(order.id);
  const approved = data.filter((q) => q.status === "approved");
  const items = approved.flatMap((q) => q.items.filter((it) => types.includes(it.type)).map((it) => ({ ...it, code: q.code })));
  if (loading) return <div className="p-5"><Skeleton className="h-24" /></div>;
  if (!items.length) return <EmptyState icon={<FileText className="h-7 w-7" />} title={empty} description="Aparecen aquí cuando el cliente aprueba la cotización." />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={`${it.code}-${it.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <div><div className="font-medium">{it.description}</div><div className="text-xs text-slate-500">{QUOTE_ITEM_LABELS[it.type]} · {it.qty} × {formatMoney(it.unitPrice)} · {it.code}</div></div>
          <div className="tabular font-semibold">{formatMoney(it.lineTotal)}</div>
        </li>
      ))}
    </ul>
  );
}
