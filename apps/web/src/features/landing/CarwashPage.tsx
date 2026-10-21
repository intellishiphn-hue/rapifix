import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Armchair, ArrowRight, Brush, CalendarCheck, Car, Cog, CreditCard, Droplets, Gem, Layers, Lightbulb, Link2, MessageCircle, Paintbrush, PawPrint,
  ShieldCheck, Sparkles, SprayCan, Stamp, Upload, type LucideIcon,
} from "lucide-react";
import { VEHICLE_SIZE_HINTS, VEHICLE_SIZE_LABELS, VEHICLE_SIZE_SHORT, VEHICLE_SIZES, type PublicCarwash, type PublicCarwashService, type VehicleSize } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import "./landing.css";
import { BUSINESS, WA_MESSAGES, addressLines, waLink } from "./business";
import { Nav } from "./Nav";
import { Footer } from "./Sections";
import { HERO_VIEWBOX_CAR, HeroScene } from "./HeroScene";
import { useRevealAll } from "./motion";
import { loadPublicCarwash, type CarwashLoad } from "./carwashData";

const TITLE = "Carwash en Tegucigalpa: lavado de carros | RAPIFIX";
const DESCRIPTION = `Carwash RAPIFIX en ${BUSINESS.address?.street ?? "Tegucigalpa"}, Tegucigalpa: lavado de carros, SUV, pick-up y vehículos grandes, membresías de lavado y tarjeta de sellos. Consulta precios por WhatsApp.`;

const sizeName = (s: VehicleSize) => VEHICLE_SIZE_LABELS[s].toLowerCase();

/** Mensaje de WhatsApp para un servicio, con el tipo de vehículo si se eligió */
export function serviceMessage(service: string, size: VehicleSize | null): string {
  return size
    ? `Hola, RAPIFIX. Quiero consultar el precio del servicio de ${service} para un vehículo tipo ${VEHICLE_SIZE_LABELS[size]}.`
    : `Hola, RAPIFIX. Quiero consultar el precio del servicio de ${service}.`;
}
export const sizeMessage = (size: VehicleSize) => `Hola, RAPIFIX. Quiero consultar los precios de Carwash para un vehículo tipo ${VEHICLE_SIZE_LABELS[size]}.`;

/** Ícono según palabras clave del nombre o la descripción (genérico si no hay coincidencia) */
const ICON_RULES: Array<[RegExp, LucideIcon]> = [
  [/mascota|pelo/, PawPrint],
  [/asiento|shampu|tapiz/, Armchair],
  [/foco|faro/, Lightbulb],
  [/pintura|pulido/, Paintbrush],
  [/cera|encerad/, Gem],
  [/motor/, Cog],
  [/chasis|bajos/, Layers],
  [/plastic/, ShieldCheck],
  [/interior|detail/, Brush],
  [/premium/, Sparkles],
  [/complet/, SprayCan],
  [/exterior|lavado/, Droplets],
];
export function serviceIcon(s: Pick<PublicCarwashService, "name" | "description">): LucideIcon {
  const t = `${s.name} ${s.description}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ICON_RULES.find(([re]) => re.test(t))?.[1] ?? Car;
}

function useCarwashSeo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    if (meta) meta.content = DESCRIPTION;
    const added: HTMLElement[] = [];
    if (BUSINESS.siteUrl) {
      const canon = document.createElement("link");
      canon.rel = "canonical";
      canon.href = `${BUSINESS.siteUrl}/lavado`;
      document.head.appendChild(canon);
      added.push(canon);
    }
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
      added.forEach((n) => n.remove());
    };
  }, []);
}

export function CarwashPage() {
  const root = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<CarwashLoad>({ state: "loading" });
  const [size, setSize] = useState<VehicleSize | null>(null);
  useCarwashSeo();
  useRevealAll(root);

  useEffect(() => {
    const ctl = new AbortController();
    void loadPublicCarwash(ctl.signal).then((r) => {
      if (!ctl.signal.aborted) setLoad(r);
    });
    return () => ctl.abort();
  }, []);

  const data = load.state === "ready" ? load.data : null;

  return (
    <div ref={root} className="lp">
      <a href="#contenido" className="sr-only z-[60] rounded-full bg-white px-4 py-2 font-semibold text-[var(--lp-navy)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Saltar al contenido
      </a>
      <Nav base="/inicio" current="carwash" />
      <main id="contenido">
        <CwHero />
        <SizesSection size={size} onSize={setSize} />
        <ServicesList load={load} size={size} onSize={setSize} />
        <PlansSection load={load} plans={data?.plans ?? []} />
        <LoyaltySection load={load} loyalty={data?.loyalty ?? null} />
        <LinkSection />
      </main>
      <Footer base="/inicio" />
    </div>
  );
}

/* ---------------------------------------------------------------- Hero */

function Bubbles({ count = 16 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="cw-bubble"
          aria-hidden
          style={{
            left: `${(i * 37) % 100}%`,
            width: `${8 + ((i * 13) % 30)}px`,
            height: `${8 + ((i * 13) % 30)}px`,
            bottom: `${-12 + ((i * 23) % 40)}%`,
            animationDelay: `${(i % 8) * 0.7}s`,
          }}
        />
      ))}
    </>
  );
}

function CwHero() {
  const wa = waLink(WA_MESSAGES.carwashPrices);
  return (
    <section id="inicio-carwash" className="lp-hero lp-section relative overflow-hidden text-white">
      <div className="lp-noise" aria-hidden />
      <div className="lp-wrap relative grid min-h-[min(100svh,860px)] items-center gap-8 pb-16 pt-[112px] lg:grid-cols-[1fr_1.1fr] lg:pt-[96px]">
        <div className="max-w-[40rem]">
          <p className="lp-in flex items-center gap-3 text-[0.95rem] font-semibold text-white/85" style={{ ["--d" as string]: "60ms" }}>
            <span className="h-[3px] w-8 rounded-full bg-[var(--lp-red)]" aria-hidden />
            Carwash RAPIFIX
          </p>
          <h1 className="lp-display lp-h1 lp-in mt-6 !text-[clamp(2.5rem,4.8vw,4.3rem)]" style={{ ["--d" as string]: "160ms" }}>
            Tu carro limpio. Tu día más fácil.
          </h1>
          <p className="lp-in lp-lead mt-7 max-w-[32rem] text-white/85" style={{ ["--d" as string]: "320ms" }}>
            Descubre nuestros servicios de Carwash, elige el cuidado ideal para tu vehículo y consulta nuestras opciones por WhatsApp.
          </p>
          <div className="lp-in mt-10 flex flex-wrap gap-3" style={{ ["--d" as string]: "460ms" }}>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-red">
                <MessageCircle className="h-4 w-4" aria-hidden /> Consultar precios por WhatsApp
              </a>
            )}
            <a href="#servicios-carwash" className="lp-btn lp-btn-ghost">Conocer nuestros servicios</a>
            <Link to="/agendar?motivo=carwash" className="lp-btn lp-btn-ghost">
              <CalendarCheck className="h-4 w-4" aria-hidden /> Agendar lavado
            </Link>
          </div>
        </div>
        <div className="cw-hero-art lp-car-wrap relative -mx-4 sm:mx-0">
          <HeroScene viewBox={HERO_VIEWBOX_CAR} className="relative h-auto w-full" />
          <div className="cw-foam pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <Bubbles count={18} />
          </div>
          <div className="cw-sweep pointer-events-none absolute inset-0" aria-hidden />
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Tipos de vehículo */

function SizeArt({ size }: { size: VehicleSize }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const wheel = (x: number, y: number, r = 14) => (
    <g>
      <circle cx={x} cy={y} r={r} {...s} />
      <circle cx={x} cy={y} r={r * 0.38} {...s} />
    </g>
  );
  return (
    <svg viewBox="0 0 220 90" className="h-[72px] w-full" aria-hidden>
      {size === "turismo" && (
        <g>
          <path d="M14 64 C12 56 16 50 26 48 L60 44 C76 32 92 26 112 26 L140 26 C156 28 168 38 178 48 L200 52 C208 54 210 60 208 64 Z" {...s} />
          <path d="M70 44 C84 34 98 30 112 30 L138 30 C150 32 160 38 168 46 Z" {...s} opacity=".55" />
          {wheel(52, 66)}
          {wheel(170, 66)}
        </g>
      )}
      {size === "camioneta" && (
        <g>
          <path d="M12 66 L12 44 C12 38 16 34 22 34 L56 32 C70 20 84 16 100 16 L170 16 C178 16 182 20 186 26 L198 44 C204 46 208 50 208 56 L208 66 Z" {...s} />
          <path d="M64 32 C76 24 88 20 100 20 L168 20 L182 34 Z" {...s} opacity=".55" />
          {wheel(50, 68, 15)}
          {wheel(172, 68, 15)}
        </g>
      )}
      {size === "pickup" && (
        <g>
          <path d="M10 66 L10 44 L104 44 L106 22 C106 18 110 16 114 16 L150 16 C158 16 162 20 166 26 L178 42 C196 44 208 48 208 56 L208 66 Z" {...s} />
          <path d="M112 22 L148 22 L162 40 L112 40 Z" {...s} opacity=".55" />
          {wheel(46, 68, 15)}
          {wheel(172, 68, 15)}
        </g>
      )}
      {size === "oversize" && (
        <g>
          <path d="M8 68 L8 18 C8 12 12 8 18 8 L196 8 C204 8 210 14 210 22 L212 68 Z" {...s} />
          <path d="M24 18 L64 18 L64 36 L24 36 Z M76 18 L116 18 L116 36 L76 36 Z M128 18 L168 18 L168 36 L128 36 Z M180 18 L202 18 L204 40 L180 40 Z" {...s} opacity=".55" />
          {wheel(44, 70, 13)}
          {wheel(176, 70, 13)}
        </g>
      )}
    </svg>
  );
}

function SizesSection({ size, onSize }: { size: VehicleSize | null; onSize: (s: VehicleSize | null) => void }) {
  return (
    <section id="tipos" className="lp-section lp-light bg-white py-24 sm:py-32">
      <div className="lp-wrap">
        <h2 className="lp-display lp-h2 max-w-[18ch] text-[var(--lp-navy)]" data-reveal>Tenemos el lavado ideal para tu vehículo</h2>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VEHICLE_SIZES.map((s, i) => {
            const wa = waLink(sizeMessage(s));
            const selected = size === s;
            return (
              <li key={s} data-reveal style={{ ["--d" as string]: `${i * 70}ms` }}>
                <div className={cn("flex h-full flex-col rounded-[24px] border bg-[var(--lp-paper)] p-6 transition-colors", selected ? "border-[var(--lp-navy)]" : "border-transparent")}>
                  <div className="text-[var(--lp-navy)]"><SizeArt size={s} /></div>
                  <h3 className="lp-display mt-5 text-[1.2rem] leading-tight text-[var(--lp-navy)]">{VEHICLE_SIZE_LABELS[s]}</h3>
                  <p className="mt-1.5 text-[0.95rem] text-[var(--lp-mute)]">{VEHICLE_SIZE_HINTS[s]}{s === "oversize" ? ". Requieren una evaluación particular." : "."}</p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    {wa && (
                      <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-navy !min-h-[44px] !px-4 text-sm">
                        <MessageCircle className="h-4 w-4" aria-hidden /> Consultar servicio
                      </a>
                    )}
                    <a
                      href="#servicios-carwash"
                      onClick={() => onSize(s)}
                      className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-[var(--lp-electric-ink)] hover:underline"
                    >
                      Ver servicios
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Servicios */

function SizePicker({ size, onSize }: { size: VehicleSize | null; onSize: (s: VehicleSize | null) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de vehículo">
      <button type="button" aria-pressed={size === null} onClick={() => onSize(null)} className="lp-chip inline-flex min-h-[40px] items-center rounded-full border border-[rgb(1_25_85/0.16)] bg-white px-4 text-sm font-medium text-[var(--lp-navy)]">
        Todos
      </button>
      {VEHICLE_SIZES.map((s) => (
        <button key={s} type="button" aria-pressed={size === s} onClick={() => onSize(s)} className="lp-chip inline-flex min-h-[40px] items-center rounded-full border border-[rgb(1_25_85/0.16)] bg-white px-4 text-sm font-medium text-[var(--lp-navy)]">
          {VEHICLE_SIZE_SHORT[s]}
        </button>
      ))}
    </div>
  );
}

function EmptyNotice({ title, text, message, cta }: { title: string; text: string; message: string; cta: string }) {
  const wa = waLink(message);
  return (
    <div className="mt-10 rounded-[28px] border border-dashed border-[rgb(1_25_85/0.2)] bg-white px-6 py-12 text-center">
      <p className="lp-display text-[1.25rem] text-[var(--lp-navy)]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[var(--lp-mute)]">{text}</p>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa mt-6">
          <MessageCircle className="h-4 w-4" aria-hidden /> {cta}
        </a>
      )}
    </div>
  );
}

function ServicesList({ load, size, onSize }: { load: CarwashLoad; size: VehicleSize | null; onSize: (s: VehicleSize | null) => void }) {
  const services = load.state === "ready" ? load.data.services : [];
  const visible = useMemo(() => (size ? services.filter((s) => s.sizes.includes(size)) : services), [services, size]);
  return (
    <section id="servicios-carwash" className="lp-section lp-light bg-[var(--lp-paper)] py-24 sm:py-32" aria-busy={load.state === "loading"}>
      <div className="lp-wrap">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between" data-reveal>
          <div>
            <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">Nuestros servicios</h2>
            <p className="lp-lead mt-5 max-w-[32rem] text-[var(--lp-mute)]">Elige tu tipo de vehículo y consulta el precio de cada servicio por WhatsApp.</p>
          </div>
          <SizePicker size={size} onSize={onSize} />
        </div>

        {load.state === "loading" && (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Cargando servicios">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-[220px] animate-pulse rounded-[24px] bg-white/80" />
            ))}
          </ul>
        )}
        {(load.state === "error" || load.state === "empty" || (load.state === "ready" && services.length === 0)) && (
          <EmptyNotice
            title={load.state === "error" ? "No pudimos cargar los servicios" : "Pronto publicaremos nuestros servicios aquí"}
            text={load.state === "error" ? "Revisa tu conexión e inténtalo de nuevo, o escríbenos y te contamos las opciones." : "Mientras tanto, escríbenos y te contamos las opciones y precios para tu vehículo."}
            message={WA_MESSAGES.carwash}
            cta="Consultar por WhatsApp"
          />
        )}
        {load.state === "ready" && services.length > 0 && (
          <>
            {visible.length === 0 && <p className="mt-10 text-[var(--lp-mute)]">No hay servicios publicados para {size ? sizeName(size) : "este tipo"}. Escríbenos y te ayudamos.</p>}
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((s) => {
                const Icon = serviceIcon(s);
                const quote = size ? s.quoteSizes.includes(size) : s.quoteSizes.length > 0 && s.quoteSizes.length === s.sizes.length;
                const someQuote = !size && s.quoteSizes.length > 0 && !quote;
                const wa = waLink(serviceMessage(s.name, size));
                return (
                  <li key={s.id} className="lp-result flex">
                    <article className="flex w-full flex-col rounded-[24px] border border-[var(--lp-line)] bg-white p-6">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--lp-paper)] text-[var(--lp-navy)]"><Icon className="h-6 w-6" aria-hidden strokeWidth={1.8} /></span>
                        {s.kind === "extra" && <span className="rounded-full bg-[var(--lp-paper)] px-2.5 py-1 text-xs font-semibold text-[var(--lp-navy)]">Adicional</span>}
                      </div>
                      <h3 className="lp-display mt-5 text-[1.2rem] leading-tight text-[var(--lp-navy)]">{s.name}</h3>
                      {s.description && <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--lp-mute)]">{s.description}</p>}
                      {s.sizes.length > 0 && (
                        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tipos de vehículo">
                          {s.sizes.map((z) => (
                            <li key={z} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", z === size ? "bg-[var(--lp-navy)] text-white" : "bg-[var(--lp-paper)] text-[var(--lp-navy)]")}>
                              {VEHICLE_SIZE_SHORT[z]}
                            </li>
                          ))}
                        </ul>
                      )}
                      {(quote || someQuote) && (
                        <p className="mt-3 text-sm font-medium text-[var(--lp-red-ink)]">
                          {quote ? "Requiere evaluación" : `Requiere evaluación para ${s.quoteSizes.map((z) => VEHICLE_SIZE_SHORT[z]).join(", ")}`}
                        </p>
                      )}
                      {wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa mt-auto w-full !min-h-[46px] text-sm" style={{ marginTop: "1.5rem" }}>
                          <MessageCircle className="h-4 w-4" aria-hidden /> Consultar precio por WhatsApp
                        </a>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Membresías */

function PlansSection({ load, plans }: { load: CarwashLoad; plans: PublicCarwash["plans"] }) {
  const wa = waLink(WA_MESSAGES.carwashPlans);
  return (
    <section id="membresias" className="lp-section lp-light bg-white py-24 sm:py-32">
      <div className="lp-wrap">
        <div data-reveal>
          <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">Tu carro siempre limpio</h2>
          <p className="lp-lead mt-5 max-w-[34rem] text-[var(--lp-mute)]">Membresías mensuales de lavado para tu vehículo.</p>
        </div>
        {load.state === "loading" ? (
          <div className="mt-10 h-[180px] animate-pulse rounded-[24px] bg-[var(--lp-paper)]" />
        ) : plans.length === 0 ? (
          <EmptyNotice
            title="Consulta las membresías disponibles"
            text="Te contamos los planes de lavado que tenemos para tu tipo de vehículo."
            message={WA_MESSAGES.carwashPlans}
            cta="Consultar membresía por WhatsApp"
          />
        ) : (
          <>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => {
                const msg = `Hola, RAPIFIX. Quiero información sobre la membresía ${p.name} de Carwash.`;
                const link = waLink(msg);
                return (
                  <li key={p.id} className="flex">
                    <article className="flex w-full flex-col rounded-[24px] bg-[var(--lp-navy)] p-6 text-white">
                      <p className="text-sm text-[var(--lp-mute-dark)]">{VEHICLE_SIZE_LABELS[p.size]}</p>
                      <h3 className="lp-display mt-1 text-[1.35rem] leading-tight">{p.name}</h3>
                      <p className="mt-4 flex items-center gap-2 text-[0.98rem]">
                        <CalendarCheck className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden />
                        {p.washesPerMonth ? `${p.washesPerMonth} ${p.washesPerMonth === 1 ? "lavado" : "lavados"} al mes` : "Lavados ilimitados al mes"}
                      </p>
                      {p.includedNames.length > 0 && (
                        <ul className="mt-3 space-y-1.5 text-[0.93rem] text-white/80">
                          {p.includedNames.map((n) => (
                            <li key={n} className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-electric)]" aria-hidden /> {n}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-4 text-sm text-white/60">Plan mensual. Precio por WhatsApp.</p>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost mt-auto w-full !min-h-[46px] text-sm" style={{ marginTop: "1.5rem" }}>
                          <MessageCircle className="h-4 w-4" aria-hidden /> Consultar membresía por WhatsApp
                        </a>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--lp-electric-ink)] hover:underline">
                Preguntar por todas las membresías <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Lealtad */

function LoyaltySection({ load, loyalty }: { load: CarwashLoad; loyalty: PublicCarwash["loyalty"] | null }) {
  const every = loyalty?.every ?? 0;
  const start = loyalty?.startStamps ?? 0;
  const active = every > 0;
  const wa = waLink(WA_MESSAGES.carwash);
  return (
    <section id="lealtad" className="lp-section relative overflow-hidden bg-[var(--lp-navy)] py-24 text-white sm:py-32">
      <div className="lp-wrap grid [&>*]:min-w-0 items-center gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <div data-reveal>
          <h2 className="lp-display lp-h2">Cada lavado cuenta</h2>
          <p className="lp-lead mt-6 max-w-[32rem] text-[var(--lp-mute-dark)]">
            Disfruta de tus lavados, acumula sellos y descubre los beneficios disponibles para clientes frecuentes.
          </p>
          {load.state === "loading" ? null : active ? (
            <ul className="mt-8 space-y-3 text-[1.02rem]">
              <li className="flex gap-3"><Stamp className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lp-electric)]" aria-hidden /> Cada {every} lavados pagados, ganas un lavado gratis.</li>
              {start > 0 && <li className="flex gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lp-electric)]" aria-hidden /> Tu tarjeta nueva arranca con {start} {start === 1 ? "sello" : "sellos"} de regalo.</li>}
              <li className="flex gap-3"><Link2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lp-electric)]" aria-hidden /> Tus sellos se ven en el enlace de cada lavado.</li>
            </ul>
          ) : (
            wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost mt-8">
                <MessageCircle className="h-4 w-4" aria-hidden /> Preguntar por los beneficios
              </a>
            )
          )}
        </div>
        {active && every <= 20 && (
          <div className="lp-result flex justify-center" aria-hidden>
            <div className="w-full max-w-[420px] rounded-[28px] bg-white p-6 text-[var(--lp-navy)] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.7)] sm:p-8">
              <div className="flex items-center justify-between">
                <span className="lp-display text-[1.05rem]">Tarjeta de lealtad</span>
                <span className="text-xs font-semibold text-[var(--lp-mute)]">Ejemplo</span>
              </div>
              <div className="mt-5 grid grid-cols-5 gap-2.5">
                {Array.from({ length: every }, (_, i) => {
                  const filled = i < Math.min(every - 1, Math.max(start, Math.ceil(every * 0.6)));
                  const last = i === every - 1;
                  return (
                    <span key={i} className={cn("flex aspect-square items-center justify-center rounded-full border-2", last ? "border-[var(--lp-red)] text-[var(--lp-red)]" : filled ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[rgb(1_25_85/0.2)]")}>
                      {last ? <Sparkles className="h-4 w-4" /> : filled ? <Droplets className="h-4 w-4" /> : null}
                    </span>
                  );
                })}
              </div>
              <p className="mt-5 text-sm text-[var(--lp-mute)]">El último sello es tu lavado gratis.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Consulta tu Carwash */

function LinkSection() {
  const wa = waLink(WA_MESSAGES.carwashLink);
  const items = [
    { icon: Car, text: "El estado y el detalle de tu lavado." },
    { icon: Stamp, text: "Los sellos de tu tarjeta de lealtad." },
    { icon: CreditCard, text: "Pagar con tarjeta en línea a través de ROKI." },
    { icon: Upload, text: "Subir tu comprobante de transferencia. Queda pendiente hasta que el taller lo valide." },
  ];
  return (
    <section id="consulta" className="lp-section lp-light bg-[var(--lp-paper)] py-24 sm:py-32">
      <div className="lp-wrap grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20 [&>*]:min-w-0">
        <div data-reveal>
          <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">Consulta tu Carwash</h2>
          <p className="lp-lead mt-6 max-w-[32rem] text-[var(--lp-mute)]">
            Cada lavado tiene un enlace privado que te enviamos por WhatsApp. No necesitas cuenta ni contraseña.
          </p>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-navy mt-8 !whitespace-normal py-3 text-left">
              <MessageCircle className="h-4 w-4 shrink-0" aria-hidden /> ¿No encuentras tu enlace? Pídelo por WhatsApp
            </a>
          )}
        </div>
        <ul className="grid gap-3 self-center" data-reveal>
          {items.map((it) => (
            <li key={it.text} className="flex items-start gap-4 rounded-2xl bg-white p-4 text-[0.98rem] text-[var(--lp-ink)]">
              <it.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lp-electric-ink)]" aria-hidden strokeWidth={1.9} />
              {it.text}
            </li>
          ))}
          <li className="px-4 text-sm text-[var(--lp-mute)]">El enlace puede incluir fotos de entrada y salida de tu vehículo.</li>
          {addressLines().length > 0 && <li className="px-4 text-sm text-[var(--lp-mute)]">Estamos en {addressLines().slice(0, 2).join(", ")}.</li>}
        </ul>
      </div>
    </section>
  );
}
