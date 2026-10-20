import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, Cpu, Gauge, Menu, MessageCircle, Smartphone, Truck, Wrench, X, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import "./landing.css";
import { BUSINESS, WA_MESSAGES, structuredData, waLink } from "./business";
import { BrandLogo } from "./Brand";
import { HeroCar } from "./Art";
import { finePointer, useReducedMotion, useRevealAll } from "./motion";
import { ServicesSection } from "./Services";
import { ContactSection, FleetSection, Footer, ProcessSection, TrackingSection } from "./Sections";

const TITLE = "RAPIFIX Centro Automotriz: mantenimiento, diagnóstico y reparación en Tegucigalpa";
const DESCRIPTION =
  "Mantenimiento preventivo, frenos, suspensión, aire acondicionado, sistema eléctrico, diagnóstico computarizado y mantenimiento de flotillas en Tegucigalpa. Sigue el estado de tu vehículo desde el celular.";

export const NAV_LINKS = [
  { id: "inicio", label: "Inicio" },
  { id: "nosotros", label: "Nosotros" },
  { id: "servicios", label: "Servicios" },
  { id: "flotillas", label: "Flotillas" },
  { id: "tecnologia", label: "Tecnología" },
  { id: "contacto", label: "Contacto" },
] as const;

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
      <Nav />
      <main id="contenido">
        <Hero />
        <About />
        <ServicesSection />
        <FleetSection />
        <TrackingSection />
        <ProcessSection />
        <ContactSection />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- Navegación */

function Nav() {
  const { status } = useAuth();
  const signedIn = status === "ready" || status === "noRole";
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("inicio");
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setSolid(window.scrollY > 24);
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Sección activa
  useEffect(() => {
    const els = NAV_LINKS.map((l) => document.getElementById(l.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Menú móvil: Esc cierra, el foco entra al menú y vuelve al botón
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>("a,button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuBtn.current?.focus();
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const wa = waLink(WA_MESSAGES.general);
  const access = signedIn ? { to: "/", label: "Ir al panel" } : { to: "/login", label: "Acceso" };

  return (
    <header className="lp-nav fixed inset-x-0 top-0 z-50" data-solid={solid || open}>
      <div className="lp-wrap flex h-[68px] items-center gap-6">
        <a href="#inicio" className="shrink-0" aria-label="RAPIFIX, ir al inicio">
          <BrandLogo />
        </a>
        <nav aria-label="Principal" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-7 text-[0.94rem] font-medium">
            {NAV_LINKS.map((l) => (
              <li key={l.id}>
                <a href={`#${l.id}`} className="lp-navlink" aria-current={active === l.id ? "true" : undefined}>{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <Link to={access.to} className="hidden rounded-full px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white sm:inline-flex">
            {access.label}
          </Link>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-red hidden !min-h-[42px] !px-4 text-sm sm:inline-flex">
              <MessageCircle className="h-4 w-4" aria-hidden /> Escríbenos
            </a>
          )}
          <button
            ref={menuBtn}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10 lg:hidden"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>
      <div
        id="lp-menu"
        ref={menu}
        className="lp-menu absolute inset-x-0 top-[68px] h-[calc(100dvh-68px)] overflow-y-auto bg-[#010f3c] lg:hidden"
        data-open={open}
        inert={!open}
      >
        <nav aria-label="Menú móvil" className="lp-wrap flex flex-col py-6">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={() => setOpen(false)} className="lp-display border-b border-white/10 py-4 text-[1.7rem] text-white" aria-current={active === l.id ? "true" : undefined}>
              {l.label}
            </a>
          ))}
          <div className="mt-8 grid gap-3">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-red w-full">
                <MessageCircle className="h-5 w-5" aria-hidden /> Escríbenos por WhatsApp
              </a>
            )}
            <Link to={access.to} className="lp-btn lp-btn-ghost w-full" onClick={() => setOpen(false)}>{access.label === "Acceso" ? "Acceso del personal" : access.label}</Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- Hero */

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const carRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Parallax suave del vehículo con el scroll y el puntero (solo puntero preciso)
  useEffect(() => {
    const el = ref.current;
    const car = carRef.current;
    if (!el || !car || reduce) return;
    let raf = 0;
    let last = -1;
    const scroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // Solo mientras el hero está a la vista (más abajo el valor queda fijo y no se repinta)
        const y = Math.min(window.scrollY, 900);
        if (y === last) return;
        last = y;
        car.style.setProperty("--sy", `${(y * 0.12).toFixed(1)}px`);
      });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !finePointer()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      car.style.setProperty("--px", `${(x * -14).toFixed(1)}px`);
      car.style.setProperty("--py", `${(y * -8).toFixed(1)}px`);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    el.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("scroll", scroll);
      el.removeEventListener("pointermove", move);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const photo = BUSINESS.heroImage;

  return (
    <section ref={ref} id="inicio" className="lp-hero lp-section relative overflow-hidden text-white">
      {photo ? (
        <div className="absolute inset-0 -z-10">
          <img src={photo} alt={BUSINESS.heroImageAlt ?? ""} className="h-full w-full object-cover" fetchPriority="high" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--lp-night)] via-[rgb(0_10_43/0.75)] to-[rgb(0_10_43/0.2)]" />
        </div>
      ) : (
        <>
          <div className="lp-hero-strip" aria-hidden />
          <div className="lp-hero-grid" aria-hidden />
        </>
      )}
      <div className="lp-noise" aria-hidden />

      <div className="lp-wrap relative flex min-h-[100svh] flex-col pb-10 pt-[112px] lg:min-h-[min(100svh,960px)] lg:pt-[150px]">
        <div className="max-w-[46rem]">
          <p className="lp-in flex items-center gap-3 text-[0.95rem] font-semibold text-white/85" style={{ ["--d" as string]: "60ms" }}>
            <span className="h-[3px] w-8 rounded-full bg-[var(--lp-red)]" aria-hidden />
            RAPIFIX Centro Automotriz
          </p>
          <h1 className="lp-display lp-h1 mt-6">
            <span className="lp-in block whitespace-nowrap" style={{ ["--d" as string]: "160ms" }}>Tu vehículo</span>
            <span className="lp-in block whitespace-nowrap" style={{ ["--d" as string]: "280ms" }}>merece más.</span>
          </h1>
          <p className="lp-in lp-lead mt-7 max-w-[34rem] text-white" style={{ ["--d" as string]: "420ms" }}>
            La nueva forma de cuidar, reparar y mantener tu automóvil.
          </p>
          <p className="lp-in mt-3 max-w-[34rem] text-[1.02rem] leading-relaxed text-[var(--lp-mute-dark)]" style={{ ["--d" as string]: "500ms" }}>
            Profesionalismo, transparencia y una experiencia diseñada para que conduzcas con tranquilidad.
          </p>
          <div className="lp-in mt-9 flex flex-wrap gap-3" style={{ ["--d" as string]: "620ms" }}>
            <a href="#servicios" className="lp-btn lp-btn-red">
              Descubre nuestros servicios <ArrowRight className="lp-arrow h-4 w-4" aria-hidden />
            </a>
            <a href="#nosotros" className="lp-btn lp-btn-ghost">Conoce RAPIFIX</a>
          </div>
        </div>

        {!photo && (
          <div
            ref={carRef}
            className="lp-hero-car pointer-events-none relative -mx-4 mt-auto pt-10 sm:mx-0 lg:absolute lg:bottom-[7%] lg:right-[-14%] lg:mt-0 lg:w-[78%] xl:right-[-12%] xl:w-[76%]"
          >
            <div className="lp-hero-glow absolute inset-x-[10%] top-[30%] h-[40%] rounded-full bg-[var(--lp-electric)]/20 blur-[80px]" aria-hidden />
            <div className="lp-car-wrap relative">
              <HeroCar className="h-auto w-[118%] max-w-none sm:w-full" />
            </div>
          </div>
        )}

        <ul className="lp-in relative z-[1] mt-6 hidden flex-wrap lg:flex gap-x-7 gap-y-2 text-sm text-white/85 lg:mt-auto lg:max-w-[40%] lg:pt-16" style={{ ["--d" as string]: "800ms" }} aria-label="Lo que hacemos">
          <li className="flex items-center gap-2"><Gauge className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden /> Mantenimiento</li>
          <li className="flex items-center gap-2"><Cpu className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden /> Diagnóstico</li>
          <li className="flex items-center gap-2"><Wrench className="h-4 w-4 text-[var(--lp-electric)]" aria-hidden /> Reparación</li>
        </ul>
      </div>
      {/* Transición hacia la sección clara */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[var(--lp-night)]" aria-hidden />
    </section>
  );
}

/* ---------------------------------------------------------------- Nosotros */

const PILLARS = [
  { icon: Gauge, title: "Mantenimiento preventivo", text: "Cambios de aceite, filtros y fluidos, e inspecciones por kilometraje según las recomendaciones del fabricante." },
  { icon: ClipboardCheck, title: "Diagnóstico automotriz", text: "Inspección general y diagnóstico computarizado en sistemas compatibles, con informe técnico y cotización." },
  { icon: Wrench, title: "Reparación mecánica", text: "Frenos, suspensión, dirección, transmisión, enfriamiento, combustible y escape." },
  { icon: Zap, title: "Sistemas eléctricos y electrónicos", text: "Baterías, carga, arranque, iluminación, sensores, y aire acondicionado y climatización." },
  { icon: Truck, title: "Flotillas", text: "Mantenimiento programado e historial por vehículo para instituciones públicas y privadas." },
  { icon: Smartphone, title: "Seguimiento digital", text: "Un enlace personal para ver el avance de tu vehículo, aprobar la cotización y pagar en línea." },
];

function About() {
  return (
    <section id="nosotros" className="lp-section lp-light relative bg-[var(--lp-paper)] py-24 sm:py-32">
      <div className="lp-wrap grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <div data-reveal>
          <h2 className="lp-display lp-h2 text-[var(--lp-navy)]">
            Más que mantenimiento. Confianza en cada recorrido.
          </h2>
          <p className="lp-lead mt-7 max-w-[36rem] text-[var(--lp-mute)]">
            RAPIFIX Centro Automotriz es un taller dedicado al mantenimiento, el diagnóstico y la reparación de vehículos.
            Te explicamos qué encontramos, te cotizamos antes de trabajar y te mantenemos al tanto hasta que tu vehículo
            está listo para volver a la calle.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href="#servicios" className="lp-btn lp-btn-navy">Ver el catálogo completo</a>
            <a href="#contacto" className="lp-btn lp-btn-line">Cómo encontrarnos</a>
          </div>
        </div>
        <ul className="grid gap-x-10 sm:grid-cols-2">
          {PILLARS.map((p, i) => (
            <li key={p.title} data-reveal style={{ ["--d" as string]: `${(i % 2) * 90}ms` }} className="border-t border-[var(--lp-line)] py-6">
              <p.icon className={cn("h-6 w-6", i === 5 ? "text-[var(--lp-red-ink)]" : "text-[var(--lp-electric-ink)]")} aria-hidden strokeWidth={1.8} />
              <h3 className="lp-display lp-h3 mt-4 text-[var(--lp-navy)]">{p.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--lp-mute)]">{p.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
