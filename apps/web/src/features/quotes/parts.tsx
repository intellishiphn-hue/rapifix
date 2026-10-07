import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, HelpCircle, Minus, PencilLine, Plus, Search, Trash2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { CatalogPicker, type CatalogPick } from "@/features/catalog/CatalogPicker";
import { fetchCost } from "@/features/catalog/api";
import {
  balanceAfter, consumedByItem, DECISION_CHANNEL_LABELS, diffQuotes, formatMoney, QUOTE_ITEM_LABELS, QUOTE_ITEM_TYPES, stockImpact, stockNoticeText,
  type DiffItem, type Quote, type QuoteItemInput, type QuoteItemType, type Totals,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { newId } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { discardQuoteRevision, newQuoteVersion, recordQuoteDecision } from "./api";
import { QuoteStatusBadge } from "./QuoteStatusBadge";
import { MoneyInput } from "./MoneyInput";

export const blankLine = (type: QuoteItemType = "labor"): QuoteItemInput => ({ id: newId(), type, description: "", qty: 1, unitCost: 0, unitPrice: 0, discount: 0, taxable: true });

export function TotalsBox({ totals, taxRate }: { totals: Totals; taxRate: number }) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
      {totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Descuento</dt><dd className="tabular text-red-600">- {formatMoney(totals.discount)}</dd></div>}
      <div className="flex justify-between"><dt className="text-slate-500">ISV ({taxRate}%)</dt><dd className="tabular">{formatMoney(totals.tax)}</dd></div>
      <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
    </dl>
  );
}

export function QuoteView({ quote, showCost }: { quote: Quote; showCost: boolean }) {
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

/** Editor de líneas (controlado). */
export function QuoteLinesEditor({
  lines, onLines, preview, showCost, notes, onNotes, validDays, onValidDays, taxRate,
}: {
  lines: QuoteItemInput[];
  onLines: (l: QuoteItemInput[]) => void;
  preview: { items: Array<{ lineTotal: number }>; totals: Totals } | null;
  showCost: boolean;
  notes: string;
  onNotes: (v: string) => void;
  validDays: number;
  onValidDays: (v: number) => void;
  taxRate: number;
}) {
  const edit = (id: string, patch: Partial<QuoteItemInput>) => onLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const [picking, setPicking] = useState(false);
  const addFromCatalog = async (pick: CatalogPick) => {
    if (pick.kind === "product") {
      const cost = showCost ? await fetchCost(pick.item.id) : 0;
      onLines([...lines.filter((l) => l.description.trim()), { ...blankLine("part"), productId: pick.item.id, description: pick.item.name, unitPrice: pick.item.price, unitCost: cost, taxable: pick.item.taxable }]);
    } else {
      onLines([...lines.filter((l) => l.description.trim()), { ...blankLine("service"), serviceId: pick.item.id, description: pick.item.name, unitPrice: pick.item.price, taxable: pick.item.taxable }]);
    }
  };
  return (
    <div className="space-y-3">
      <CatalogPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => void addFromCatalog(p)} />
      {lines.map((l, i) => (
        <div key={l.id} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-end">
          <Field label={i === 0 ? "Tipo" : ""} className="sm:col-span-2">
            <Select value={l.type} onChange={(e) => edit(l.id, { type: e.target.value as QuoteItemType })}>
              {QUOTE_ITEM_TYPES.map((t) => <option key={t} value={t}>{QUOTE_ITEM_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label={i === 0 ? "Descripción" : ""} className="col-span-2 sm:col-span-4">
            <Input value={l.description} onChange={(e) => edit(l.id, { description: e.target.value })} placeholder="Ej. Pastillas de freno delanteras" />
            {(l.productId || l.serviceId) && <span className="mt-0.5 block text-[11px] text-brand-700">Del catálogo{l.productId ? " · se puede descontar del inventario" : ""}</span>}
          </Field>
          <Field label={i === 0 ? "Cant." : ""} className="sm:col-span-1">
            <Input type="number" inputMode="decimal" min={0} step="any" value={Number.isNaN(l.qty) ? "" : l.qty} onChange={(e) => edit(l.id, { qty: e.target.value === "" ? Number.NaN : Number(e.target.value) })} className="text-right" />
          </Field>
          <Field label={i === 0 ? "Precio" : ""} className="sm:col-span-2"><MoneyInput value={l.unitPrice} onChange={(v) => edit(l.id, { unitPrice: v })} /></Field>
          <Field label={i === 0 ? "Descuento" : ""} className="sm:col-span-2"><MoneyInput value={l.discount} onChange={(v) => edit(l.id, { discount: v })} /></Field>
          <div className="flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
            <span className="tabular text-sm font-semibold sm:hidden">{formatMoney(preview?.items[i]?.lineTotal ?? 0)}</span>
            <button type="button" onClick={() => onLines(lines.filter((x) => x.id !== l.id))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar línea"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-4 text-xs text-slate-500 sm:col-span-12">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={l.taxable} onChange={(e) => edit(l.id, { taxable: e.target.checked })} /> Aplica ISV</label>
            {showCost && <span className="inline-flex items-center gap-2">Costo interno <MoneyInput value={l.unitCost} onChange={(v) => edit(l.id, { unitCost: v })} className="w-28" /></span>}
            <span className="tabular ml-auto hidden font-semibold text-slate-800 sm:inline">{formatMoney(preview?.items[i]?.lineTotal ?? 0)}</span>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Search className="h-3.5 w-3.5" />} onClick={() => setPicking(true)}>Del catálogo</Button>
        {QUOTE_ITEM_TYPES.map((t) => (
          <Button key={t} size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onLines([...lines, blankLine(t)])}>{QUOTE_ITEM_LABELS[t]}</Button>
        ))}
      </div>
      <div className="grid gap-4 pt-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <Field label="Notas para el cliente"><Textarea value={notes} onChange={(e) => onNotes(e.target.value)} rows={3} placeholder="Garantía, tiempo estimado, condiciones..." /></Field>
          <Field label="Vigencia (días)" className="max-w-[140px]"><Input type="number" min={1} max={90} value={validDays} onChange={(e) => onValidDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))} /></Field>
        </div>
        {preview && <TotalsBox totals={preview.totals} taxRate={taxRate} />}
      </div>
    </div>
  );
}

/** Resultado de la decisión y preguntas del cliente. */
export function DecisionInfo({ quote }: { quote: Quote }) {
  const d = quote.decision;
  return (
    <>
      {d && (
        <div className={cn("flex gap-3 rounded-xl p-4 text-sm", d.result === "approved" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900")}>
          {d.result === "approved" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
          <div>
            <p className="font-semibold">{d.result === "approved" ? "Aprobada" : "Rechazada"} por {d.name} el {formatDate(d.at, true)}</p>
            <p className="text-xs">
              {DECISION_CHANNEL_LABELS[d.channel ?? "portal"]}{d.recordedByName ? ` · registrada por ${d.recordedByName}` : ""}
            </p>
            {d.comment && <p className="mt-1">"{d.comment}"</p>}
            <p className="mt-1 break-all text-xs opacity-70">ID de aprobación: {d.approvalId}{d.ip ? ` · IP ${d.ip}` : ""}</p>
          </div>
        </div>
      )}
      {quote.questions?.map((q, i) => (
        <div key={i} className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><b>{q.name}</b> preguntó ({formatDate(q.at, true)}): {q.text}</div>
        </div>
      ))}
    </>
  );
}

/** El taller registra la respuesta del cliente (para quien no usa el link). */
export function RecordDecisionDialog({ quote, open, onClose }: { quote: Quote; open: boolean; onClose: () => void }) {
  const [action, setAction] = useState<"approve" | "reject">("approve");
  const [channel, setChannel] = useState<"phone" | "in_person" | "whatsapp">("phone");
  const [name, setName] = useState(quote.customerName);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await recordQuoteDecision({ quoteId: quote.id, action, channel, ...(name.trim() ? { name: name.trim() } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
      toast.success(action === "approve" ? "Aprobación registrada" : "Rechazo registrado");
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
      size="sm"
      title="Registrar respuesta del cliente"
      description={`${quote.revisionOf ? "Modificación de " : ""}${quote.code}${quote.version > 1 ? ` v${quote.version}` : ""} · ${formatMoney(quote.totals.total)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant={action === "reject" ? "danger" : "primary"} onClick={() => void save()} loading={saving}>{action === "approve" ? "Registrar aprobación" : "Registrar rechazo"}</Button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["approve", "reject"] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAction(a)} className={cn("rounded-xl border px-3 py-2.5 text-sm font-semibold", action === a ? (a === "approve" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-red-500 bg-red-50 text-red-700") : "border-slate-200 text-slate-600")}>
              {a === "approve" ? "Aprobó" : "Rechazó"}
            </button>
          ))}
        </div>
        <Field label="¿Cómo respondió?">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option value="phone">Por teléfono</option>
            <option value="in_person">En persona</option>
            <option value="whatsapp">Por WhatsApp</option>
          </Select>
        </Field>
        <Field label="Nombre de quien respondió"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Comentario (opcional)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} /></Field>
        {quote.revisionOf && <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{action === "approve" ? "Al aprobar, esta versión reemplaza a la cotización aprobada anterior y la orden toma el total nuevo. Los pagos ya registrados se conservan." : "Si la rechaza, sigue vigente la cotización aprobada anterior."}</p>}
        <p className="text-xs text-slate-500">Quedará registrado que usted anotó la respuesta, con fecha y hora.</p>
      </div>
    </Dialog>
  );
}

export const versionLabel = (q: Pick<Quote, "code" | "version">) => `${q.code}${q.version > 1 ? ` v${q.version}` : ""}`;
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""} ${formatMoney(Math.abs(cents))}`.trim();
const lineDetail = (it: DiffItem) => `${QUOTE_ITEM_LABELS[it.type]} · ${it.qty} × ${formatMoney(it.unitPrice)}${it.discount ? ` · desc. ${formatMoney(it.discount)}` : ""}`;

/**
 * Panel "Cambios respecto a la cotización aprobada": qué se agregó, quitó o modificó,
 * total anterior → nuevo, y cómo quedaría el saldo con lo ya pagado.
 */
export function RevisionChanges({
  base, next, paid, consumed,
}: {
  base: Pick<Quote, "id" | "code" | "version" | "items" | "totals">;
  next: { items: DiffItem[]; totals: Totals };
  /** lo ya pagado en la orden (si aplica) */
  paid?: number;
  /** order.consumed: repuestos que ya salieron del inventario */
  consumed?: Record<string, { qty: number }> | null;
}) {
  const d = diffQuotes(base, next);
  const stock = stockImpact(base.items, next.items, consumedByItem(consumed, base.id)).notices;
  const after = paid !== undefined ? balanceAfter(d.newTotal, paid) : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" data-testid="revision-changes">
      <h3 className="text-sm font-semibold text-slate-900">Cambios respecto a la cotización aprobada <span className="font-normal text-slate-500">({versionLabel(base)})</span></h3>
      {!d.hasChanges ? (
        <p className="mt-2 text-sm text-slate-500">Todavía no hay cambios. Agregue, quite o modifique líneas.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {d.added.map((it) => (
            <li key={`a-${it.id}`} className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
              <Plus className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1"><div className="font-medium">Se agrega: {it.description || "(sin descripción)"}</div><div className="text-xs opacity-80">{lineDetail(it)}</div></div>
              <span className="tabular shrink-0 font-semibold">+ {formatMoney(it.lineTotal)}</span>
            </li>
          ))}
          {d.removed.map((it) => (
            <li key={`r-${it.id}`} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-900">
              <Minus className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1"><div className="font-medium">Se quita: <span className="line-through">{it.description}</span></div><div className="text-xs opacity-80">{lineDetail(it)}</div></div>
              <span className="tabular shrink-0 font-semibold">− {formatMoney(it.lineTotal)}</span>
            </li>
          ))}
          {d.changed.map(({ before, after: a, fields }) => (
            <li key={`c-${before.id}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              <PencilLine className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Cambia: {a.description || before.description}</div>
                <div className="text-xs opacity-80">
                  {[
                    fields.includes("description") && `antes "${before.description}"`,
                    fields.includes("qty") && `cantidad ${before.qty} → ${a.qty}`,
                    fields.includes("unitPrice") && `precio ${formatMoney(before.unitPrice)} → ${formatMoney(a.unitPrice)}`,
                    fields.includes("discount") && `descuento ${formatMoney(before.discount)} → ${formatMoney(a.discount)}`,
                    fields.includes("type") && `tipo ${QUOTE_ITEM_LABELS[before.type]} → ${QUOTE_ITEM_LABELS[a.type]}`,
                    fields.includes("taxable") && (a.taxable ? "ahora aplica ISV" : "ahora exento de ISV"),
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span className="tabular shrink-0 text-right font-semibold">{formatMoney(a.lineTotal)}<span className="block text-xs font-normal opacity-80">antes {formatMoney(before.lineTotal)}</span></span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 pt-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Total anterior</dt><dd className="tabular font-medium">{formatMoney(d.previousTotal)}</dd></div>
        <div><dt className="text-xs text-slate-500">Total nuevo</dt><dd className="tabular font-bold">{formatMoney(d.newTotal)}</dd></div>
        <div><dt className="text-xs text-slate-500">Diferencia</dt><dd className={cn("tabular font-bold", d.difference > 0 ? "text-amber-700" : d.difference < 0 ? "text-emerald-700" : "text-slate-700")}>{d.difference === 0 ? "Sin cambio" : signed(d.difference)}</dd></div>
        {after && (
          <>
            <div><dt className="text-xs text-slate-500">Ya pagado</dt><dd className="tabular font-medium">{formatMoney(paid ?? 0)}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">{after.credit > 0 ? "Saldo a favor del cliente" : "Saldo que quedaría"}</dt>
              <dd className={cn("tabular font-bold", after.credit > 0 && "text-red-700")}>{formatMoney(after.credit > 0 ? after.credit : after.balance)}{after.credit > 0 && <span className="ml-2 text-xs font-normal">El cliente ya pagó más que el total nuevo: revise la devolución.</span>}</dd>
            </div>
          </>
        )}
      </dl>
      {stock.length > 0 && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Repuestos que ya salieron del inventario</p>
            {stock.map((n, i) => <p key={i}>{stockNoticeText(n)}</p>)}
            <p className="text-xs opacity-80">El sistema no devuelve inventario solo.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pide el motivo y abre la modificación de una cotización aprobada (o retoma una rechazada/descartada). */
export function ModifyQuoteDialog({ quote, open, onClose, onOpened }: { quote: Quote; open: boolean; onClose: () => void; onOpened: (quoteId: string) => void }) {
  const [reason, setReason] = useState(quote.status === "approved" ? "" : quote.revisionReason ?? "");
  const [saving, setSaving] = useState(false);
  const ok = reason.trim().length >= 3;
  const save = async () => {
    setSaving(true);
    try {
      const r = await newQuoteVersion({ quoteId: quote.id, reason: reason.trim() });
      toast.success(r.existing ? "Ya había una modificación abierta: continúe con esa." : "Modificación abierta. Haga los cambios y envíelos al cliente.");
      onClose();
      onOpened(r.quoteId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open} onClose={onClose} size="sm" title="Modificar cotización" description={`${versionLabel(quote)} · ${formatMoney(quote.totals.total)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={!ok}>Abrir modificación</Button></>}
    >
      <div className="space-y-3">
        <Field label="Motivo del cambio" required hint="Queda en el historial de la orden. El cliente no lo ve.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Ej. Al desarmar se encontró el disco rayado" autoFocus />
        </Field>
        <p className="text-xs text-slate-500">La cotización aprobada sigue vigente hasta que el cliente apruebe los cambios.</p>
      </div>
    </Dialog>
  );
}

export function DiscardRevisionDialog({ quote, open, onClose, onDone }: { quote: Quote; open: boolean; onClose: () => void; onDone?: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await discardQuoteRevision({ quoteId: quote.id, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      toast.success("Modificación descartada. Sigue vigente la cotización aprobada.");
      onClose();
      onDone?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open} onClose={onClose} size="sm" title="Descartar modificación" description={versionLabel(quote)}
      footer={<><Button variant="secondary" onClick={onClose}>Volver</Button><Button variant="danger" onClick={() => void save()} loading={saving}>Descartar modificación</Button></>}
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Los cambios de esta modificación no se aplican{quote.status !== "draft" ? " y el cliente deja de verla en su link" : ""}. La cotización aprobada sigue vigente.</p>
        <Field label="Motivo (opcional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </div>
    </Dialog>
  );
}

/** Historial de versiones: v1 Reemplazada, v2 Aprobada... con quién y por qué. */
export function QuoteHistory({ quotes, currentId, linkTo, onResume }: { quotes: Quote[]; currentId?: string; linkTo?: (q: Quote) => string; onResume?: (q: Quote) => void }) {
  const list = [...quotes].sort((a, b) => b.version - a.version);
  if (list.length < 2) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm" open>
      <summary className="cursor-pointer font-medium text-slate-600">Historial de versiones ({list.length})</summary>
      <ul className="mt-3 divide-y divide-slate-100">
        {list.map((q) => {
          const notes = [
            q.revisionOf && `Modificación${q.revisionByName ? ` abierta por ${q.revisionByName}` : ""}${q.revisionReason ? `: ${q.revisionReason}` : ""}`,
            q.decision && `${q.decision.result === "approved" ? "Aprobada" : "Rechazada"} por ${q.decision.name} el ${formatDate(q.decision.at, true)}${q.decision.recordedByName ? ` (registrada por ${q.decision.recordedByName})` : ""}`,
            q.status === "superseded" && `Reemplazada${q.supersededAt ? ` el ${formatDate(q.supersededAt, true)}` : ""} por una versión más reciente`,
            q.discardedAt && `Descartada${q.discardedByName ? ` por ${q.discardedByName}` : ""}${q.discardReason ? `: ${q.discardReason}` : ""}`,
          ].filter(Boolean) as string[];
          const name = <>v{q.version}{q.id === currentId && <span className="ml-1 font-normal text-slate-400">(esta)</span>}</>;
          return (
            <li key={q.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">
                  {q.code} {linkTo && q.id !== currentId ? <Link to={linkTo(q)} className="text-brand-700 hover:underline">{name}</Link> : name}
                  <span className="ml-2 font-normal text-slate-500">{formatDate(q.createdAt)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular">{formatMoney(q.totals.total)}</span>
                  <QuoteStatusBadge status={q.status} discarded={!!q.discardedAt} />
                </span>
              </div>
              {notes.map((n, i) => <p key={i} className="mt-0.5 text-xs text-slate-500">{n}</p>)}
              {onResume && q.revisionOf && ["rejected", "expired"].includes(q.status) && (
                <button type="button" onClick={() => onResume(q)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">Retomar estos cambios en una nueva modificación</button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
