import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, Info, Lightbulb } from "lucide-react";
import {
  computeTechPay, formatMoney, internalOnlyChanges, QUOTE_ITEM_LABELS, quoteProfit, techPayBase, techPayEligible, techPayKey,
  type Quote, type QuoteItemInput, type TechPayShare,
} from "@rapifix/shared";
import { TechPayLineEditor } from "@/features/tech-pay/TechPayLineEditor";
import { useTechPayEmployees } from "@/features/tech-pay/api";
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
export function EditCostsButton({ quote, size = "sm", initialCosts, initialTechPay, label = "Editar costos", onSaved }: {
  quote: Quote;
  size?: "sm" | "md";
  initialCosts?: Record<string, number>;
  initialTechPay?: Record<string, TechPayShare[]>;
  label?: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" icon={<Calculator className="h-4 w-4" />} onClick={() => setOpen(true)}>{label}</Button>
      {open && <EditCostsDialog quote={quote} open initialCosts={initialCosts} initialTechPay={initialTechPay} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

/**
 * Corrige lo interno de las líneas de una cotización enviada o aprobada: el costo y, para quien tiene permiso,
 * el pago a técnicos de mano de obra y servicios. Precio, cantidad y totales quedan como están: el cliente no
 * ve este cambio y no necesita volver a aprobar.
 */
export function EditCostsDialog({ quote, open, onClose, initialCosts, initialTechPay, onSaved }: {
  quote: Quote;
  open: boolean;
  onClose: () => void;
  /** costos sugeridos (ej. los que se pusieron en una modificación) */
  initialCosts?: Record<string, number>;
  /** pago a técnicos sugerido (ej. el que se puso en una modificación) */
  initialTechPay?: Record<string, TechPayShare[]>;
  onSaved?: () => void;
}) {
  const tpe = useTechPayEmployees();
  const [costs, setCosts] = useState<Record<string, number>>(() =>
    Object.fromEntries(quote.items.map((it) => [it.id, initialCosts?.[it.id] ?? it.unitCost ?? 0])),
  );
  const [pay, setPay] = useState<Record<string, TechPayShare[]>>(() =>
    Object.fromEntries(quote.items.map((it) => [it.id, initialTechPay?.[it.id] ?? it.techPay ?? []])),
  );
  const [saving, setSaving] = useState(false);

  const costChanged = (it: Quote["items"][number]) => (costs[it.id] ?? 0) !== (it.unitCost ?? 0);
  const payChanged = (it: Quote["items"][number]) => tpe.enabled && techPayEligible(it.type) && techPayKey(pay[it.id]) !== techPayKey(it.techPay);
  const changed = quote.items.filter((it) => costChanged(it) || payChanged(it));
  const edited = useMemo(
    () => quote.items.map((it) => ({ ...it, unitCost: costs[it.id] ?? 0, ...(tpe.enabled ? { techPay: pay[it.id] ?? [] } : {}) })),
    [quote.items, costs, pay, tpe.enabled],
  );
  const before = quoteProfit(quote.items);
  const after = useMemo(() => quoteProfit(edited), [edited]);
  const revenue = quote.items.reduce((a, it) => a + it.lineTotal, 0);
  const payByItem = useMemo(() => computeTechPay(edited).byItem, [edited]);

  const save = async () => {
    if (!changed.length) return onClose();
    setSaving(true);
    try {
      const r = await updateQuoteCosts({
        quoteId: quote.id,
        costs: changed.map((it) => ({
          itemId: it.id,
          ...(costChanged(it) ? { unitCost: costs[it.id] ?? 0 } : {}),
          ...(payChanged(it) ? { techPay: pay[it.id]?.length ? pay[it.id] : null } : {}),
        })),
      });
      const parts = [
        r.changed ? `costo en ${r.changed} ${r.changed === 1 ? "línea" : "líneas"}` : "",
        r.techPayChanged ? `pago a técnicos en ${r.techPayChanged} ${r.techPayChanged === 1 ? "línea" : "líneas"}` : "",
      ].filter(Boolean).join(" y ");
      toast.success(
        `Actualizado: ${parts || "sin cambios"}. Finanzas ya usa los valores nuevos.${r.revisionChanged ? " También se aplicó a la modificación abierta." : ""}`,
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
      title={tpe.enabled ? "Editar costos y pago a técnicos" : "Editar costos internos"}
      description={`${versionLabel(quote)} · ${quote.customerName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={!changed.length}>Guardar cambios</Button></>}
    >
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{tpe.enabled ? "El costo y el pago a técnicos son internos" : "El costo es interno"}: el cliente no ve este cambio y no necesita volver a aprobar. Los precios y el total se quedan igual.</p>
        </div>

        <ul className="space-y-2" data-testid="cost-lines">
          {quote.items.map((it) => {
            const cost = costs[it.id] ?? 0;
            const linePay = payByItem[it.id] ?? 0;
            const profit = it.lineTotal - Math.round(it.qty * cost) - linePay;
            const dirty = costChanged(it) || payChanged(it);
            return (
              <li key={it.id} className={cn("rounded-xl border p-3", dirty ? "border-brand-200 bg-brand-50/40" : "border-slate-200")}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{it.description}</div>
                    <div className="text-xs text-slate-500">{QUOTE_ITEM_LABELS[it.type]} · cantidad {it.qty}</div>
                  </div>
                  {costChanged(it) && <span className="text-xs font-semibold text-brand-700">Costo antes {formatMoney(it.unitCost ?? 0)}</span>}
                  {payChanged(it) && <span className="text-xs font-semibold text-brand-700">Pago a técnico cambió</span>}
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
                {tpe.enabled && techPayEligible(it.type) && (
                  <div className="mt-2">
                    <TechPayLineEditor
                      value={pay[it.id]}
                      onChange={(v) => setPay((p) => ({ ...p, [it.id]: v }))}
                      base={techPayBase(it)}
                      employees={tpe.employees}
                      suggested={tpe.defaultsFor(quote.technicianIds ?? [])}
                    />
                  </div>
                )}
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
          Utilidad sin ISV: venta de las líneas menos cantidad por costo{tpe.enabled ? " y menos el pago a técnicos" : ""}. Queda registrado en el historial interno de la orden.
          {tpe.enabled && " Si la orden ya está cobrada, el pago a técnicos pendiente se recalcula solo; si ya se le pagó, queda marcado para revisar."}
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
  const changes = internalOnlyChanges(base.items, lines);
  if (!changes) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-slate-800 sm:flex-row sm:items-center" data-testid="cost-only-hint">
      <Lightbulb className="h-5 w-5 shrink-0 text-brand-700" />
      <div className="flex-1">
        <p className="font-semibold">Solo cambió lo interno (costo o pago a técnicos).</p>
        <p className="mt-0.5 text-slate-600">
          El cliente no lo ve, así que no hace falta enviarle una actualización.
          {canEditCosts ? " Use \"Editar costos\" en la cotización aprobada y luego descarte esta modificación." : " Pida a gerencia o administración que use \"Editar costos\" en la cotización aprobada."}
        </p>
      </div>
      {canEditCosts && (
        <EditCostsButton
          quote={base}
          label="Editar costos"
          initialCosts={changes.costs}
          initialTechPay={changes.techPay}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
