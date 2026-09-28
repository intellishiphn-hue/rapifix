import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { BadgeCheck, Check, CheckCircle2, Clock, CreditCard, Droplets, Gift, Loader2, MapPin, MessageCircle, Phone, ShieldCheck, XCircle, Banknote } from "lucide-react";
import {
  formatMoney, loyaltyProgressText, normalizePhone, PUBLIC_WASHES, VEHICLE_SIZE_LABELS, WASH_COVERAGE_LABELS, WASH_STATUS_LABELS, whatsappLink,
  type PublicWash,
} from "@rapifix/shared";
import { callable, db } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { card, PublicShell } from "./PortalPage";
import { ProofStatus, ProofUpload } from "./ProofUpload";

const createOnlinePayment = callable<{ token: string; origin: string; kind: "wash" }, { checkoutUrl: string }>("createOnlinePayment");
const checkOnlinePayment = callable<{ token: string; kind: "wash" }, { status: string }>("checkOnlinePayment");

/** Número de RAPIFIX si en Configuración no se ha puesto otro */
const RAPIFIX_PHONE = "92854852";
const TOKEN_RE = /^[2-9A-HJ-NP-Z]{10}$/;
const STEPS = ["waiting", "washing", "ready", "delivered"] as const;

/** Página pública del lavado (/lavado/:token): estado, detalle, pago con tarjeta o comprobante, y sellos. */
export function WashPublicPage() {
  const { token = "" } = useParams();
  const [wash, setWash] = useState<PublicWash | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "offline">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!TOKEN_RE.test(token)) {
      setState("missing");
      return;
    }
    setState("loading");
    // Sin respuesta del servidor en 15 s: problema de conexión (no "link inválido")
    const timer = setTimeout(() => setState((s) => (s === "loading" ? "offline" : s)), 15000);
    const unsub = onSnapshot(
      doc(db, PUBLIC_WASHES, token),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists() || snap.data().active === false) {
          // La caché local no sabe si existe: se espera la respuesta del servidor
          if (snap.metadata.fromCache) return;
          clearTimeout(timer);
          setState("missing");
          return;
        }
        clearTimeout(timer);
        setWash(snap.data() as PublicWash);
        setState("ready");
      },
      () => {
        clearTimeout(timer);
        setState("missing");
      },
    );
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [token, attempt]);

  if (state === "loading") {
    return <PublicShell label="Su lavado"><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-brand-600" aria-label="Cargando" /></div></PublicShell>;
  }
  if (state === "offline") {
    return (
      <PublicShell label="Su lavado">
        <div className={cn(card, "py-12 text-center")}>
          <h1 className="text-lg font-bold">No pudimos cargar su lavado</h1>
          <p className="mt-2 text-sm text-slate-500">Revise su conexión a internet e intente de nuevo.</p>
          <button onClick={() => setAttempt((n) => n + 1)} className="mt-5 h-11 rounded-xl bg-brand-600 px-6 text-sm font-bold text-white hover:bg-brand-700">Intentar de nuevo</button>
        </div>
      </PublicShell>
    );
  }
  if (state === "missing" || !wash) {
    return (
      <PublicShell label="Su lavado">
        <div className={cn(card, "py-12 text-center")}>
          <Droplets className="mx-auto h-8 w-8 text-slate-300" />
          <h1 className="mt-3 text-lg font-bold">Este link no está disponible</h1>
          <p className="mt-2 text-sm text-slate-500">Puede que haya expirado o que el enlace esté incompleto. Pida uno nuevo en el carwash.</p>
        </div>
      </PublicShell>
    );
  }
  return <WashView wash={wash} token={token} />;
}

function WashView({ wash: w, token }: { wash: PublicWash; token: string }) {
  const waNumber = w.business.whatsapp || w.business.phone || RAPIFIX_PHONE;
  const callNumber = normalizePhone(w.business.phone || w.business.whatsapp || RAPIFIX_PHONE);
  const contact = whatsappLink(waNumber, `Hola, les escribo por el lavado ${w.code} (placa ${formatPlate(w.plate)}).`);
  const cancelled = w.status === "cancelled";
  const stepIdx = STEPS.indexOf(w.status as (typeof STEPS)[number]);

  return (
    <PublicShell name={w.business.name} logoUrl={w.business.logoUrl} label="Su lavado">
      {/* Estado */}
      <section className={card}>
        <p className="text-sm text-slate-500">Hola{w.customerFirstName ? ` ${w.customerFirstName}` : ""}, este es su lavado</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="rounded-md border-2 border-slate-800 px-2 py-0.5 font-mono text-lg font-extrabold tracking-wider text-slate-900">{formatPlate(w.plate)}</span>
          <span className="text-sm text-slate-500">{w.code} · {VEHICLE_SIZE_LABELS[w.size] ?? w.size}</span>
        </div>
        <div className={cn("mt-4 rounded-xl p-4", cancelled ? "bg-red-50" : w.status === "ready" || w.status === "delivered" ? "bg-emerald-50" : "bg-brand-50")}>
          <div className="flex items-center gap-2 font-bold">
            {cancelled ? <XCircle className="h-5 w-5 text-red-600" /> : w.status === "ready" || w.status === "delivered" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Droplets className="h-5 w-5 text-brand-600" />}
            {cancelled ? "Lavado cancelado" : w.status === "ready" ? "¡Su vehículo está listo!" : WASH_STATUS_LABELS[w.status]}
          </div>
          {!cancelled && (
            <ol className="mt-3 grid grid-cols-4 gap-1.5">
              {STEPS.map((s, i) => (
                <li key={s} className="text-center">
                  <span className={cn("block h-2 rounded-full", i <= stepIdx ? (stepIdx >= 2 ? "bg-emerald-500" : "bg-brand-600") : "bg-white")} />
                  <span className={cn("mt-1 block text-[11px]", i === stepIdx ? "font-bold text-slate-900" : "text-slate-500")}>{WASH_STATUS_LABELS[s]}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {w.createdAt && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> Registrado {formatDate(w.createdAt, true)}</p>}
      </section>

      {/* Detalle */}
      <section className={card}>
        <h2 className="font-bold">Servicios</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {w.items.map((it, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div>
                <div className="font-medium text-slate-900">{it.name}</div>
                {it.covered && <div className="text-xs font-semibold text-emerald-700">{WASH_COVERAGE_LABELS[it.covered]}</div>}
              </div>
              <div className="tabular shrink-0 text-right">
                {it.price !== it.listPrice && <s className="mr-1.5 text-xs text-slate-400">{formatMoney(it.listPrice)}</s>}
                <span className="font-semibold">{formatMoney(it.price)}</span>
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          {w.discount > 0 && <div className="flex justify-between text-slate-600"><dt>Descuento</dt><dd className="tabular">- {formatMoney(w.discount)}</dd></div>}
          {w.totals.tax > 0 && <div className="flex justify-between text-slate-600"><dt>ISV incluido</dt><dd className="tabular">{formatMoney(w.totals.tax)}</dd></div>}
          <div className="flex justify-between pt-1 text-lg font-extrabold"><dt>Total</dt><dd className="tabular">{formatMoney(w.total)}</dd></div>
        </dl>
      </section>

      {!cancelled && <WashPaySection wash={w} token={token} />}

      {/* Lealtad */}
      {w.loyalty && (() => {
        // Los sellos de regalo de la tarjeta nueva se muestran desde ya (se guardan al pagar el primer lavado)
        const gift = w.loyalty.pendingWelcome;
        const count = Math.min(w.loyalty.every - 1, w.loyalty.count + gift);
        return (
        <section className={card}>
          <h2 className="flex items-center gap-2 font-bold"><Gift className="h-5 w-5 text-violet-600" /> Tarjeta de lealtad</h2>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${count} de ${w.loyalty.every} sellos`}>
            {w.loyalty.every <= 20 && Array.from({ length: w.loyalty.every }, (_, i) => (
              <span key={i} className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2", i < count ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 text-slate-300")}>
                {i === w.loyalty!.every - 1 ? <Gift className="h-3.5 w-3.5" /> : i < count ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
            ))}
          </div>
          <p className="mt-3 text-sm font-medium text-slate-800">{loyaltyProgressText(count, w.loyalty.every, w.loyalty.rewardsAvailable)}</p>
          {gift > 0 && (
            <p className="mt-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-800">¡Bienvenido! Le regalamos {gift} sello{gift === 1 ? "" : "s"} para empezar. Con cada lavado pagado suma uno más.</p>
          )}
        </section>
        );
      })()}

      {/* Membresía */}
      {w.membership && (
        <section className={card}>
          <h2 className="flex items-center gap-2 font-bold"><BadgeCheck className="h-5 w-5 text-emerald-600" /> Membresía {w.membership.planName}</h2>
          <p className="mt-2 text-sm text-slate-600">
            {w.membership.code} · vigente hasta {formatDate(new Date(w.membership.paidUntil))}
            {w.membership.washesPerMonth != null ? ` · ${w.membership.usedInPeriod} de ${w.membership.washesPerMonth} lavados usados este mes` : " · lavados ilimitados"}
          </p>
        </section>
      )}

      {/* Contacto */}
      <section className={cn(card, "space-y-3")}>
        <a href={contact} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1faa53] text-base font-bold text-white hover:bg-[#178a43]">
          <MessageCircle className="h-5 w-5" /> Escribir por WhatsApp
        </a>
        <a href={`tel:${callNumber}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 text-base font-bold text-slate-800 hover:bg-slate-50">
          <Phone className="h-5 w-5" /> Llamar a {w.business.name}
        </a>
        {(w.business.address || w.business.hours) && (
          <div className="space-y-1 text-sm text-slate-600">
            {w.business.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{w.business.address}{w.business.city ? `, ${w.business.city}` : ""}</p>}
            {w.business.hours && <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{w.business.hours}</p>}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Este enlace es personal. No lo comparta.</p>
      </section>
    </PublicShell>
  );
}

/** Pago del lavado: tarjeta (ROKI, confirmado solo por el servidor) o comprobante de transferencia. */
function WashPaySection({ wash: w, token }: { wash: PublicWash; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnState] = useState(() => new URLSearchParams(window.location.search).get("pago"));
  const [checking, setChecking] = useState(returnState === "ok" && !w.paid);
  const checked = useRef(false);

  useEffect(() => {
    if (returnState !== "ok" || checked.current) return;
    checked.current = true;
    let tries = 0;
    const run = async () => {
      tries++;
      const r = await checkOnlinePayment({ token, kind: "wash" }).catch(() => ({ status: "pending" }));
      if (r.status === "paid" || tries >= 4) setChecking(false);
      else setTimeout(() => void run(), 4000);
    };
    void run();
  }, [returnState, token]);

  useEffect(() => {
    // Limpia ?pago= de la barra para que al recargar no se repita el aviso
    if (returnState) window.history.replaceState(null, "", window.location.pathname);
  }, [returnState]);

  if (w.total <= 0) {
    return <section className={card}><p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" /> Este lavado no tiene cobro.</p></section>;
  }

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const { checkoutUrl } = await createOnlinePayment({ token, origin: window.location.origin, kind: "wash" });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const banks = w.banks ?? [];
  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-bold"><CreditCard className="h-5 w-5 text-brand-600" /> Pago</h2>
      <div className="mt-3 flex justify-between text-lg font-extrabold"><span>{w.paid ? "Total" : "Total a pagar"}</span><span className="tabular">{formatMoney(w.total)}</span></div>
      {w.paid ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" /> Pago confirmado. ¡Gracias!</p>
      ) : checking ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-800"><Loader2 className="h-4 w-4 animate-spin" /> Verificando su pago con el banco…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {returnState === "ok" && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Su pago se está procesando. En unos minutos se verá reflejado aquí. Si ya le cobraron, no lo intente de nuevo.</p>}
          {returnState === "cancelado" && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No se realizó el pago. Puede intentarlo de nuevo cuando guste.</p>}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <ProofStatus proof={w.proof} paid={w.paid} />
          {w.onlinePayment.enabled && w.proof?.status !== "pending" && (
            <>
              <button onClick={() => void pay()} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />} Pagar con tarjeta {formatMoney(w.balance)}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Pago seguro con tarjeta a través de ROKI</p>
            </>
          )}
          <ProofUpload token={token} kind="wash" banks={banks} defaultAmount={w.balance} proof={w.proof} />
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><Banknote className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /> <span><b className="text-slate-800">Efectivo:</b> puede pagar en caja al retirar su vehículo.</span></p>
        </div>
      )}
    </section>
  );
}
