import { useState } from "react";
import { Loader2, Ticket, X } from "lucide-react";
import { formatMoney, normalizeCouponCode, type PublicCoupon } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";

const applyCouponPublic = callable<{ token: string; kind: "quote" | "wash"; code: string }, { code: string; discount: number; total: number }>("applyCouponPublic");
const removeCouponPublic = callable<{ token: string; kind: "quote" | "wash" }, { total: number }>("removeCouponPublic");

/**
 * "¿Tiene un cupón?" en el link del cliente (cotización pendiente o lavado sin pagar).
 * El nuevo total se ve al instante porque el servidor rehace la página pública.
 */
export function PublicCouponBox({
  token, kind, coupon, available, editable,
}: {
  token: string;
  kind: "quote" | "wash";
  coupon: PublicCoupon | null | undefined;
  /** hay cupones que el cliente puede usar */
  available: boolean;
  /** la cuenta todavía se puede cambiar (pendiente de aprobar / sin pagar) */
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  if (!coupon && (!editable || !available)) return null;

  const apply = async () => {
    const c = normalizeCouponCode(code);
    if (c.length < 3) return setError("Escriba el código de su cupón.");
    setBusy(true);
    setError("");
    setOk("");
    try {
      const r = await applyCouponPublic({ token, kind, code: c });
      setOk(`Cupón aplicado: ahorra ${formatMoney(r.discount)}. Nuevo total ${formatMoney(r.total)}.`);
      setCode("");
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      await removeCouponPublic({ token, kind });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4" data-testid="public-coupon">
      {coupon ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <Ticket className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">Cupón aplicado</span>
              <span className="tabular font-bold">− {formatMoney(coupon.discount)}</span>
            </div>
            <div className="mt-0.5 text-xs text-emerald-800/90"><span className="font-mono font-semibold">{coupon.code}</span>{coupon.name ? ` · ${coupon.name}` : ""}</div>
          </div>
          {editable && (
            <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" aria-label="Quitar cupón">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            </button>
          )}
        </div>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
          <Ticket className="h-4 w-4" /> ¿Tiene un cupón?
        </button>
      ) : (
        <form className="space-y-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="coupon-code">Código del cupón</label>
          <div className="flex gap-2">
            <input
              id="coupon-code" value={code} onChange={(e) => { setCode(normalizeCouponCode(e.target.value)); setError(""); }} maxLength={20} autoFocus autoComplete="off"
              placeholder="Ej. BIENVENIDO" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono text-base uppercase tracking-wide placeholder:font-sans placeholder:normal-case placeholder:tracking-normal focus:border-brand-500 focus:outline-none"
            />
            <button type="submit" disabled={busy} className="flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
            </button>
          </div>
          <button type="button" onClick={() => { setOpen(false); setError(""); }} className="text-xs font-semibold text-slate-500">Cancelar</button>
        </form>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800">{error}</p>}
      {ok && !error && <p className="mt-2 text-sm font-medium text-emerald-700">{ok}</p>}
    </div>
  );
}

/** Filas de descuento y cupón para el resumen de totales del cliente. */
export function CouponTotalsRows({ discount, couponDiscount, code }: { discount: number; couponDiscount?: number | null; code?: string | null }) {
  const coupon = couponDiscount ?? 0;
  const lines = discount - coupon;
  return (
    <>
      {lines > 0 && <div className="flex justify-between text-slate-600"><dt>Descuento</dt><dd className="tabular">- {formatMoney(lines)}</dd></div>}
      {coupon > 0 && <div className="flex justify-between text-emerald-700"><dt>Cupón{code ? ` ${code}` : ""}</dt><dd className="tabular">- {formatMoney(coupon)}</dd></div>}
    </>
  );
}
