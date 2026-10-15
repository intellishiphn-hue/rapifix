import { useState } from "react";
import { AlertTriangle, Ticket, X } from "lucide-react";
import { formatMoney, normalizeCouponCode } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

export interface CouponChipData {
  code: string;
  name?: string;
  discount: number;
}

/**
 * Campo "Cupón" del panel: escribir el código y Aplicar; si ya hay uno, chip con el descuento y quitar.
 * Muestra el motivo cuando no aplica. Un solo cupón por cuenta (no se acumulan).
 */
export function CouponField({
  applied, onApply, onRemove, notice, disabled, disabledHint, compact, className,
}: {
  applied: CouponChipData | null | undefined;
  onApply: (code: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  /** aviso del servidor (p. ej. "Se quitó el cupón X: compra mínima...") */
  notice?: string | null;
  disabled?: boolean;
  /** por qué no se puede cambiar (aprobada, cobrada...) */
  disabledHint?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    const c = normalizeCouponCode(code);
    if (c.length < 3) return setError("Escriba el código del cupón.");
    setBusy(true);
    setError(null);
    try {
      await onApply(c);
      setCode("");
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!onRemove) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-1.5", className)} data-testid="coupon-field">
      {applied ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Ticket className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-mono font-bold tracking-wide">{applied.code}</span>
            {applied.name && !compact && <span className="ml-2 hidden text-emerald-800/80 sm:inline">{applied.name}</span>}
          </div>
          <span className="tabular font-semibold">− {formatMoney(applied.discount)}</span>
          {onRemove && !disabled && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" aria-label="Quitar cupón" title="Quitar cupón">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : disabled ? (
        disabledHint ? <p className="text-xs text-slate-400">{disabledHint}</p> : null
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
          <Ticket className="h-4 w-4" /> Agregar cupón
        </button>
      ) : (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
          <div className="relative min-w-0 flex-1">
            <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={code} onChange={(e) => { setCode(normalizeCouponCode(e.target.value)); setError(null); }} placeholder="Código del cupón"
              className="pl-9 font-mono uppercase tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal" maxLength={20} autoFocus aria-label="Código del cupón" invalid={!!error}
            />
          </div>
          <Button type="submit" variant="secondary" loading={busy}>Aplicar</Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => { setOpen(false); setError(null); }} aria-label="Cancelar"><X className="h-4 w-4" /></Button>
        </form>
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      {notice && !error && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{notice}</p>
      )}
    </div>
  );
}
