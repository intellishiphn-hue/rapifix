import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, HelpCircle, Plus, Search, Trash2, XCircle } from "lucide-react";
import { CatalogPicker, type CatalogPick } from "@/features/catalog/CatalogPicker";
import { fetchCost } from "@/features/catalog/api";
import {
  DECISION_CHANNEL_LABELS, formatMoney, QUOTE_ITEM_LABELS, QUOTE_ITEM_TYPES,
  type Quote, type QuoteItemInput, type QuoteItemType, type Totals,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { newId } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { recordQuoteDecision } from "./api";
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
      description={`${quote.code} · ${formatMoney(quote.totals.total)}`}
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
        <p className="text-xs text-slate-500">Quedará registrado que usted anotó la respuesta, con fecha y hora.</p>
      </div>
    </Dialog>
  );
}
