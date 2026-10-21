import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, ScanSearch, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { categoryById, jobsLabel, type CategoryId } from "./catalog";
import { TRUCK_W, TruckArt, ZONE_POINTS } from "./TruckArt";
import { useOpenCategory } from "./Services";

type ZoneId = keyof typeof ZONE_POINTS;

/** Zonas del vehículo y las categorías del catálogo oficial que cubren (los conteos salen de catalog.ts) */
const ZONES: Array<{ id: ZoneId; title: string; text: string; categories: CategoryId[] }> = [
  { id: "hood", title: "Motor", text: "Aceite, filtros, combustible y enfriamiento.", categories: ["mantenimiento", "combustible", "enfriamiento"] },
  { id: "lights", title: "Faros y sistema eléctrico", text: "Batería, carga, arranque, luces y sensores.", categories: ["electrico"] },
  { id: "cabin", title: "Cabina y climatización", text: "Aire acondicionado y confort en la cabina.", categories: ["aire"] },
  { id: "wheels", title: "Llantas y frenos", text: "Frenos, suspensión, rodamientos y ruedas.", categories: ["frenos", "suspension", "rodamientos"] },
  { id: "under", title: "Bajos del vehículo", text: "Transmisión, tren motriz y dirección.", categories: ["transmision", "direccion"] },
  { id: "exhaust", title: "Escape", text: "Tuberías, silenciadores y sensores de oxígeno.", categories: ["escape"] },
];

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

export function MultipointSection() {
  const openCategory = useOpenCategory();
  const wide = useWide();
  const [hot, setHot] = useState<ZoneId | null>(null);
  const [open, setOpen] = useState<ZoneId | null>(null);
  const [scanned, setScanned] = useState(false);
  const [touch] = useState(() => typeof window !== "undefined" && !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const spots = useRef<Partial<Record<ZoneId, HTMLButtonElement | null>>>({});
  const chipBtns = useRef<Partial<Record<ZoneId, HTMLButtonElement | null>>>({});
  const cardId = useId();
  const active = open ?? hot;
  const zone = ZONES.find((z) => z.id === open) ?? null;

  // Escáner: una sola vez, al entrar la sección en pantalla
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setScanned(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setScanned(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Esc cierra y devuelve el foco; tocar fuera cierra
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const was = open;
        setOpen(null);
        (spots.current[was] ?? chipBtns.current[was])?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || chips.current?.contains(t)) return;
      if (Object.values(spots.current).some((b) => b?.contains(t))) return;
      setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const show = (id: ZoneId, focusCard = false) => {
    if (open === id && !focusCard) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (focusCard) requestAnimationFrame(() => card.current?.querySelector<HTMLElement>("button")?.focus());
  };

  const diag = categoryById("diagnostico");
  // Lienzo recortado a la camioneta (con margen para la rueda de repuesto y la defensa)
  const box = { x: 86, y: 150, w: 1236, h: 480 };

  const closeCard = () => {
    const was = open;
    setOpen(null);
    if (was) (spots.current[was] ?? chipBtns.current[was])?.focus();
  };

  const cardEl = zone && (
    <div ref={card} id={cardId} role="region" aria-label={zone.title} className="mp-card rounded-3xl border border-[rgb(1_25_85/0.1)] bg-white p-5 text-[var(--lp-ink)] shadow-[0_24px_60px_-34px_rgb(1_25_85/0.55)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="lp-display text-[1.25rem] leading-tight text-[var(--lp-navy)]">{zone.title}</p>
          <p className="mt-1 text-[0.93rem] leading-snug text-[var(--lp-mute)]">{zone.text}</p>
        </div>
        <button type="button" onClick={closeCard} className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--lp-mute)] hover:bg-[var(--lp-paper)] hover:text-[var(--lp-navy)]" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>
      <ul className="mt-3 divide-y divide-[var(--lp-line)] border-t border-[var(--lp-line)]">
        {zone.categories.map((cid) => {
          const c = categoryById(cid);
          return (
            <li key={cid} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block font-semibold leading-tight text-[var(--lp-navy)]">{c.short}</span>
                <span className="text-sm text-[var(--lp-mute)]">{jobsLabel(c.jobs.length)}</span>
              </span>
              <button type="button" onClick={() => openCategory(cid)} aria-haspopup="dialog" aria-label={`Ver servicios de ${c.name}`} className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-[var(--lp-electric-ink)] hover:bg-[var(--lp-paper)]">
                Ver servicios <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <Link to={`/agendar?motivo=${zone.categories[0]}`} className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--lp-navy)] hover:underline">
        <CalendarCheck className="h-4 w-4 text-[var(--lp-red-ink)]" aria-hidden /> Agendar una revisión
      </Link>
    </div>
  );

  /** Lista de zonas: menú principal en pantallas táctiles y alternativa accesible en escritorio */
  const chipsEl = (
    <div ref={chips} role="group" aria-label="Zonas del vehículo" className={cn("flex flex-wrap gap-2", wide && "flex-col")}>
      {ZONES.map((z) => (
        <button
          key={z.id}
          ref={(b) => {
            chipBtns.current[z.id] = b;
          }}
          type="button"
          aria-pressed={open === z.id}
          aria-controls={open === z.id ? cardId : undefined}
          onClick={(e) => (e.detail === 0 ? show(z.id, true) : setOpen((o) => (o === z.id ? null : z.id)))}
          onPointerEnter={(e) => e.pointerType === "mouse" && setHot(z.id)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHot(null)}
          className={cn(
            "lp-chip inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-medium",
            wide && "justify-between rounded-2xl text-[0.95rem]",
            open === z.id ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[rgb(1_25_85/0.16)] bg-white text-[var(--lp-navy)] hover:border-[var(--lp-navy)]",
          )}
        >
          <span className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", open === z.id ? "bg-white" : "bg-[var(--lp-red)]")} aria-hidden />
            {z.title}
          </span>
          {wide && <ArrowRight className="h-4 w-4 opacity-60" aria-hidden />}
        </button>
      ))}
    </div>
  );

  return (
    <section id="multipuntos" aria-labelledby="mp-title" className="lp-section lp-light relative overflow-hidden bg-[var(--lp-paper)] pb-24 pt-24 sm:pb-28 sm:pt-32">
      <div className="mp-backdrop pointer-events-none absolute inset-0" aria-hidden />
      <div className="lp-wrap relative">
        <div className={cn(wide ? "grid grid-cols-[340px_minmax(0,1fr)] items-center gap-12 xl:grid-cols-[360px_minmax(0,1fr)]" : "")}>
          <div className={cn(wide && "self-start")}>
            <div data-reveal>
              <h2 id="mp-title" className="lp-display lp-h2 text-[var(--lp-navy)]">Revisión multipuntos</h2>
              <p className="lp-lead mt-5 max-w-[34rem] text-[var(--lp-mute)]">
                {touch || !wide ? "Toca cada zona del vehículo para ver lo que revisamos." : "Elige una zona o pasa el cursor sobre cada punto del vehículo."}
              </p>
            </div>
            {wide && <div className="mt-8 min-h-[360px]">{zone ? cardEl : chipsEl}</div>}
          </div>

          <div ref={stage} className={cn("mp-stage relative", !wide && "mt-8", scanned && "is-scanned")} data-active={active ?? undefined}>
            <TruckArt className="mp-svg block h-auto w-full" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} />
            {ZONES.map((z, i) => {
              const p = ZONE_POINTS[z.id];
              const style = {
                left: `${((p.x - box.x) / box.w) * 100}%`,
                top: `${((p.y - box.y) / box.h) * 100}%`,
                ["--spot-delay" as string]: `${400 + (p.x / TRUCK_W) * 1500 + i * 30}ms`,
              };
              // En pantallas angostas los puntos son solo indicadores: el menú táctil son las zonas de abajo
              if (!wide) {
                return (
                  <span key={z.id} className={cn("mp-spot mp-spot-mini", open === z.id && "is-open")} style={style} aria-hidden>
                    <span className="mp-dot" />
                  </span>
                );
              }
              const expanded = open === z.id;
              return (
                <button
                  key={z.id}
                  ref={(b) => {
                    spots.current[z.id] = b;
                  }}
                  type="button"
                  className={cn("mp-spot", expanded && "is-open")}
                  style={style}
                  aria-label={`${z.title}: ver lo que revisamos`}
                  aria-expanded={expanded}
                  aria-controls={expanded ? cardId : undefined}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") {
                      setHot(z.id);
                      setOpen(z.id);
                    }
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setHot(null);
                  }}
                  onFocus={() => setHot(z.id)}
                  onBlur={() => setHot(null)}
                  onClick={(e) => {
                    const pt = (e.nativeEvent as PointerEvent).pointerType;
                    if (e.detail === 0 || !pt) show(z.id, true);
                    else if (pt === "mouse") setOpen(z.id);
                    else setOpen((o) => (o === z.id ? null : z.id));
                  }}
                >
                  <span className="mp-dot" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>

        {!wide && (
          <div className="mt-6 space-y-4">
            {chipsEl}
            {cardEl}
          </div>
        )}

        <div className="mt-10 flex flex-col items-start gap-4 border-t border-[var(--lp-line)] pt-8 lg:flex-row lg:items-center lg:justify-between" data-reveal>
          <p className="flex items-center gap-3 text-[0.98rem] text-[var(--lp-ink)]">
            <ScanSearch className="h-5 w-5 shrink-0 text-[var(--lp-electric-ink)]" aria-hidden strokeWidth={1.9} />
            <span>
              <b className="font-semibold text-[var(--lp-navy)]">Diagnóstico completo:</b> inspección general y diagnóstico computarizado, con informe técnico y cotización. <span className="text-[var(--lp-mute)]">{jobsLabel(diag.jobs.length)}.</span>
            </span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-3">
            <button type="button" onClick={() => openCategory("diagnostico")} aria-haspopup="dialog" className="lp-btn lp-btn-line">
              Ver servicios de diagnóstico
            </button>
            <Link to="/agendar?motivo=diagnostico" className="lp-btn lp-btn-navy">
              <CalendarCheck className="h-4 w-4" aria-hidden /> Agendar diagnóstico
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
