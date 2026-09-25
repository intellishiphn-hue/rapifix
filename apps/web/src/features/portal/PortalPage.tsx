import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { Check, CheckCircle2, Clock, CreditCard, HelpCircle, Phone, Loader2, MapPin, MessageCircle, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { formatMoney, normalizePhone, QUOTE_ITEM_LABELS, whatsappLink, type PublicPortal } from "@rapifix/shared";

/** Número de RAPIFIX (9285-4852) si en Configuración no se ha puesto otro */
const RAPIFIX_PHONE = "92854852";
import { callable, db } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { LogoMark } from "@/components/common/Logo";

const respondToQuote = callable<{ token: string; action: "approve" | "reject" | "question"; name?: string; comment?: string }, { result: string; approvalId?: string }>("respondToQuote");
const markQuoteViewed = callable<{ token: string }, { ok: boolean }>("markQuoteViewed");
const createOnlinePayment = callable<{ token: string; origin: string }, { checkoutUrl: string }>("createOnlinePayment");
const checkOnlinePayment = callable<{ token: string }, { status: string }>("checkOnlinePayment");

/** Pago en línea (ROKI). El pago solo se da por hecho cuando el servidor lo confirma con ROKI. */
function OnlinePaySection({ portal, token }: { portal: PublicPortal; token: string }) {
  const op = portal.onlinePayment;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnState] = useState(() => new URLSearchParams(window.location.search).get("pago"));
  const [checking, setChecking] = useState(returnState === "ok");
  const checked = useRef(false);

  useEffect(() => {
    if (returnState !== "ok" || checked.current) return;
    checked.current = true;
    let tries = 0;
    const run = async () => {
      tries++;
      const r = await checkOnlinePayment({ token }).catch(() => ({ status: "pending" }));
      if (r.status === "paid" || tries >= 4) setChecking(false);
      else setTimeout(() => void run(), 4000);
    };
    void run();
  }, [returnState, token]);

  useEffect(() => {
    // Limpia ?pago= de la barra para que al recargar no se repita el aviso
    if (returnState) window.history.replaceState(null, "", window.location.pathname);
  }, [returnState]);

  if (!op || portal.kind === "quote" || op.total <= 0) return null;
  const paidInFull = op.balance <= 0 && op.paid > 0;
  if (!op.enabled && !paidInFull) return null;
  const quotePending = portal.quote && (portal.quote.status === "sent" || portal.quote.status === "viewed");

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const { checkoutUrl } = await createOnlinePayment({ token, origin: window.location.origin });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 font-bold"><CreditCard className="h-5 w-5 text-brand-600" /> Pago</h2>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between text-slate-600"><dt>Total de la orden</dt><dd className="tabular">{formatMoney(op.total)}</dd></div>
        {op.paid > 0 && <div className="flex justify-between text-slate-600"><dt>Pagado</dt><dd className="tabular">{formatMoney(op.paid)}</dd></div>}
        <div className="flex justify-between pt-1 text-lg font-extrabold"><dt>{paidInFull ? "Saldo" : "Saldo a pagar"}</dt><dd className="tabular">{formatMoney(Math.max(0, op.balance))}</dd></div>
      </dl>
      {paidInFull ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" /> ¡Orden pagada! Gracias.</p>
      ) : quotePending ? (
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Primero apruebe la cotización. En cuanto la apruebe, aquí mismo le aparece el botón para pagar en línea.</p>
      ) : checking ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-800"><Loader2 className="h-4 w-4 animate-spin" /> Verificando su pago con el banco…</p>
      ) : (
        <>
          {returnState === "ok" && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Su pago se está procesando. En unos minutos se verá reflejado aquí. Si ya le cobraron, no lo intente de nuevo.</p>}
          {returnState === "cancelado" && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No se realizó el pago. Puede intentarlo de nuevo cuando guste.</p>}
          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button onClick={() => void pay()} disabled={busy} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-bold text-white hover:bg-brand-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />} Pagar en línea {formatMoney(op.balance)}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Pago seguro con tarjeta a través de ROKI</p>
        </>
      )}
    </section>
  );
}

type Action = "approve" | "reject" | "question";

const STAGE_LABELS: Record<string, string> = {
  reception: "Recepción", damage: "Daños que ya tenía", diagnosis: "Diagnóstico", before: "Antes", during: "Durante la reparación", after: "Terminado",
};
const STAGE_ORDER = ["reception", "damage", "diagnosis", "before", "during", "after"];
function photoGroups(photos: PublicPortal["photos"]): Array<[string, PublicPortal["photos"]]> {
  const map = new Map<string, PublicPortal["photos"]>();
  for (const ph of photos) map.set(ph.stage || "other", [...(map.get(ph.stage || "other") ?? []), ph]);
  return [...map.entries()].sort((a, b) => (STAGE_ORDER.indexOf(a[0]) + 100) % 100 - (STAGE_ORDER.indexOf(b[0]) + 100) % 100);
}
const fuelLabel = (n: number) => (n <= 0 ? "Vacío" : n >= 8 ? "Lleno" : n === 4 ? "1/2 tanque" : n === 2 ? "1/4 de tanque" : n === 6 ? "3/4 de tanque" : `${n}/8 de tanque`);

function Shell({ children, portal }: { children: React.ReactNode; portal?: PublicPortal | null }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-ink-900 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {portal?.workshop.logoUrl ? (
            <img src={portal.workshop.logoUrl} alt={portal.workshop.name} className="h-9 max-w-[160px] rounded bg-white/95 object-contain p-1" />
          ) : (
            <>
              <LogoMark />
              <div className="text-lg font-extrabold tracking-tight">RAPI<span className="text-brand-400">FIX</span></div>
            </>
          )}
          <span className="ml-auto text-xs text-slate-400">{portal?.kind === "quote" ? "Cotización" : "Estado de su vehículo"}</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">{children}</main>
      <footer className="pb-10 pt-4 text-center text-xs text-slate-400">
        {portal?.workshop.name ?? "RAPIFIX"} · Sistema de Gestión para Taller Automotriz
      </footer>
    </div>
  );
}

const card = "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-card)]";

export function PortalPage() {
  const { token = "" } = useParams();
  const [portal, setPortal] = useState<PublicPortal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!/^[2-9A-HJ-NP-Z]{10}$/.test(token)) {
      setState("missing");
      return;
    }
    return onSnapshot(
      doc(db, "publicPortal", token),
      (snap) => {
        if (!snap.exists() || snap.data().active === false) {
          setState("missing");
          return;
        }
        setPortal(snap.data() as PublicPortal);
        setState("ready");
      },
      () => setState("missing"),
    );
  }, [token]);

  if (state === "loading") return <Shell><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div></Shell>;
  if (state === "missing" || !portal) {
    return (
      <Shell>
        <div className={cn(card, "py-12 text-center")}>
          <h1 className="text-lg font-bold">Este link no está disponible</h1>
          <p className="mt-2 text-sm text-slate-500">Puede que haya expirado o que el enlace esté incompleto. Contacte al taller para recibir uno nuevo.</p>
        </div>
      </Shell>
    );
  }
  return <PortalView portal={portal} token={token} />;
}

export function PortalView({ portal, token }: { portal: PublicPortal; token: string }) {
  const [action, setAction] = useState<Action | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Cotizaciones ya respondidas desde este navegador: los botones no vuelven a aparecer
  const [answered, setAnswered] = useState<string | null>(null);
  const viewed = useRef(false);
  const quoteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (portal.quote?.status === "sent" && !viewed.current) {
      viewed.current = true;
      markQuoteViewed({ token }).catch(() => undefined);
    }
    if (portal.quote && window.location.pathname.endsWith("/cotizacion")) {
      setTimeout(() => quoteRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
    }
  }, [portal.quote, token]);

  const p = portal;
  const q = p.quote;
  const pending = q && (q.status === "sent" || q.status === "viewed") && answered !== q.id;
  // WhatsApp y teléfono del taller (Configuración); si aún no están puestos, los de RAPIFIX
  const waNumber = p.workshop.whatsapp || p.workshop.phone || RAPIFIX_PHONE;
  const callNumber = normalizePhone(p.workshop.phone || p.workshop.whatsapp || RAPIFIX_PHONE);
  const vehicleText = `${p.vehicle.make} ${p.vehicle.model}${p.vehicle.plate ? ` (placa ${formatPlate(p.vehicle.plate)})` : ""}`;
  const contact = whatsappLink(waNumber, `Hola, les escribo por la orden ${p.orderCode} de mi ${vehicleText}.`);
  const last = p.updates[0];
  // "Tengo una pregunta" abre el WhatsApp del taller con el mensaje listo
  const questionLink = q ? whatsappLink(waNumber, `Hola, tengo una pregunta sobre la cotización ${q.code} de mi ${vehicleText}.`) : null;

  const submit = async () => {
    if (!action) return;
    if (action !== "approve" && !comment.trim()) {
      setNotice({ tone: "err", text: action === "question" ? "Escriba su pregunta." : "Cuéntenos el motivo para ayudarle mejor." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (q && action !== "question") setAnswered(q.id);
      await respondToQuote({ token, action, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setNotice({
        tone: "ok",
        text: action === "approve" ? "¡Gracias! Su aprobación quedó registrada. Iniciaremos el trabajo." : action === "reject" ? "Registramos su respuesta. El taller se comunicará con usted." : "Enviamos su pregunta al taller. Le responderemos pronto.",
      });
      setAction(null);
      setComment("");
    } catch (err) {
      const msg = errorMessage(err);
      // Si el servidor dice que ya fue respondida, no se vuelve a ofrecer
      if (!/ya fue aprobada|ya no está disponible|expiró/i.test(msg)) setAnswered(null);
      setNotice({ tone: "err", text: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell portal={p}>
      {/* Cotización previa (aún sin orden) */}
      {p.kind === "quote" && (
        <section className={card}>
          <p className="text-sm text-slate-500">Hola{p.customerFirstName ? ` ${p.customerFirstName}` : ""}, esta es la cotización para su</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{p.vehicle.make} {p.vehicle.model} {p.vehicle.year || ""}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <span className="rounded-md border-2 border-slate-800 px-1.5 font-mono text-xs font-bold text-slate-900">{formatPlate(p.vehicle.plate)}</span>
            {p.orderCode}
          </div>
          {q?.status === "approved" && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">¡Gracias! Su cotización está aprobada. Cuando traiga su vehículo, en este mismo link podrá seguir el avance de la reparación.</p>}
        </section>
      )}

      {/* Vehículo y estado */}
      {p.kind !== "quote" && <section className={card}>
        <p className="text-sm text-slate-500">Hola{p.customerFirstName ? ` ${p.customerFirstName}` : ""}, este es el estado de su</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{p.vehicle.make} {p.vehicle.model} {p.vehicle.year}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <span className="rounded-md border-2 border-slate-800 px-1.5 font-mono text-xs font-bold text-slate-900">{formatPlate(p.vehicle.plate)}</span>
          Orden {p.orderCode}
        </div>

        <div className={cn("mt-5 rounded-xl p-4", p.cancelled ? "bg-red-50" : p.percent >= 100 ? "bg-emerald-50" : "bg-brand-50")}>
          <div className="flex items-center gap-2 font-bold">
            {p.cancelled ? <XCircle className="h-5 w-5 text-red-600" /> : p.percent >= 100 ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Wrench className="h-5 w-5 text-brand-600" />}
            {p.delivered ? "Vehículo entregado" : p.statusLabel}
          </div>
          {!p.cancelled && (
            <>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white">
                <div className={cn("h-full rounded-full transition-all", p.percent >= 100 ? "bg-emerald-500" : "bg-brand-600")} style={{ width: `${p.percent}%` }} />
              </div>
              <div className="mt-1.5 text-xs font-semibold text-slate-600">{p.percent}% completado</div>
            </>
          )}
        </div>

        {!p.cancelled && (
          <ol className="mt-5 space-y-2.5">
            {p.steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", s.done ? "bg-emerald-500 text-white" : s.current ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border-2 border-slate-200 bg-white")}>
                  {s.done ? <Check className="h-3.5 w-3.5" /> : s.current ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                </span>
                <span className={cn(s.done ? "text-slate-700" : s.current ? "font-bold text-slate-900" : "text-slate-400")}>{s.label}</span>
              </li>
            ))}
          </ol>
        )}

        {last && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Clock className="h-3.5 w-3.5" /> Última actualización · {formatDate(last.at, true)}</div>
            <p className="mt-1 text-sm text-slate-800">"{last.text}"</p>
          </div>
        )}
        {p.nextStep && <p className="mt-3 text-sm text-slate-600">Próximo paso: <b>{p.nextStep}</b></p>}
      </section>}

      {notice && (
        <div className={cn("rounded-2xl p-4 text-sm font-medium", notice.tone === "ok" ? "bg-emerald-600 text-white" : "bg-red-50 text-red-800")}>{notice.text}</div>
      )}

      {/* Diagnóstico */}
      {p.diagnosis?.summary && (
        <section className={card}>
          <h2 className="font-bold">Diagnóstico</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{p.diagnosis.summary}</p>
          {p.diagnosis.recommendations && <p className="mt-3 whitespace-pre-line text-sm text-slate-600"><b>Recomendaciones:</b> {p.diagnosis.recommendations}</p>}
        </section>
      )}

      {/* Cotización */}
      {q && (
        <section ref={quoteRef} className={cn(card, pending && "ring-2 ring-brand-500")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">Cotización {q.code}</h2>
              {q.validUntil && pending && <p className="text-xs text-slate-500">Válida hasta {formatDate(q.validUntil)}</p>}
            </div>
            {q.status === "approved" && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Aprobada</span>}
            {q.status === "rejected" && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">Rechazada</span>}
            {q.status === "expired" && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">Expirada</span>}
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {q.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{it.description}</div>
                  <div className="text-xs text-slate-500">{QUOTE_ITEM_LABELS[it.type]} · {it.qty} × {formatMoney(it.unitPrice)}{it.discount ? ` · desc. ${formatMoney(it.discount)}` : ""}</div>
                </div>
                <div className="tabular shrink-0 font-semibold">{formatMoney(it.lineTotal)}</div>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular">{formatMoney(q.totals.subtotal)}</dd></div>
            {q.totals.discount > 0 && <div className="flex justify-between text-slate-600"><dt>Descuento</dt><dd className="tabular">- {formatMoney(q.totals.discount)}</dd></div>}
            <div className="flex justify-between text-slate-600"><dt>ISV ({q.taxRate}%)</dt><dd className="tabular">{formatMoney(q.totals.tax)}</dd></div>
            <div className="flex justify-between pt-1 text-lg font-extrabold"><dt>Total</dt><dd className="tabular">{formatMoney(q.totals.total)}</dd></div>
          </dl>
          {q.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{q.notes}</p>}

          {pending && !action && (
            <div className="mt-5 grid gap-2">
              <button onClick={() => setAction("approve")} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"><CheckCircle2 className="h-5 w-5" /> APROBAR COTIZACIÓN</button>
              <div className="grid grid-cols-2 gap-2">
                {questionLink ? (
                  <a href={questionLink} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><HelpCircle className="h-4 w-4" /> Tengo una pregunta</a>
                ) : (
                  <button onClick={() => setAction("question")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><HelpCircle className="h-4 w-4" /> Tengo una pregunta</button>
                )}
                <button onClick={() => setAction("reject")} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold text-red-600 hover:bg-red-50"><XCircle className="h-4 w-4" /> Rechazar</button>
              </div>
              <a href={`tel:${callNumber}`} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Phone className="h-4 w-4" /> Llamar a {p.workshop.name}</a>
            </div>
          )}

          {action && (
            <div className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
              <p className="font-semibold">{action === "approve" ? `Confirmar aprobación por ${formatMoney(q.totals.total)}` : action === "reject" ? "Rechazar cotización" : "Enviar una pregunta al taller"}</p>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={3} placeholder={action === "approve" ? "Comentario (opcional)" : action === "reject" ? "Motivo" : "Su pregunta"} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm focus:border-brand-500 focus:outline-none" />
              {action === "approve" && <p className="text-xs text-slate-500">Al confirmar, autoriza a {p.workshop.name} a realizar los trabajos cotizados. Se guardará la fecha y hora de su aprobación.</p>}
              <div className="flex gap-2">
                <button onClick={() => setAction(null)} className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-sm font-semibold">Volver</button>
                <button onClick={() => void submit()} disabled={busy} className={cn("flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60", action === "reject" ? "bg-red-600" : action === "approve" ? "bg-emerald-600" : "bg-brand-600")}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <OnlinePaySection portal={p} token={token} />

      {/* Recepción del vehículo */}
      {p.kind !== "quote" && p.reception && (
        <section className={card}>
          <h2 className="font-bold">Así recibimos su vehículo</h2>
          {p.reception.receivedAt && <p className="text-xs text-slate-500">{formatDate(p.reception.receivedAt, true)}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Kilometraje</div>
              <div className="tabular font-bold">{new Intl.NumberFormat("es-HN").format(p.reception.mileageIn)} km</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Combustible</div>
              <div className="mt-1 flex gap-0.5" aria-label={`${p.reception.fuelLevel} de 8`}>
                {Array.from({ length: 8 }, (_, i) => <span key={i} className={cn("h-3 flex-1 rounded-sm", i < p.reception!.fuelLevel ? "bg-emerald-500" : "bg-slate-200")} />)}
              </div>
              <div className="mt-1 text-xs text-slate-600">{fuelLabel(p.reception.fuelLevel)}</div>
            </div>
          </div>
          {p.reception.items.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lo que dejó con el vehículo</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {p.reception.items.map((it) => <span key={it} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"><Check className="h-3 w-3" />{it}</span>)}
              </div>
            </div>
          )}
          {[["Exterior", p.reception.exteriorNotes], ["Interior", p.reception.interiorNotes], ["Accesorios", p.reception.accessories], ["Otros objetos", p.reception.otherObjects]]
            .filter(([, v]) => v)
            .map(([label, v]) => <p key={label} className="mt-2 text-sm text-slate-700"><b>{label}:</b> {v}</p>)}
        </section>
      )}

      {/* Fotos (por etapa) */}
      {p.photos.length > 0 && (
        <section className={card}>
          <h2 className="font-bold">Fotos de su vehículo</h2>
          {photoGroups(p.photos).map(([stage, list]) => (
            <div key={stage} className="mt-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{STAGE_LABELS[stage] ?? "Fotos"}</div>
              <div className="grid grid-cols-3 gap-2">
                {list.map((ph, i) => (
                  <a key={i} href={ph.url} target="_blank" rel="noreferrer" className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                    <img src={ph.url} alt={ph.caption} loading="lazy" className="h-full w-full object-cover" />
                    {ph.caption && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{ph.caption}</span>}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Actualizaciones */}
      {p.updates.length > 1 && (
        <section className={card}>
          <h2 className="font-bold">Actualizaciones</h2>
          <ol className="mt-3 space-y-3">
            {p.updates.map((u, i) => (
              <li key={i} className="border-l-2 border-brand-200 pl-3 text-sm">
                <div className="text-xs text-slate-500">{formatDate(u.at, true)}</div>
                <div className="text-slate-800">{u.text}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Contacto */}
      <section className={cn(card, "space-y-3")}>
        {(
          <a href={contact} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1faa53] text-base font-bold text-white hover:bg-[#178a43]">
            <MessageCircle className="h-5 w-5" /> Escribir por WhatsApp
          </a>
        )}
        {(
          <a href={`tel:${callNumber}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 text-base font-bold text-slate-800 hover:bg-slate-50">
            <Phone className="h-5 w-5" /> Llamar a {p.workshop.name}
          </a>
        )}
        {(p.workshop.address || p.workshop.hours) && (
          <div className="space-y-1 text-sm text-slate-600">
            {p.workshop.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{p.workshop.address}{p.workshop.city ? `, ${p.workshop.city}` : ""}</p>}
            {p.workshop.hours && <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{p.workshop.hours}</p>}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Este enlace es personal. No lo comparta.</p>
      </section>
    </Shell>
  );
}
