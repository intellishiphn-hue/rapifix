import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarCheck, CheckCircle2, Clock, Loader2, MessageCircle } from "lucide-react";
import { FirebaseError } from "firebase/app";
import {
  WEB_REASONS, bookableDays, publicAppointmentSchema, reasonForCategory, weekdayOf,
  type PublicAppointmentInput, type PublicAppointmentResult, type PublicSlotsResult, type WebReason,
} from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import "./landing.css";
import { CATALOG } from "./catalog";
import { BUSINESS, waLink } from "./business";
import { Nav } from "./Nav";
import { Footer } from "./Sections";

const getSlots = callable<{ date: string }, PublicSlotsResult>("publicAppointmentSlots");
const requestAppointment = callable<PublicAppointmentInput, PublicAppointmentResult>("requestAppointmentPublic");

const DAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dayParts = (k: string) => {
  const [, m, d] = k.split("-").map(Number);
  return { wd: weekdayOf(k), m: m! - 1, d: d! };
};
export const longDate = (k: string) => {
  const p = dayParts(k);
  return `${DAY_LONG[p.wd]} ${p.d} de ${MONTH_LONG[p.m]}`;
};
/** "09:30" → "9:30 a.m." */
export function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h! < 12 ? "a.m." : "p.m."}`;
}

type Errors = Partial<Record<"name" | "phone" | "plate" | "vehicle" | "comment" | "date" | "time" | "form", string>>;

function useBookingSeo() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Agenda tu cita | RAPIFIX Centro Automotriz";
    return () => {
      document.title = prev;
    };
  }, []);
}

export function BookingPage() {
  useBookingSeo();
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    const m = params.get("motivo") ?? "";
    if (WEB_REASONS.some((r) => r.id === m)) return { reason: m as WebReason, detail: "" };
    const cat = CATALOG.find((c) => c.id === m);
    if (cat) return { reason: reasonForCategory(cat.id), detail: reasonForCategory(cat.id) === "otro" ? cat.short : "" };
    return { reason: "mantenimiento" as WebReason, detail: "" };
  }, [params]);

  const days = useMemo(() => bookableDays(Date.now()), []);
  const [reason, setReason] = useState<WebReason>(initial.reason);
  const [detail] = useState(initial.detail);
  const [date, setDate] = useState<string>(days[0] ?? "");
  const [slots, setSlots] = useState<{ state: "loading" | "ready" | "error"; list: string[] }>({ state: "loading", list: [] });
  const [time, setTime] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", plate: "", vehicle: "", comment: "", website: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PublicAppointmentResult | null>(null);
  const reqId = useRef(0);
  const ids = { name: useId(), phone: useId(), plate: useId(), vehicle: useId(), comment: useId() };

  const loadSlots = (d: string) => {
    const my = ++reqId.current;
    setSlots({ state: "loading", list: [] });
    getSlots({ date: d })
      .then((r) => {
        if (my === reqId.current) setSlots({ state: "ready", list: r.slots });
      })
      .catch(() => {
        if (my === reqId.current) setSlots({ state: "error", list: [] });
      });
  };
  useEffect(() => {
    if (date) loadSlots(date);
    setTime("");
  }, [date]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: PublicAppointmentInput = { ...form, reason, detail, date, time };
    const parsed = publicAppointmentSchema.safeParse(payload);
    if (!parsed.success || !time) {
      const errs: Errors = {};
      if (!time) errs.time = "Elige una hora disponible.";
      for (const i of parsed.success ? [] : parsed.error.issues) {
        const k = String(i.path[0]) as keyof Errors;
        if (!errs[k]) errs[k] = k === "phone" ? "Escribe un número válido (8 dígitos en Honduras o con código de país)." : i.message;
      }
      setErrors(errs);
      const first = Object.keys(errs)[0];
      if (first && first in ids) document.getElementById(ids[first as keyof typeof ids])?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await requestAppointment(payload);
      setDone(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code.replace(/^functions\//, "") : "";
      if (code === "already-exists" || code === "failed-precondition") {
        setTime("");
        loadSlots(date);
        setErrors({ time: "Ese horario ya no está disponible. Elige otra hora." });
      } else {
        setErrors({ form: code === "internal" || !code ? "No pudimos enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo, o escríbenos por WhatsApp." : errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  const reasonLabel = WEB_REASONS.find((r) => r.id === reason)?.label ?? "";

  return (
    <div className="lp">
      <Nav base="/inicio" current="agendar" />
      <main id="contenido" className="bg-[var(--lp-paper)]">
        <section className="lp-hero relative overflow-hidden pb-16 pt-[120px] text-white sm:pb-20 sm:pt-[140px]">
          <div className="lp-noise" aria-hidden />
          <div className="lp-wrap relative mx-auto max-w-[760px] !px-4 sm:!px-0">
            <h1 className="lp-display lp-in text-[clamp(2.4rem,5vw,4rem)] leading-[0.98]">{done ? "Solicitud recibida" : "Agenda tu cita"}</h1>
            <p className="lp-lead lp-in mt-5 max-w-[34rem] text-white/80" style={{ ["--d" as string]: "120ms" }}>
              {done ? "Gracias por elegir RAPIFIX." : "Elige el motivo, el día y la hora. Te confirmaremos por WhatsApp."}
            </p>
          </div>
        </section>

        <div className="lp-wrap relative -mt-8 pb-24 sm:pb-32">
          {done ? (
            <Success done={done} reason={reasonLabel} name={form.name} />
          ) : (
            <form onSubmit={submit} noValidate className="mx-auto max-w-[760px] space-y-6 rounded-[28px] bg-white p-5 shadow-[0_30px_80px_-50px_rgb(1_25_85/0.5)] sm:p-9" aria-busy={busy}>
              {/* Motivo */}
              <fieldset>
                <legend className="lp-display text-[1.15rem] text-[var(--lp-navy)]">Motivo</legend>
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Motivo de la cita">
                  {WEB_REASONS.map((r) => (
                    <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)} className={cn("lp-chip inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-medium", reason === r.id ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[rgb(1_25_85/0.16)] bg-white text-[var(--lp-navy)]")}>
                      {r.label}
                    </button>
                  ))}
                </div>
                {detail && reason === "otro" && <p className="mt-2 text-sm text-[var(--lp-mute)]">Servicio: {detail}</p>}
              </fieldset>

              {/* Fecha */}
              <fieldset>
                <legend className="lp-display text-[1.15rem] text-[var(--lp-navy)]">Día</legend>
                <div className="lp-chips -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="radiogroup" aria-label="Día de la cita">
                  {days.map((k) => {
                    const p = dayParts(k);
                    const on = date === k;
                    return (
                      <button key={k} type="button" role="radio" aria-checked={on} aria-label={longDate(k)} onClick={() => setDate(k)} className={cn("flex min-h-[64px] w-[64px] shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition-colors", on ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[rgb(1_25_85/0.14)] bg-white text-[var(--lp-navy)] hover:border-[var(--lp-navy)]")}>
                        <span className={cn("text-[11px] uppercase", on ? "text-white/70" : "text-[var(--lp-mute)]")}>{DAY[p.wd]}</span>
                        <span className="lp-display text-[1.25rem] leading-none">{p.d}</span>
                        <span className={cn("text-[11px]", on ? "text-white/70" : "text-[var(--lp-mute)]")}>{MONTH[p.m]}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Hora */}
              <fieldset>
                <legend className="lp-display text-[1.15rem] text-[var(--lp-navy)]">Hora {date && <span className="font-sans text-sm font-normal text-[var(--lp-mute)]">({longDate(date)})</span>}</legend>
                {slots.state === "loading" && (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Cargando horas">
                    {Array.from({ length: 12 }, (_, i) => <span key={i} className="h-11 animate-pulse rounded-xl bg-[var(--lp-paper)]" />)}
                  </div>
                )}
                {slots.state === "error" && (
                  <p className="mt-3 text-sm text-[var(--lp-red-ink)]">
                    No pudimos cargar las horas. <button type="button" className="font-semibold underline" onClick={() => loadSlots(date)}>Intentar de nuevo</button>
                  </p>
                )}
                {slots.state === "ready" && slots.list.length === 0 && <p className="mt-3 text-sm text-[var(--lp-mute)]">No quedan horas libres ese día. Elige otro día.</p>}
                {slots.state === "ready" && slots.list.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Hora de la cita">
                    {slots.list.map((t) => (
                      <button key={t} type="button" role="radio" aria-checked={time === t} onClick={() => setTime(t)} className={cn("lp-chip min-h-[44px] rounded-xl border text-sm font-semibold", time === t ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[rgb(1_25_85/0.14)] bg-white text-[var(--lp-navy)]")}>
                        {timeLabel(t)}
                      </button>
                    ))}
                  </div>
                )}
                {errors.time && <p role="alert" className="mt-2 text-sm font-medium text-[var(--lp-red-ink)]">{errors.time}</p>}
              </fieldset>

              {/* Datos */}
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="lp-display mb-3 text-[1.15rem] text-[var(--lp-navy)]">Tus datos</legend>
                <Field id={ids.name} label="Nombre" error={errors.name}>
                  <input id={ids.name} value={form.name} onChange={set("name")} autoComplete="name" maxLength={80} className="bk-input" aria-invalid={!!errors.name} />
                </Field>
                <Field id={ids.phone} label="Teléfono o WhatsApp" below="Honduras +504. Si es de otro país, escribe el código (+1, +502...)." error={errors.phone}>
                  <input id={ids.phone} value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="9999-9999" className="bk-input" aria-invalid={!!errors.phone} />
                </Field>
                <Field id={ids.plate} label="Placa (opcional)" error={errors.plate}>
                  <input id={ids.plate} value={form.plate} onChange={set("plate")} maxLength={12} autoCapitalize="characters" className="bk-input" />
                </Field>
                <Field id={ids.vehicle} label="Marca y modelo (opcional)" error={errors.vehicle}>
                  <input id={ids.vehicle} value={form.vehicle} onChange={set("vehicle")} maxLength={60} className="bk-input" />
                </Field>
                <div className="sm:col-span-2">
                  <Field id={ids.comment} label="Comentario (opcional)" hint={`${form.comment.length}/500`} error={errors.comment}>
                    <textarea id={ids.comment} value={form.comment} onChange={set("comment")} maxLength={500} rows={3} className="bk-input resize-y py-3" placeholder="Cuéntanos qué notas en tu vehículo" />
                  </Field>
                </div>
                {/* Campo trampa para bots (oculto para personas y lectores de pantalla) */}
                <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
                  <label>
                    Sitio web
                    <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                  </label>
                </div>
              </fieldset>

              {errors.form && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.form}</p>}

              <div className="flex flex-col gap-3 border-t border-[var(--lp-line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[var(--lp-mute)]">
                  {time ? `${reasonLabel}, ${longDate(date)} a las ${timeLabel(time)}` : "Horario: lunes a viernes 8:00 a.m. a 5:00 p.m., sábado 8:00 a.m. a 3:00 p.m."}
                </p>
                <button type="submit" disabled={busy} className="lp-btn lp-btn-red shrink-0 disabled:opacity-70">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarCheck className="h-4 w-4" aria-hidden />} Solicitar cita
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
      <Footer base="/inicio" />
    </div>
  );
}

function Field({ id, label, hint, below, error, children }: { id: string; label: string; hint?: string; below?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-[var(--lp-navy)]">{label}</label>
        {hint && <span className="text-xs text-[var(--lp-mute)]">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
      {below && !error && <p className="mt-1.5 text-xs text-[var(--lp-mute)]">{below}</p>}
      {error && <p role="alert" className="mt-1.5 text-sm font-medium text-[var(--lp-red-ink)]">{error}</p>}
    </div>
  );
}

function Success({ done, reason, name }: { done: PublicAppointmentResult; reason: string; name: string }) {
  const summary = `Hola, RAPIFIX. Soy ${name.trim()}. Pedí una cita en la web para ${longDate(done.date)} a las ${timeLabel(done.time)} (${reason})`;
  const wa = waLink(summary);
  return (
    <div className="mx-auto max-w-[620px] rounded-[28px] bg-white p-7 text-center shadow-[0_30px_80px_-50px_rgb(1_25_85/0.5)] sm:p-10" role="status">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
      <p className="lp-display mt-5 text-[1.5rem] leading-tight text-[var(--lp-navy)]">
        Recibimos tu solicitud para el {longDate(done.date)} a las {timeLabel(done.time)}
      </p>
      <p className="mt-3 text-[var(--lp-mute)]">Te confirmaremos por WhatsApp.</p>
      <p className="mt-2 flex items-center justify-center gap-2 text-sm text-[var(--lp-mute)]"><Clock className="h-4 w-4" aria-hidden /> {reason}{BUSINESS.address ? `. ${BUSINESS.address.street}, ${BUSINESS.address.city}.` : "."}</p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa">
            <MessageCircle className="h-4 w-4" aria-hidden /> Enviar resumen por WhatsApp
          </a>
        )}
        <Link to="/inicio" className="lp-btn lp-btn-line">Volver al inicio</Link>
      </div>
    </div>
  );
}
