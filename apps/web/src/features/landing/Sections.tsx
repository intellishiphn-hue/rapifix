import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, Camera, Check, CircleCheck, Clock, CreditCard, FileCheck2, MapPin, MessageCircle, Navigation, Phone, Wrench } from "lucide-react";
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
    <section id="flotillas" className="lp-section relative overflow-hidden bg-[var(--lp-navy)] py-28 text-white sm:py-36">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "88px 88px" }} />
      <div className="lp-wrap relative">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div data-reveal>
            <h2 className="lp-display lp-h2">Soluciones automotrices para flotillas.</h2>
            <p className="lp-lead mt-7 max-w-[34rem] text-[var(--lp-mute-dark)]">
              En RAPIFIX apoyamos el mantenimiento de flotillas institucionales con servicios preventivos y correctivos,
              seguimiento por vehículo y documentación técnica de los trabajos realizados.
            </p>
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

/* ---------------------------------------------------------------- Banner del carwash (lleva a /lavado) */

export function CarwashBanner() {
  return (
    <section id="carwash" aria-labelledby="cw-banner-t" className="lp-section lp-light bg-white py-20 sm:py-24">
      <div className="lp-wrap">
        <div className="relative overflow-hidden rounded-[32px] bg-[linear-gradient(135deg,#0b2a7a,#011955_55%,#000a2b)] px-7 py-12 text-white sm:px-12 sm:py-14" data-reveal>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 overflow-hidden" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <span
                key={i}
                className="cw-bubble"
                style={{ left: `${(i * 41) % 100}%`, width: `${10 + ((i * 11) % 34)}px`, height: `${10 + ((i * 11) % 34)}px`, bottom: `${-10 + ((i * 29) % 50)}%`, animationDelay: `${(i % 7) * 0.8}s` }}
              />
            ))}
          </div>
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="flex items-center gap-3 text-sm font-semibold text-white/80">
                <span className="h-[3px] w-7 rounded-full bg-[var(--lp-red)]" aria-hidden /> Carwash RAPIFIX
              </p>
              <h2 id="cw-banner-t" className="lp-display mt-4 text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.02]">Tu carro limpio. Tu día más fácil.</h2>
              <p className="mt-4 max-w-[32rem] text-[1.02rem] leading-relaxed text-[var(--lp-mute-dark)]">Lavados para todo tipo de vehículo, membresías y tarjeta de sellos.</p>
            </div>
            <div className="flex lg:justify-end">
              <Link to="/lavado" className="lp-btn lp-btn-red">
                Conocer el carwash <ArrowRight className="lp-arrow h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Tecnología y seguimiento */

const TRACK_FEATURES = [
  { icon: Wrench, title: "Estado y avance" },
  { icon: FileCheck2, title: "Cotización para aprobar" },
  { icon: Camera, title: "Fotos de recepción" },
  { icon: CreditCard, title: "Pago en línea o comprobante" },
];

export function TrackingSection() {
  const wa = waLink(WA_MESSAGES.tracking);
  return (
    <section id="tecnologia" className="lp-section lp-light relative overflow-hidden bg-[var(--lp-paper)] py-28 sm:py-36">
      <div className="lp-wrap grid [&>*]:min-w-0 items-center gap-16 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <div>
          <div data-reveal>
            <h2 className="lp-display lp-h2 max-w-[16ch] text-[var(--lp-navy)]">Tu vehículo está en nuestras manos. Tú sigues al tanto.</h2>
            <p className="lp-lead mt-7 max-w-[32rem] text-[var(--lp-mute)]">
              Te enviamos por WhatsApp un enlace personal para ver el avance, aprobar la cotización y pagar desde tu celular.
            </p>
          </div>
          <ul className="mt-10 flex max-w-[34rem] flex-wrap gap-2.5" data-reveal aria-label="Qué puedes hacer con tu enlace">
            {TRACK_FEATURES.map((f) => (
              <li key={f.title} className="inline-flex items-center gap-2 rounded-full border border-[rgb(1_25_85/0.14)] bg-white px-4 py-2.5 text-[0.93rem] font-medium text-[var(--lp-navy)]">
                <f.icon className="h-4 w-4 text-[var(--lp-electric-ink)]" aria-hidden strokeWidth={1.9} /> {f.title}
              </li>
            ))}
          </ul>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-navy mt-10" data-reveal>
              <MessageCircle className="h-4 w-4" aria-hidden /> Pregunta por tu vehículo
            </a>
          )}
        </div>
        <div className="flex justify-center" data-reveal>
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}

function PhoneMockup() {
  const current = 4; // "Reparación en proceso"
  const percent = Math.round(((current + 0.5) / PORTAL_STEPS.length) * 100);
  return (
    <figure className="relative w-[290px] max-w-full sm:w-[320px]">
      <span className="absolute -top-3 left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--lp-navy)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg">Representación visual</span>
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
              </div>
              <div className="mt-0.5 text-[17px] font-extrabold tracking-tight text-slate-900">SUV 2022</div>
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
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-white p-3.5 shadow-sm">
              <div>
                <div className="whitespace-nowrap text-[12px] font-bold text-slate-900">Cotización</div>
                <div className="text-[10px] text-slate-500">COT-0000, aprobada en línea</div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><CircleCheck className="h-3 w-3" /> Aprobada</span>
            </div>
            <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1faa53] text-[12px] font-bold text-white"><MessageCircle className="h-3.5 w-3.5" /> Escribir por WhatsApp</div>
          </div>
        </div>
      </div>
      <figcaption className="mt-5 text-balance text-center text-sm text-[var(--lp-mute)]">Enlace de seguimiento con datos ficticios.</figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------- Proceso */

const STAGES: Array<{ title: string; text: string; statuses: WorkOrderStatus[] }> = [
  { title: "Recepción del vehículo", text: "Kilometraje, combustible, objetos y fotos de cómo llegó.", statuses: ["RECEIVED", "INSPECTION"] },
  { title: "Inspección y diagnóstico", text: "Con escáner en los sistemas compatibles.", statuses: ["DIAGNOSIS", "AWAITING_QUOTE"] },
  { title: "Cotización y aprobación", text: "Tú decides. Puedes aprobarla en línea.", statuses: ["QUOTE_SENT", "AWAITING_APPROVAL", "APPROVED"] },
  { title: "Reparación", text: "Solo lo aprobado. Cualquier cambio te llega para aprobarlo.", statuses: ["IN_REPAIR", "WAITING_PARTS"] },
  { title: "Control de calidad", text: "Revisamos el trabajo antes de entregarlo.", statuses: ["QUALITY_CONTROL"] },
  { title: "Entrega del vehículo", text: "Pagas en línea, con transferencia o en caja.", statuses: ["READY", "DELIVERED"] },
];

export function ProcessSection() {
  const [p, setP] = useState(0);
  const ref = useScrollProgress<HTMLOListElement>(setP);
  const on = Math.floor(p * STAGES.length + 0.35);
  return (
    <section id="proceso" aria-labelledby="proceso-t" className="lp-section relative bg-[var(--lp-night)] py-28 text-white sm:py-36">
      <div className="lp-wrap grid [&>*]:min-w-0 gap-14 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <div className="lg:sticky lg:top-28 lg:self-start" data-reveal>
          <h2 id="proceso-t" className="lp-display lp-h2">Así cuidamos tu vehículo, paso a paso.</h2>
          <p className="lp-lead mt-7 max-w-[28rem] text-[var(--lp-mute-dark)]">Las mismas etapas que ves en tu enlace de seguimiento.</p>
        </div>
        <ol ref={ref} className="relative" style={{ ["--p" as string]: p }}>
          <span className="lp-rail" aria-hidden><span className="lp-rail-fill" /></span>
          {STAGES.map((s, i) => (
            <li key={s.title} className="lp-step relative flex gap-6 pb-9 last:pb-0" data-on={i < on || p >= 1}>
              <span className="lp-step-dot relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[var(--lp-night)] text-[0.95rem] font-semibold text-white/70">
                {i + 1}
              </span>
              <div className="lp-step-body pt-2">
                <h3 className="lp-display lp-h3">{s.title}</h3>
                <p className="mt-1.5 max-w-[32rem] text-[0.96rem] leading-relaxed text-[var(--lp-mute-dark)]">{s.text}</p>
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
  const wa = waLink(WA_MESSAGES.contact);
  const quick = [
    { label: "Consultar un servicio", href: waLink(WA_MESSAGES.services) },
    { label: "Información para flotillas", href: waLink(WA_MESSAGES.fleet) },
    { label: "Pedir mi enlace de seguimiento", href: waLink(WA_MESSAGES.tracking) },
  ].filter((q) => q.href);
  const social = activeSocial();

  return (
    <section id="contacto" className="lp-section lp-light relative bg-white py-28 sm:py-36">
      <div className="lp-wrap">
        <div className="max-w-[40rem]" data-reveal>
          <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">¿Qué necesita tu vehículo?</h2>
          <p className="lp-lead mt-6 text-[var(--lp-mute)]">Cuéntanos qué necesitas y te orientaremos sobre el siguiente paso.</p>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          {/* WhatsApp, llamada y horario */}
          <div className="relative overflow-hidden rounded-[28px] bg-[var(--lp-navy)] p-7 text-white sm:p-10" data-reveal>
            <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-[var(--lp-red)]/25 blur-3xl" aria-hidden />
            <p className="relative text-[0.95rem] text-[var(--lp-mute-dark)]">WhatsApp y teléfono</p>
            {BUSINESS.phoneDisplay && <p className="lp-display relative mt-2 text-[clamp(2.4rem,6vw,3.6rem)] leading-none">{BUSINESS.phoneDisplay}</p>}
            <div className="relative mt-8 flex flex-wrap gap-3">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa">
                  <MessageCircle className="h-5 w-5" aria-hidden /> Escribir por WhatsApp
                </a>
              )}
              {tel && (
                <a href={tel} className="lp-btn lp-btn-ghost">
                  <Phone className="h-4 w-4" aria-hidden /> Llamar
                </a>
              )}
              <Link to="/agendar" className="lp-btn lp-btn-red">
                <CalendarCheck className="h-4 w-4" aria-hidden /> Agendar cita
              </Link>
            </div>
            {quick.length > 0 && (
              <ul className="relative mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Mensajes rápidos por WhatsApp">
                {quick.map((q) => (
                  <li key={q.label}>
                    <a href={q.href!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center gap-1.5 text-white/80 underline-offset-4 hover:text-white hover:underline">
                      {q.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {BUSINESS.hours && (
              <div className="relative mt-8 border-t border-white/12 pt-6">
                <p className="flex items-center gap-2 text-sm font-semibold text-white"><Clock className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden /> Horario</p>
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

          {/* Ubicación */}
          {lines.length > 0 && (
            <div className="flex flex-col overflow-hidden rounded-[28px] border border-[var(--lp-line)]" data-reveal style={{ ["--d" as string]: "100ms" }}>
              <div className="p-7 sm:p-10">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--lp-navy)]"><MapPin className="h-4 w-4 text-[var(--lp-red-ink)]" aria-hidden /> Dónde estamos</p>
                <address className="mt-4 not-italic">
                  <span className="lp-display block text-[clamp(1.35rem,2.4vw,1.7rem)] leading-tight text-[var(--lp-navy)]">{lines[0]}</span>
                  {lines.slice(1).map((l) => <span key={l} className="mt-1 block text-[1rem] text-[var(--lp-ink)]">{l}</span>)}
                </address>
                {BUSINESS.googleName && <p className="mt-3 text-[0.93rem] text-[var(--lp-mute)]">En Google Maps: {BUSINESS.googleName}.</p>}
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  {BUSINESS.mapsUrl && (
                    <a href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-navy">
                      <Navigation className="h-4 w-4" aria-hidden /> Cómo llegar
                    </a>
                  )}
                  {social.map((so) => (
                    <a key={so.label} href={so.url} target="_blank" rel="noopener noreferrer" aria-label={`RAPIFIX en ${so.label}`} className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgb(1_25_85/0.18)] text-[var(--lp-navy)] transition-colors hover:border-[var(--lp-navy)]">
                      <SocialIcon label={so.label} />
                    </a>
                  ))}
                </div>
              </div>
              <MapArt />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Bloque visual de ubicación (no es un mapa real: evita cargar Google Maps) */
function MapArt() {
  return (
    <div className="relative mt-auto min-h-[200px] flex-1 overflow-hidden bg-[var(--lp-navy)]" aria-hidden>
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

export function Footer({ base = "" }: { base?: string }) {
  const { status } = useAuth();
  const signedIn = status === "ready" || status === "noRole";
  const wa = waLink(WA_MESSAGES.general);
  const tel = telLink();
  const social = activeSocial();
  const year = new Date().getFullYear();
  return (
    <footer className="relative bg-[var(--lp-night)] pb-10 pt-20 text-white">
      <div className="lp-wrap">
        <div className="grid gap-12 border-b border-white/10 pb-14 md:grid-cols-[1.4fr_1fr_1.2fr]">
          <div>
            <BrandLogo size="lg" />
            <p className="mt-6 max-w-[22rem] text-[0.95rem] leading-relaxed text-[var(--lp-mute-dark)]">Centro automotriz en Tegucigalpa.</p>
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
              <li><a className="hover:text-white" href={`${base}#nosotros`}>Nosotros</a></li>
              <li><a className="hover:text-white" href={`${base}#servicios`}>Servicios</a></li>
              <li><a className="hover:text-white" href={`${base}#flotillas`}>Flotillas</a></li>
              <li><a className="hover:text-white" href="/lavado">Carwash</a></li>
              <li><a className="hover:text-white" href={`${base}#tecnologia`}>Tecnología y seguimiento</a></li>
              <li><a className="hover:text-white" href={`${base}#contacto`}>Contacto</a></li>
            </ul>
          </nav>
          <div>
            <p className="text-sm font-semibold text-white">Contacto</p>
            <ul className="mt-4 space-y-2.5 text-[0.95rem] text-[var(--lp-mute-dark)]">
              {wa && <li><a className="hover:text-white" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp {BUSINESS.phoneDisplay}</a></li>}
              {tel && <li><a className="hover:text-white" href={tel}>Llamar al {BUSINESS.phoneDisplay}</a></li>}
              {BUSINESS.address && (
                <li>
                  {BUSINESS.mapsUrl ? (
                    <a className="hover:text-white" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">{BUSINESS.address.street}, {BUSINESS.address.city}</a>
                  ) : (
                    <span>{BUSINESS.address.street}, {BUSINESS.address.city}</span>
                  )}
                </li>
              )}
            </ul>
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
