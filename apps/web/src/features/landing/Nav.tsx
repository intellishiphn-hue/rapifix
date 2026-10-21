import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Menu, MessageCircle, X } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { WA_MESSAGES, waLink } from "./business";
import { BrandLogo } from "./Brand";

/** Secciones de la landing; "route" son páginas aparte (no anclas). */
export const NAV_LINKS: ReadonlyArray<{ id: string; label: string; route?: string }> = [
  { id: "inicio", label: "Inicio" },
  { id: "nosotros", label: "Nosotros" },
  { id: "servicios", label: "Servicios" },
  { id: "flotillas", label: "Flotillas" },
  { id: "carwash", label: "Carwash", route: "/lavado" },
  { id: "tecnologia", label: "Tecnología" },
  { id: "contacto", label: "Contacto" },
];

/**
 * Navegación pública. En la landing los enlaces son anclas (#servicios); en otras páginas
 * públicas (base="/inicio") llevan a la sección de la landing.
 */
export function Nav({ base = "", current }: { base?: string; current?: string }) {
  const { status } = useAuth();
  const signedIn = status === "ready" || status === "noRole";
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(current ?? "inicio");
  const hrefOf = (l: { id: string; route?: string }) => l.route ?? `${base}#${l.id}`;
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
    if (current) return;
    const els = NAV_LINKS.filter((l) => !l.route).map((l) => document.getElementById(l.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [current]);

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
        <a href={`${base}#inicio`} className="shrink-0" aria-label="RAPIFIX, ir al inicio">
          <BrandLogo />
        </a>
        <nav aria-label="Principal" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-7 text-[0.94rem] font-medium">
            {NAV_LINKS.map((l) => (
              <li key={l.id}>
                <a href={hrefOf(l)} className="lp-navlink" aria-current={active === l.id ? "true" : undefined}>{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-2">
          <Link to={access.to} className="hidden rounded-full px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:text-white sm:inline-flex">
            {access.label}
          </Link>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp" title="Escríbenos por WhatsApp" className="hidden h-[42px] w-[42px] items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:border-white/60 hover:bg-white/10 sm:inline-flex">
              <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
            </a>
          )}
          <Link to="/agendar" className="lp-btn lp-btn-red !min-h-[42px] !px-4 text-sm">
            <CalendarCheck className="h-4 w-4" aria-hidden /> <span className="sm:hidden">Agendar</span><span className="hidden sm:inline">Agendar cita</span>
          </Link>
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
            <a key={l.id} href={hrefOf(l)} onClick={() => setOpen(false)} className="lp-display border-b border-white/10 py-4 text-[1.7rem] text-white" aria-current={active === l.id ? "true" : undefined}>
              {l.label}
            </a>
          ))}
          <div className="mt-8 grid gap-3">
            <Link to="/agendar" className="lp-btn lp-btn-red w-full" onClick={() => setOpen(false)}>
              <CalendarCheck className="h-5 w-5" aria-hidden /> Agendar cita
            </Link>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa w-full">
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

