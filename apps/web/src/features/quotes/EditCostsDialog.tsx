import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, Info, Lightbulb } from "lucide-react";
import { costOnlyChanges, formatMoney, QUOTE_ITEM_LABELS, quoteProfit, type Quote, type QuoteItemInput } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { updateQuoteCosts } from "./api";
import { MoneyInput } from "./MoneyInput";
import { versionLabel } from "./parts";

const pct = (profit: number, revenue: number) => (revenue ? `${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format((profit / revenue) * 100)} %` : "");
const tone = (profit: number) => (profit < 0 ? "text-red-700" : "text-emerald-700");

/** Botón "Editar costos" (solo para quienes ven costos; quien llama decide si se muestra). */
export function EditCostsButton({ quote, size = "sm", initialCosts, label = "Editar costos", onSaved }: {
  quote: Quote;
  size?: "sm" | "md";
  initialCosts?: Record<string, number>;
  label?: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" icon={<Calculator className="h-4 w-4" />} onClick={() => setOpen(true)}>{label}</Button>
      {open && <EditCostsDialog quote={quote} open initialCosts={initialCosts} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

/**
 * Corrige el costo interno de las líneas de una cotización enviada o aprobada.
 * Precio, cantidad y totales quedan como están: el cliente no ve este cambio.
 */
export function EditCostsDialog({ quote, open, onClose, initialCosts, onSaved }: {
  quote: Quote;
  open: boolean;
  onClose: () => void;
  /** costos sugeridos (ej. los que se pusieron en una modificación) */
  initialCosts?: Record<string, number>;
  onSaved?: () => void;
}) {
  const [costs, setCosts] = useState<Record<string, number>>(() =>
    Object.fromEntries(quote.items.map((it) => [it.id, initialCosts?.[it.id] ?? it.unitCost ?? 0])),
  );
  const [saving, setSaving] = useState(false);

  const changed = quote.items.filter((it) => (costs[it.id] ?? 0) !== (it.unitCost ?? 0));
  const before = quoteProfit(quote.items);
  const after = useMemo(() => quoteProfit(quote.items.map((it) => ({ ...it, unitCost: costs[it.id] ?? 0 }))), [quote.items, costs]);
  const revenue = quote.items.reduce((a, it) => a + it.lineTotal, 0);

  const save = async () => {
    if (!changed.length) return onClose();
    setSaving(true);
    try {
      const r = await updateQuoteCosts({ quoteId: quote.id, costs: changed.map((it) => ({ itemId: it.id, unitCost: costs[it.id] ?? 0 })) });
      toast.success(
        `Costos actualizados (${r.changed} ${r.changed === 1 ? "línea" : "líneas"}). Finanzas ya usa el costo nuevo.${r.revisionChanged ? " También se aplicó a la modificación abierta." : ""}`,
      );
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open} onClose={onClose} size="lg"
      title="Editar costos internos"
      description={`${versionLabel(quote)} · ${quote.customerName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={!changed.length}>Guardar costos</Button></>}
    >
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>El costo es interno: el cliente no ve este cambio y no necesita volver a aprobar. Los precios y el total se quedan igual.</p>
        </div>

        <ul className="space-y-2" data-testid="cost-lines">
          {quote.items.map((it) => {
            const cost = costs[it.id] ?? 0;
            const profit = it.lineTotal - Math.round(it.qty * cost);
            const dirty = cost !== (it.unitCost ?? 0);
            return (
              <li key={it.id} className={cn("rounded-xl border p-3", dirty ? "border-brand-200 bg-brand-50/40" : "border-slate-200")}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{it.description}</div>
                    <div className="text-xs text-slate-500">{QUOTE_ITEM_LABELS[it.type]} · cantidad {it.qty}</div>
                  </div>
                  {dirty && <span className="text-xs font-semibold text-brand-700">Antes {formatMoney(it.unitCost ?? 0)}</span>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 sm:items-end">
                  <div>
                    <div className="text-xs text-slate-500">Precio de venta</div>
                    <div className="tabular font-medium">{formatMoney(it.unitPrice)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Venta de la línea (sin ISV)</div>
                    <div className="tabular font-medium">{formatMoney(it.lineTotal)}</div>
                  </div>
                  <label className="block">
                    <span className="text-xs text-slate-500">Costo interno (c/u)</span>
                    <MoneyInput value={cost} onChange={(v) => setCosts((c) => ({ ...c, [it.id]: v }))} className="mt-0.5" />
                  </label>
                  <div className="text-right sm:text-left">
                    <div className="text-xs text-slate-500">Margen</div>
                    <div className={cn("tabular font-semibold", tone(profit))}>{formatMoney(profit)}</div>
                    <div className="text-xs text-slate-500">{pct(profit, it.lineTotal)}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <dl className="grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm">
          <div><dt className="text-xs text-slate-500">Utilidad antes</dt><dd className={cn("tabular font-semibold", tone(before))}>{formatMoney(before)}</dd><dd className="text-xs text-slate-500">{pct(before, revenue)}</dd></div>
          <div><dt className="text-xs text-slate-500">Utilidad después</dt><dd className={cn("tabular font-bold", tone(after))}>{formatMoney(after)}</dd><dd className="text-xs text-slate-500">{pct(after, revenue)}</dd></div>
          <div><dt className="text-xs text-slate-500">Diferencia</dt><dd className="tabular font-semibold">{after === before ? "Sin cambio" : `${after > before ? "+" : "−"} ${formatMoney(Math.abs(after - before))}`}</dd></div>
        </dl>
        <p className="text-xs text-slate-500">
          Utilidad sin ISV: venta de las líneas menos cantidad por costo. Queda registrado en el historial interno de la orden.
          {quote.costsUpdatedAt && ` Última corrección: ${quote.costsUpdatedByName ?? ""} el ${formatDate(quote.costsUpdatedAt, true)}.`}
        </p>
      </div>
    </Dialog>
  );
}

/**
 * En una modificación de una cotización aprobada: si lo ÚNICO que cambió es el costo interno,
 * sugiere corregirlo con "Editar costos" en vez de mandarle una actualización al cliente.
 */
export function CostOnlyHint({ base, lines, canEditCosts, onSaved }: {
  base: Quote;
  lines: QuoteItemInput[];
  canEditCosts: boolean;
  onSaved?: () => void;
}) {
  const changes = costOnlyChanges(base.items, lines);
  if (!changes) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-slate-800 sm:flex-row sm:items-center" data-testid="cost-only-hint">
      <Lightbulb className="h-5 w-5 shrink-0 text-brand-700" />
      <div className="flex-1">
        <p className="font-semibold">Solo cambió el costo interno.</p>
        <p className="mt-0.5 text-slate-600">
          El cliente no ve el costo, así que no hace falta enviarle una actualización.
          {canEditCosts ? " Use \"Editar costos\" en la cotización aprobada y luego descarte esta modificación." : " Pida a gerencia o administración que use \"Editar costos\" en la cotización aprobada."}
        </p>
      </div>
      {canEditCosts && (
        <EditCostsButton
          quote={base}
          label="Editar costos"
          initialCosts={Object.fromEntries(changes.map((c) => [c.itemId, c.after]))}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
