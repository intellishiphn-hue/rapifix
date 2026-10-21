import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, Gauge, Wrench, Zap } from "lucide-react";
import "./landing.css";
import { BUSINESS, structuredData } from "./business";
import { Nav } from "./Nav";
import { HERO_VIEWBOX_CAR, HeroScene } from "./HeroScene";
import { finePointer, useReducedMotion, useRevealAll } from "./motion";
import { CatalogDialogProvider, ServicesSection } from "./Services";
import { MultipointSection } from "./Multipoint";
import { CarwashBanner, ContactSection, FleetSection, Footer, ProcessSection, TrackingSection } from "./Sections";

const TITLE = "RAPIFIX Centro Automotriz: mantenimiento, diagnóstico y reparación en Tegucigalpa";
const DESCRIPTION =
  "Mantenimiento preventivo, frenos, suspensión, aire acondicionado, sistema eléctrico, diagnóstico computarizado y mantenimiento de flotillas en Tegucigalpa. Sigue el estado de tu vehículo desde el celular.";


/** Título, descripción, canonical y datos estructurados mientras la landing está montada */
function useSeo() {
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
      canon.href = `${BUSINESS.siteUrl}/`;
      document.head.appendChild(canon);
      added.push(canon);
      const ogUrl = document.createElement("meta");
      ogUrl.setAttribute("property", "og:url");
      ogUrl.content = `${BUSINESS.siteUrl}/`;
      document.head.appendChild(ogUrl);
      added.push(ogUrl);
    }
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify(structuredData());
    document.head.appendChild(ld);
    added.push(ld);
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
      added.forEach((n) => n.remove());
    };
  }, []);
}

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  useSeo();
  useRevealAll(root);
  return (
    <div ref={root} className="lp">
      <a href="#contenido" className="sr-only z-[60] rounded-full bg-white px-4 py-2 font-semibold text-[var(--lp-navy)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Saltar al contenido
      </a>
      <CatalogDialogProvider>
        <Nav />
        <main id="contenido">
          <Hero />
          <MultipointSection />
          <About />
          <ServicesSection />
          <FleetSection />
          <CarwashBanner />
          <TrackingSection />
          <ProcessSection />
          <ContactSection />
        </main>
        <Footer />
      </CatalogDialogProvider>
    </div>
  );
}

/* ---------------------------------------------------------------- Navegación */

/* ---------------------------------------------------------------- Hero */

/** Escritorio ancho: escena completa de fondo. Pantallas angostas: recorte centrado en el vehículo. */
function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const wide = useWide();
  const photo = BUSINESS.heroImage;

  // Parallax por capas (fondo, vehículo, luces) siguiendo el mouse. Solo escritorio con puntero preciso.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !wide || photo) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !finePointer()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--px", x.toFixed(3));
        el.style.setProperty("--py", y.toFixed(3));
      });
    };
    const leave = () => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce, wide, photo]);

  return (
    <section ref={ref} id="inicio" className="lp-hero lp-section relative overflow-hidden text-white">
      {photo ? (
        <div className="absolute inset-0 -z-10">
          <img src={photo} alt={BUSINESS.heroImageAlt ?? ""} className="h-full w-full object-cover" fetchPriority="high" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--lp-night)] via-[rgb(0_10_43/0.75)] to-[rgb(0_10_43/0.2)]" />
        </div>
      ) : (
        wide && (
          <div className="lp-scene absolute inset-0 -z-10">
            <HeroScene className="h-full w-full" preserveAspectRatio="xMaxYMid slice" />
            {/* Contraste para el texto a la izquierda */}
            <div className="absolute inset-y-0 left-0 w-[46%] bg-gradient-to-r from-[var(--lp-night)] via-[rgb(0_10_43/0.6)] to-transparent" aria-hidden />
            {/* Oscurece la franja superior para que la navegación se lea bien */}
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[rgb(0_10_43/0.85)] to-transparent" aria-hidden />
          </div>
        )
      )}
      <div className="lp-noise" aria-hidden />

      <div className="lp-wrap relative flex min-h-[100svh] flex-col pt-[112px] lg:min-h-[min(100svh,980px)] lg:justify-center lg:pb-24 lg:pt-[96px]">
        <div className="max-w-[40rem]">
          <p className="lp-in flex items-center gap-3 text-[0.95rem] font-semibold text-white/85" style={{ ["--d" as string]: "60ms" }}>
            <span className="h-[3px] w-8 rounded-full bg-[var(--lp-red)]" aria-hidden />
            RAPIFIX Centro Automotriz
          </p>
          <h1 className="lp-display lp-h1 mt-6">
            <span className="lp-in block whitespace-nowrap" style={{ ["--d" as string]: "160ms" }}>Tu vehículo</span>
            <span className="lp-in block whitespace-nowrap" style={{ ["--d" as string]: "280ms" }}>merece más.</span>
          </h1>
          <p className="lp-in lp-lead mt-7 max-w-[30rem] text-white/85" style={{ ["--d" as string]: "420ms" }}>
            Mantenimiento y reparación automotriz con un enfoque profesional y transparente.
          </p>
          <div className="lp-in mt-10 flex flex-wrap gap-3" style={{ ["--d" as string]: "560ms" }}>
            <a href="#servicios" className="lp-btn lp-btn-red">
              Explorar servicios <ArrowRight className="lp-arrow h-4 w-4" aria-hidden />
            </a>
            <Link to="/agendar" className="lp-btn lp-btn-ghost">Agendar cita</Link>
          </div>
        </div>

        {/* Móvil y tablet: el vehículo va debajo de los botones */}
        {!photo && !wide && (
          <div className="lp-car-wrap relative -mx-4 mt-10 sm:-mx-8">
            <HeroScene viewBox={HERO_VIEWBOX_CAR} className="h-auto w-full" />
          </div>
        )}
      </div>
      {/* Transición hacia la sección siguiente */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[var(--lp-night)]" aria-hidden />
    </section>
  );
}

/* ---------------------------------------------------------------- Nosotros */

const PILLARS = [
  { icon: Gauge, title: "Mantenimiento preventivo", text: "Aceite, filtros, fluidos e inspección por kilometraje." },
  { icon: ClipboardCheck, title: "Diagnóstico", text: "Inspección y diagnóstico computarizado con informe y cotización." },
  { icon: Wrench, title: "Reparación mecánica", text: "Frenos, suspensión, dirección, transmisión y más." },
  { icon: Zap, title: "Eléctrico y climatización", text: "Baterías, sensores, iluminación y aire acondicionado." },
];

function About() {
  return (
    <section id="nosotros" className="lp-section lp-light relative bg-white py-28 sm:py-36">
      <div className="lp-wrap grid [&>*]:min-w-0 gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-24">
        <div data-reveal>
          <h2 className="lp-display lp-h2 max-w-[14ch] text-[var(--lp-navy)]">Más que mantenimiento. Confianza en cada recorrido.</h2>
          <p className="lp-lead mt-7 max-w-[32rem] text-[var(--lp-mute)]">
            Centro automotriz en Tegucigalpa dedicado al mantenimiento, el diagnóstico y la reparación de vehículos particulares y flotillas.
          </p>
        </div>
        <ul className="grid gap-x-10 sm:grid-cols-2">
          {PILLARS.map((p, i) => (
            <li key={p.title} data-reveal style={{ ["--d" as string]: `${(i % 2) * 90}ms` }} className="flex gap-4 border-t border-[var(--lp-line)] py-6">
              <p.icon className="mt-0.5 h-6 w-6 shrink-0 text-[var(--lp-electric-ink)]" aria-hidden strokeWidth={1.8} />
              <div>
                <h3 className="lp-display text-[1.08rem] leading-tight text-[var(--lp-navy)]">{p.title}</h3>
                <p className="mt-1.5 text-[0.94rem] leading-relaxed text-[var(--lp-mute)]">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
