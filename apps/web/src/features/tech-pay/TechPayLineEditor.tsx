import { useEffect, useState } from "react";
import { HardHat, Plus, X } from "lucide-react";
import { formatMoney, shareAmount, TECH_PAY_MAX_SHARES, type TechPayShare } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { Input, Select } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import type { TechPayEmployee } from "./api";

/** Campo de porcentaje (0 a 100, hasta 2 decimales). */
export function PercentInput({ value, onChange, className, ariaLabel }: { value: number; onChange: (v: number) => void; className?: string; ariaLabel?: string }) {
  const fmt = (v: number) => (v ? String(Math.round(v * 100) / 100) : "");
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    if ((Number(text.replace(",", ".")) || 0) !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, "");
          setText(t);
          const n = Number(t.replace(",", "."));
          onChange(Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 100) / 100)) : 0);
        }}
        onBlur={() => setText(fmt(value))}
        className="tabular pr-7 text-right"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
    </div>
  );
}

/**
 * Pago a técnico de una línea de mano de obra o servicio (hasta 3 técnicos para repartir).
 * `base`: lo que paga el cliente por la línea sin ISV (después de descuento y cupón): base del porcentaje.
 * El monto fijo es por trabajo (por la línea completa), no por unidad.
 */
export function TechPayLineEditor({ value, onChange, base, employees, suggested }: {
  value: TechPayShare[] | null | undefined;
  onChange: (v: TechPayShare[]) => void;
  base: number;
  employees: TechPayEmployee[];
  /** técnicos sugeridos para agregar (los de la orden) */
  suggested?: TechPayShare[];
}) {
  const shares = value ?? [];
  const total = shares.reduce((a, s) => a + shareAmount(s, base), 0);
  const used = new Set(shares.map((s) => s.employeeId));
  const set = (i: number, patch: Partial<TechPayShare>) => onChange(shares.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => {
    const sug = suggested?.find((s) => !used.has(s.employeeId));
    if (sug) return onChange([...shares, sug]);
    const e = employees.find((x) => !used.has(x.id));
    if (!e) return;
    onChange([...shares, { employeeId: e.id, employeeName: e.displayName, mode: "percent", percent: e.techPay?.mode === "percent" ? e.techPay.percent : 0 }]);
  };
  const pick = (i: number, id: string) => {
    const e = employees.find((x) => x.id === id);
    if (!e) return;
    const d = e.techPay;
    set(i, d && d.mode !== "none"
      ? (d.mode === "percent" ? { employeeId: e.id, employeeName: e.displayName, mode: "percent", percent: d.percent, amount: null } : { employeeId: e.id, employeeName: e.displayName, mode: "fixed", amount: d.fixedAmount, percent: null })
      : { employeeId: e.id, employeeName: e.displayName });
  };

  return (
    <div className="w-full rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-2.5 py-2" data-testid="techpay-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><HardHat className="h-3.5 w-3.5 text-slate-400" />Pago a técnico</span>
        {shares.length > 0 && <span className="text-[11px] text-slate-500">sobre {formatMoney(base)} sin ISV</span>}
        <span className="tabular ml-auto text-xs font-semibold text-slate-800">{shares.length ? formatMoney(total) : ""}</span>
      </div>
      {shares.length > 0 && (
        <ul className="mt-2 space-y-2">
          {shares.map((s, i) => {
            const amount = shareAmount(s, base);
            const missing = !employees.some((e) => e.id === s.employeeId);
            return (
              <li key={`${s.employeeId}-${i}`} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 border-t border-slate-200/70 pt-2 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7.5rem_6.5rem_auto]">
                <Select value={s.employeeId} onChange={(e) => pick(i, e.target.value)} className="col-span-2 h-9 text-sm sm:col-span-1" aria-label="Técnico">
                  {missing && <option value={s.employeeId}>{s.employeeName || "Empleado"}</option>}
                  {employees.filter((e) => e.id === s.employeeId || !used.has(e.id)).map((e) => <option key={e.id} value={e.id}>{e.displayName}{e.noAccess ? " (sin acceso)" : ""}</option>)}
                </Select>
                <Select
                  value={s.mode}
                  onChange={(e) => set(i, e.target.value === "percent" ? { mode: "percent", percent: s.percent ?? 0, amount: null } : { mode: "fixed", amount: s.amount ?? 0, percent: null })}
                  className="h-9 text-sm" aria-label="Forma de pago"
                >
                  <option value="percent">Porcentaje</option>
                  <option value="fixed">Monto fijo</option>
                </Select>
                {s.mode === "percent"
                  ? <PercentInput value={s.percent ?? 0} onChange={(v) => set(i, { percent: v })} className="[&_input]:h-9" ariaLabel="Porcentaje" />
                  : <MoneyInput value={s.amount ?? 0} onChange={(v) => set(i, { amount: v })} className="[&_input]:h-9" />}
                <span className="tabular hidden text-right text-sm font-semibold text-slate-900 sm:block">{formatMoney(amount)}</span>
                <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                  <span className="text-xs text-slate-500 sm:hidden">Le toca</span>
                  <span className="tabular text-sm font-semibold text-slate-900 sm:hidden">{formatMoney(amount)}</span>
                  <button type="button" onClick={() => onChange(shares.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Quitar a ${s.employeeName}`}><X className="h-4 w-4" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {shares.length < TECH_PAY_MAX_SHARES && employees.length > shares.length && (
          <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
            <Plus className="h-3.5 w-3.5" />{shares.length ? "Repartir con otro técnico" : "Agregar pago a técnico"}
          </button>
        )}
        {shares.some((s) => s.mode === "fixed") && <span className="text-[11px] text-slate-500">El monto fijo es por trabajo, no por unidad.</span>}
      </div>
    </div>
  );
}
