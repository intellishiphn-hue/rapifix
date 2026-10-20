import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Camera, Check, CircleCheck, Clock, CreditCard, FileCheck2, Link2, MapPin, MessageCircle, Navigation, Phone, ScanSearch, Wrench,
} from "lucide-react";
import { PORTAL_STEPS, STATUS_META, type WorkOrderStatus } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { categoryById } from "./catalog";
import { BUSINESS, WA_MESSAGES, activeSocial, addressLines, telLink, waLink } from "./business";
import { FleetLineup } from "./Art";
import { BrandLogo } from "./Brand";
import { useScrollProgress } from "./motion";

/* ---------------------------------------------------------------- Flotillas */

export function FleetSection() {
  const fleet = categoryById("flotillas");
  const wa = waLink(WA_MESSAGES.fleet);
  return (
    <section id="flotillas" className="lp-section relative overflow-hidden bg-[var(--lp-navy)] py-24 text-white sm:py-32">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "88px 88px" }} />
      <div className="lp-wrap relative">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div data-reveal>
            <h2 className="lp-display lp-h2">Soluciones automotrices para flotillas.</h2>
            <p className="lp-lead mt-7 max-w-[34rem] text-[var(--lp-mute-dark)]">
              En RAPIFIX apoyamos el mantenimiento de flotillas institucionales con servicios preventivos y correctivos,
              seguimiento por vehículo y documentación técnica de los trabajos realizados.
            </p>
            <p className="mt-4 max-w-[34rem] text-[0.98rem] leading-relaxed text-white/70">{fleet.intro}</p>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-red mt-10">
                Solicitar información para mi flotilla <ArrowRight className="lp-arrow h-4 w-4" aria-hidden />
              </a>
            )}
            <FleetLineup className="mt-14 hidden w-full max-w-[520px] text-[var(--lp-electric)] lg:block" />
          </div>
          <div data-reveal style={{ ["--d" as string]: "120ms" }}>
            <div className="rounded-[28px] border border-white/12 bg-white/[0.04] p-6 backdrop-blur-sm sm:p-9">
              <h3 className="lp-display lp-h3">Lo que incluye el servicio a flotillas</h3>
              <ul className="mt-6 divide-y divide-white/10">
                {fleet.jobs.map((j) => (
                  <li key={j} className="flex gap-4 py-4 text-[1rem] leading-snug text-white/90">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--lp-electric)]/20 text-[var(--lp-electric)]"><Check className="h-3.5 w-3.5" aria-hidden /></span>
                    {j}
                  </li>
                ))}
              </ul>
            </div>
            <FleetLineup className="mt-10 w-full text-[var(--lp-electric)] lg:hidden" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Tecnología y seguimiento */

const TRACK_FEATURES = [
  { icon: Wrench, title: "Estado y avance", text: "La etapa en la que va tu vehículo, el porcentaje de avance y las actualizaciones del taller." },
  { icon: FileCheck2, title: "Cotización en línea", text: "Revisa el detalle y apruébala, recházala o envíanos una pregunta. Si surge un cambio durante el trabajo, te llega para aprobarlo." },
  { icon: Camera, title: "Fotos y recepción", text: "Fotos por etapa, el kilometraje, el nivel de combustible y lo que dejaste en el vehículo al recibirlo." },
  { icon: CreditCard, title: "Pago a tu manera", text: "Con tarjeta en línea a través de ROKI, subiendo tu comprobante de transferencia o en efectivo al retirar." },
];

export function TrackingSection() {
  return (
    <section id="tecnologia" className="lp-section lp-light relative overflow-hidden bg-[var(--lp-paper)] py-24 sm:py-32">
      <div className="lp-wrap grid items-center gap-16 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
        <div className="order-2 flex justify-center lg:order-1" data-reveal>
          <PhoneMockup />
        </div>
        <div className="order-1 lg:order-2">
          <div data-reveal>
            <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">Tu vehículo está en nuestras manos. Tú sigues al tanto.</h2>
            <p className="lp-lead mt-7 max-w-[36rem] text-[var(--lp-mute)]">
              Cuando recibimos tu vehículo te enviamos por WhatsApp un enlace personal. Desde tu celular ves cómo va el trabajo,
              sin llamadas ni esperas, y decides con la información a la vista.
            </p>
          </div>
          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {TRACK_FEATURES.map((f, i) => (
              <li key={f.title} data-reveal style={{ ["--d" as string]: `${(i % 2) * 90}ms` }}>
                <f.icon className="h-6 w-6 text-[var(--lp-electric-ink)]" aria-hidden strokeWidth={1.8} />
                <h3 className="lp-display mt-3 text-[1.12rem] leading-tight text-[var(--lp-navy)]">{f.title}</h3>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-[var(--lp-mute)]">{f.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 flex max-w-[36rem] items-start gap-3 rounded-2xl border border-[var(--lp-line)] bg-white p-4 text-[0.92rem] leading-relaxed text-[var(--lp-mute)]" data-reveal>
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lp-navy)]" aria-hidden />
            <span>Cada enlace es único y solo muestra la orden de tu vehículo. ¿Lo perdiste? Escríbenos y te lo reenviamos.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function PhoneMockup() {
  const current = 4; // "Reparación en proceso"
  const percent = Math.round(((current + 0.5) / PORTAL_STEPS.length) * 100);
  return (
    <figure className="relative w-[300px] max-w-full sm:w-[330px]">
      <div className="absolute -inset-10 -z-10 rounded-full bg-[var(--lp-electric)]/15 blur-3xl" aria-hidden />
      <div className="lp-phone" aria-hidden>
        <div className="lp-phone-screen">
          <div className="flex items-center justify-between bg-[var(--lp-navy)] px-5 pb-3 pt-7 text-white">
            <span className="lp-display text-[15px]">RAPIFIX</span>
            <span className="text-[10px] text-white/60">Estado de su vehículo</span>
          </div>
          <div className="space-y-3 p-3.5">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Este es el estado de su</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">EJEMPLO</span>
              </div>
              <div className="mt-0.5 text-[17px] font-extrabold tracking-tight text-slate-900">Sedán 2019</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="rounded border-2 border-slate-800 px-1 font-mono text-[10px] font-bold text-slate-900">ABC 1234</span>
                Orden OT-0000
              </div>
              <div className="mt-3 rounded-xl bg-[#eef3ff] p-3">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-900"><Wrench className="h-3.5 w-3.5 text-[var(--lp-electric-ink)]" /> {STATUS_META.IN_REPAIR.label}</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                  <div className="lp-phone-bar h-full rounded-full bg-[var(--lp-electric-ink)]" style={{ width: `${percent}%` }} />
                </div>
                <div className="mt-1 text-[10px] font-semibold text-slate-600">{percent}% completado</div>
              </div>
              <ol className="mt-3 space-y-1.5">
                {PORTAL_STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-2 text-[11px]">
                    <span className={cn("flex h-4 w-4 items-center justify-center rounded-full", i < current ? "bg-emerald-500 text-white" : i === current ? "bg-[var(--lp-electric-ink)] ring-[3px] ring-[#dbe5ff]" : "border-2 border-slate-200")}>
                      {i < current && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className={i < current ? "text-slate-700" : i === current ? "font-bold text-slate-900" : "text-slate-400"}>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white p-3.5 shadow-sm">
              <div>
                <div className="text-[12px] font-bold text-slate-900">Cotización COT-0000</div>
                <div className="text-[10px] text-slate-500">Aprobada en línea</div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><CircleCheck className="h-3 w-3" /> Aprobada</span>
            </div>
            <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1faa53] text-[12px] font-bold text-white"><MessageCircle className="h-3.5 w-3.5" /> Escribir por WhatsApp</div>
          </div>
        </div>
      </div>
      <figcaption className="mt-5 text-center text-sm text-[var(--lp-mute)]">Ejemplo ilustrativo del enlace de seguimiento. Datos ficticios.</figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------- Proceso */

const STAGES: Array<{ title: string; text: string; statuses: WorkOrderStatus[] }> = [
  { title: "Recepción del vehículo", text: "Registramos tu vehículo con su kilometraje, nivel de combustible, lo que dejas en él y fotos de cómo llegó.", statuses: ["RECEIVED", "INSPECTION"] },
  { title: "Inspección y diagnóstico", text: "Revisamos el vehículo y diagnosticamos la falla, con escáner en los sistemas compatibles.", statuses: ["DIAGNOSIS", "AWAITING_QUOTE"] },
  { title: "Cotización y aprobación", text: "Te enviamos la cotización detallada. Tú decides y puedes aprobarla en línea desde tu enlace.", statuses: ["QUOTE_SENT", "AWAITING_APPROVAL", "APPROVED"] },
  { title: "Reparación", text: "Hacemos el trabajo aprobado. Si aparece algo nuevo, te enviamos la actualización para que la apruebes antes de continuar.", statuses: ["IN_REPAIR", "WAITING_PARTS"] },
  { title: "Control de calidad", text: "Revisamos el trabajo terminado antes de entregarte el vehículo.", statuses: ["QUALITY_CONTROL"] },
  { title: "Entrega del vehículo", text: "Te avisamos cuando está listo. Pagas en línea, con transferencia o en caja, y lo retiras.", statuses: ["READY", "DELIVERED"] },
];

export function ProcessSection() {
  const [p, setP] = useState(0);
  const ref = useScrollProgress<HTMLOListElement>(setP);
  const on = Math.floor(p * STAGES.length + 0.35);
  return (
    <section id="proceso" aria-labelledby="proceso-t" className="lp-section relative bg-[var(--lp-night)] py-24 text-white sm:py-32">
      <div className="lp-wrap grid gap-14 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <div className="lg:sticky lg:top-28 lg:self-start" data-reveal>
          <h2 id="proceso-t" className="lp-display lp-h2">Así cuidamos tu vehículo, paso a paso.</h2>
          <p className="lp-lead mt-7 max-w-[30rem] text-[var(--lp-mute-dark)]">
            Cada orden avanza por las mismas etapas que ves en tu enlace de seguimiento. Sabes qué se está haciendo y qué sigue.
          </p>
        </div>
        <ol ref={ref} className="relative" style={{ ["--p" as string]: p }}>
          <span className="lp-rail" aria-hidden><span className="lp-rail-fill" /></span>
          {STAGES.map((s, i) => (
            <li key={s.title} className="lp-step relative flex gap-6 pb-12 last:pb-0" data-on={i < on || p >= 1}>
              <span className="lp-step-dot relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[var(--lp-night)] text-[0.95rem] font-semibold text-white/70">
                {i + 1}
              </span>
              <div className="lp-step-body pt-2">
                <h3 className="lp-display lp-h3">{s.title}</h3>
                <p className="mt-2 max-w-[32rem] text-[0.98rem] leading-relaxed text-[var(--lp-mute-dark)]">{s.text}</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Estados de la orden en esta etapa">
                  {s.statuses.map((st) => (
                    <li key={st} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/75">{STATUS_META[st].label}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Contacto */

export function ContactSection() {
  const tel = telLink();
  const lines = addressLines();
  const options = [
    { icon: ScanSearch, title: "Consultar un servicio", text: "Cuéntanos qué notas en tu vehículo o qué servicio buscas.", href: waLink(WA_MESSAGES.services), cta: "Consultar" },
    { icon: FileCheck2, title: "Información para flotillas", text: "Mantenimiento programado para empresas e instituciones.", href: waLink(WA_MESSAGES.fleet), cta: "Solicitar" },
    { icon: Link2, title: "Seguimiento de mi vehículo", text: "Abre el enlace que te enviamos por WhatsApp. Si no lo tienes, te lo reenviamos.", href: waLink(WA_MESSAGES.tracking), cta: "Pedir enlace" },
  ].filter((o) => o.href);

  return (
    <section id="contacto" className="lp-section lp-light relative bg-white py-24 sm:py-32">
      <div className="lp-wrap">
        <div className="max-w-[44rem]" data-reveal>
          <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">¿Qué necesita tu vehículo?</h2>
          <p className="lp-lead mt-6 text-[var(--lp-mute)]">Cuéntanos qué necesitas y te orientaremos sobre el siguiente paso.</p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* Canal principal */}
          <div className="relative overflow-hidden rounded-[28px] bg-[var(--lp-navy)] p-7 text-white sm:p-10" data-reveal>
            <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-[var(--lp-red)]/25 blur-3xl" aria-hidden />
            <p className="relative text-[0.95rem] text-[var(--lp-mute-dark)]">WhatsApp y teléfono</p>
            {BUSINESS.phoneDisplay && <p className="lp-display relative mt-2 text-[clamp(2.4rem,6vw,3.6rem)] leading-none">{BUSINESS.phoneDisplay}</p>}
            <div className="relative mt-8 flex flex-wrap gap-3">
              {waLink(WA_MESSAGES.contact) && (
                <a href={waLink(WA_MESSAGES.contact)!} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa">
                  <MessageCircle className="h-5 w-5" aria-hidden /> Escribir por WhatsApp
                </a>
              )}
              {tel && (
                <a href={tel} className="lp-btn lp-btn-ghost">
                  <Phone className="h-4 w-4" aria-hidden /> Llamar
                </a>
              )}
            </div>
            {BUSINESS.hours && (
              <div className="relative mt-10 border-t border-white/12 pt-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-white"><Clock className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden /> Horario de atención</p>
                <dl className="mt-3 grid max-w-sm grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.93rem] sm:gap-x-6 sm:text-[0.95rem]">
                  {BUSINESS.hours.map((h) => (
                    <div key={h.days} className="contents">
                      <dt className="text-[var(--lp-mute-dark)]">{h.days}</dt>
                      <dd className={cn("whitespace-nowrap", h.hours ? "text-white" : "text-white/60")}>{h.hours ?? "Cerrado"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* Opciones */}
          <ul className="grid gap-4">
            {options.map((o, i) => (
              <li key={o.title} data-reveal style={{ ["--d" as string]: `${i * 80}ms` }}>
                <a href={o.href!} target="_blank" rel="noopener noreferrer" className="group flex h-full items-center gap-5 rounded-[22px] border border-[var(--lp-line)] bg-[var(--lp-paper)] p-5 transition-colors hover:border-[rgb(1_25_85/0.3)] hover:bg-white sm:p-6">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--lp-navy)] shadow-sm"><o.icon className="h-5 w-5" aria-hidden strokeWidth={1.8} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="lp-display block text-[1.08rem] leading-tight text-[var(--lp-navy)]">{o.title}</span>
                    <span className="mt-1 block text-[0.92rem] leading-snug text-[var(--lp-mute)]">{o.text}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-[var(--lp-electric-ink)] sm:flex">
                    {o.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                  </span>
                  <span className="sr-only"> (abre WhatsApp)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Ubicación */}
        {lines.length > 0 && (
          <div className="mt-4 grid overflow-hidden rounded-[28px] border border-[var(--lp-line)] lg:grid-cols-[1fr_1.1fr]" data-reveal>
            <div className="p-7 sm:p-10">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--lp-navy)]"><MapPin className="h-4 w-4 text-[var(--lp-red-ink)]" aria-hidden /> Dónde estamos</p>
              <address className="mt-4 not-italic">
                <span className="lp-display block text-[clamp(1.35rem,2.4vw,1.75rem)] leading-tight text-[var(--lp-navy)]">{lines[0]}</span>
                {lines.slice(1).map((l) => <span key={l} className="mt-1 block text-[1.02rem] text-[var(--lp-ink)]">{l}</span>)}
              </address>
              {BUSINESS.googleName && <p className="mt-3 text-[0.95rem] text-[var(--lp-mute)]">En Google Maps nos encuentras como {BUSINESS.googleName}.</p>}
              {BUSINESS.mapsUrl && (
                <a href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-navy mt-7">
                  <Navigation className="h-4 w-4" aria-hidden /> Cómo llegar
                </a>
              )}
            </div>
            <MapArt />
          </div>
        )}
      </div>
    </section>
  );
}

/** Bloque visual de ubicación (no es un mapa real: evita cargar Google Maps) */
function MapArt() {
  return (
    <div className="relative min-h-[240px] overflow-hidden bg-[var(--lp-navy)]" aria-hidden>
      <svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id="lp-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0 L0 0 0 40" fill="none" stroke="rgb(255 255 255 / 0.06)" />
          </pattern>
          <radialGradient id="lp-map-glow" cx="0.55" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#3b8cff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#3b8cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="600" height="340" fill="url(#lp-map-grid)" />
        <rect width="600" height="340" fill="url(#lp-map-glow)" />
        <path d="M-20 250 C120 230 220 190 330 170 S520 120 640 80" stroke="rgb(255 255 255 / 0.55)" strokeWidth="14" fill="none" strokeLinecap="round" />
        <path d="M-20 250 C120 230 220 190 330 170 S520 120 640 80" stroke="#011955" strokeWidth="2" strokeDasharray="10 12" fill="none" />
        <path d="M120 -20 C150 80 170 160 200 360" stroke="rgb(255 255 255 / 0.18)" strokeWidth="6" fill="none" />
        <path d="M440 -20 C430 90 410 180 430 360" stroke="rgb(255 255 255 / 0.18)" strokeWidth="6" fill="none" />
        <path d="M-20 90 C140 110 300 80 640 120" stroke="rgb(255 255 255 / 0.12)" strokeWidth="4" fill="none" />
        <circle cx="330" cy="170" r="34" fill="#EA0101" opacity="0.18" />
        <path d="M330 168 C330 168 304 140 304 122 C304 107 316 96 330 96 C344 96 356 107 356 122 C356 140 330 168 330 168 Z" fill="#EA0101" />
        <circle cx="330" cy="122" r="9" fill="#fff" />
      </svg>
      {BUSINESS.address && <span className="absolute bottom-4 left-5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 backdrop-blur">{BUSINESS.address.street}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- Footer */

function SocialIcon({ label }: { label: string }) {
  if (label === "Facebook") {
    return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden fill="currentColor"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z" /></svg>;
  }
  if (label === "Instagram") {
    return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden fill="currentColor"><path d="M16.5 3c.3 2.1 1.6 3.6 3.5 3.8v3c-1.3 0-2.5-.4-3.5-1v6.4A5.8 5.8 0 1 1 10.7 9.4v3.1a2.8 2.8 0 1 0 2.8 2.8V3h3z" /></svg>;
}

export function Footer() {
  const { status } = useAuth();
  const signedIn = status === "ready" || status === "noRole";
  const wa = waLink(WA_MESSAGES.general);
  const tel = telLink();
  const social = activeSocial();
  const year = new Date().getFullYear();
  return (
    <footer className="relative bg-[var(--lp-night)] pb-10 pt-20 text-white">
      <div className="lp-wrap">
        <div className="grid gap-12 border-b border-white/10 pb-14 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
          <div>
            <BrandLogo size="lg" />
            <p className="mt-6 max-w-[22rem] text-[0.95rem] leading-relaxed text-[var(--lp-mute-dark)]">
              Centro automotriz en Tegucigalpa. Mantenimiento preventivo, diagnóstico y reparación de vehículos particulares y flotillas.
            </p>
            {social.length > 0 && (
              <ul className="mt-6 flex gap-2">
                {social.map((s) => (
                  <li key={s.label}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`RAPIFIX en ${s.label}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white/80 transition-colors hover:border-white/50 hover:text-white">
                      <SocialIcon label={s.label} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <nav aria-label="Pie de página">
            <p className="text-sm font-semibold text-white">Sitio</p>
            <ul className="mt-4 space-y-2.5 text-[0.95rem] text-[var(--lp-mute-dark)]">
              <li><a className="hover:text-white" href="#nosotros">Nosotros</a></li>
              <li><a className="hover:text-white" href="#servicios">Servicios</a></li>
              <li><a className="hover:text-white" href="#flotillas">Flotillas</a></li>
              <li><a className="hover:text-white" href="#tecnologia">Tecnología y seguimiento</a></li>
              <li><a className="hover:text-white" href="#proceso">Cómo trabajamos</a></li>
              <li><a className="hover:text-white" href="#contacto">Contacto</a></li>
            </ul>
          </nav>
          <div>
            <p className="text-sm font-semibold text-white">Contacto</p>
            <ul className="mt-4 space-y-2.5 text-[0.95rem] text-[var(--lp-mute-dark)]">
              {wa && <li><a className="hover:text-white" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp {BUSINESS.phoneDisplay}</a></li>}
              {tel && <li><a className="hover:text-white" href={tel}>Llamar al {BUSINESS.phoneDisplay}</a></li>}
              {BUSINESS.mapsUrl && <li><a className="hover:text-white" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">Cómo llegar</a></li>}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Dirección</p>
            <address className="mt-4 text-[0.95rem] not-italic leading-relaxed text-[var(--lp-mute-dark)]">
              {addressLines().map((l) => <span key={l} className="block">{l}</span>)}
            </address>
            {BUSINESS.hours && (
              <p className="mt-4 text-[0.95rem] leading-relaxed text-[var(--lp-mute-dark)]">
                {BUSINESS.hours.filter((h) => h.hours).map((h) => <span key={h.days} className="block">{h.days}: {h.hours}</span>)}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-4 pt-8 text-sm text-white/55 sm:flex-row sm:items-center">
          <p>© {year} RAPIFIX Centro Automotriz. Todos los derechos reservados.</p>
          <div className="flex gap-6 sm:ml-auto">
            {BUSINESS.privacyUrl && <a className="hover:text-white" href={BUSINESS.privacyUrl}>Aviso de privacidad</a>}
            <Link to={signedIn ? "/" : "/login"} className="hover:text-white">{signedIn ? "Ir al panel" : "Acceso del personal"}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
