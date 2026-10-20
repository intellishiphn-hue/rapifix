import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AirVent, ArrowRight, BatteryCharging, Check, CircleDot, CloudFog, Cog, Disc3, Droplets, Fuel, LifeBuoy, MessageCircle,
  MoveVertical, ScanSearch, Search, SearchX, Thermometer, Truck, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CATALOG, TOTAL_JOBS, categoryById, jobsLabel, type CategoryId, type ServiceCategory } from "./catalog";
import { highlightRanges, queryTerms, searchCatalog } from "./search";
import { WA_MESSAGES, waCategory, waLink } from "./business";
import { Motif } from "./Art";
import { tiltHandlers } from "./motion";

export const CATEGORY_ICON: Record<CategoryId, LucideIcon> = {
  mantenimiento: Droplets,
  frenos: Disc3,
  suspension: MoveVertical,
  direccion: LifeBuoy,
  transmision: Cog,
  enfriamiento: Thermometer,
  electrico: BatteryCharging,
  combustible: Fuel,
  escape: CloudFog,
  rodamientos: CircleDot,
  diagnostico: ScanSearch,
  flotillas: Truck,
  aire: AirVent,
};

/** Orden visual del mosaico (jerarquía de diseño; el catálogo conserva su orden oficial) */
const BENTO: Array<{ id: CategoryId; span: string; variant: "hero" | "wide" | "small" | "fleet" }> = [
  { id: "mantenimiento", span: "col-span-2 lg:row-span-2", variant: "hero" },
  { id: "frenos", span: "col-span-2", variant: "wide" },
  { id: "diagnostico", span: "col-span-2", variant: "wide" },
  { id: "aire", span: "col-span-2", variant: "wide" },
  { id: "suspension", span: "", variant: "small" },
  { id: "direccion", span: "", variant: "small" },
  { id: "transmision", span: "", variant: "small" },
  { id: "enfriamiento", span: "", variant: "small" },
  { id: "electrico", span: "", variant: "small" },
  { id: "combustible", span: "", variant: "small" },
  { id: "escape", span: "", variant: "small" },
  { id: "rodamientos", span: "", variant: "small" },
  { id: "flotillas", span: "col-span-2", variant: "fleet" },
];

export function ServicesSection() {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<CategoryId | null>(null);
  const [openId, setOpenId] = useState<CategoryId | null>(null);
  const [dialogQuery, setDialogQuery] = useState("");
  const inputId = useId();
  const statusId = useId();

  const searching = query.trim().length > 0 || only !== null;
  const results = useMemo(() => (searching ? searchCatalog(query, only) : []), [query, only, searching]);
  const groups = useMemo(() => queryTerms(query), [query]);
  const jobCount = results.reduce((n, r) => n + r.jobs.length, 0);

  const open = (id: CategoryId, withQuery = "") => {
    setDialogQuery(withQuery);
    setOpenId(id);
  };

  const status = !searching
    ? `${CATALOG.length} categorías y ${TOTAL_JOBS} trabajos en el catálogo.`
    : results.length === 0
      ? "Sin resultados."
      : `${jobsLabel(jobCount)} en ${results.length} ${results.length === 1 ? "categoría" : "categorías"}.`;

  return (
    <section id="servicios" className="lp-section lp-light relative bg-white py-24 sm:py-32">
      <div className="lp-wrap">
        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-end" data-reveal>
          <h2 className="lp-display lp-h2 max-w-[15ch] text-[var(--lp-navy)]">Todo lo que tu vehículo necesita. En un solo lugar.</h2>
          <p className="lp-lead max-w-[32rem] text-[var(--lp-mute)]">
            Desde el mantenimiento preventivo hasta el diagnóstico especializado, descubre las soluciones automotrices de RAPIFIX.
          </p>
        </div>

        {/* Buscador */}
        <div className="mt-12" data-reveal>
          <div role="search" className="lp-search flex items-center gap-3 rounded-2xl border border-[rgb(1_25_85/0.16)] bg-[var(--lp-paper)] px-4 sm:px-5">
            <Search className="h-5 w-5 shrink-0 text-[var(--lp-navy)]" aria-hidden />
            <label htmlFor={inputId} className="sr-only">Buscar un servicio en el catálogo</label>
            <input
              id={inputId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="Busca un servicio: aceite, frenos, batería, clutch..."
              autoComplete="off"
              enterKeyHint="search"
              aria-describedby={statusId}
              className="h-14 min-w-0 flex-1 bg-transparent text-[1.02rem] text-[var(--lp-ink)] placeholder:text-[#6b7694] [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--lp-mute)] hover:bg-white hover:text-[var(--lp-navy)]" aria-label="Borrar búsqueda">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="lp-chips -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filtrar por categoría">
            <Chip pressed={only === null} onClick={() => setOnly(null)}>Todas</Chip>
            {CATALOG.map((c) => (
              <Chip key={c.id} pressed={only === c.id} onClick={() => setOnly(only === c.id ? null : c.id)}>{c.short}</Chip>
            ))}
          </div>
          <p id={statusId} className="mt-4 text-sm text-[var(--lp-mute)]" role="status" aria-live="polite">{status}</p>
        </div>

        {/* Resultados o mosaico */}
        {searching ? (
          <Results results={results} groups={groups} query={query} onOpen={(id) => open(id, query)} onReset={() => { setQuery(""); setOnly(null); }} />
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:auto-rows-[minmax(190px,auto)] lg:grid-cols-4">
            {BENTO.map((b, i) => (
              <li key={b.id} className={cn(b.span, "flex")} data-reveal style={{ ["--d" as string]: `${Math.min(i, 6) * 60}ms` }}>
                <Tile category={categoryById(b.id)} variant={b.variant} onOpen={() => open(b.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CategoryDialog id={openId} query={dialogQuery} onClose={() => setOpenId(null)} onNavigate={(id) => open(id)} />
    </section>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="lp-chip inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-[rgb(1_25_85/0.16)] bg-white px-4 text-sm font-medium text-[var(--lp-navy)] hover:border-[var(--lp-navy)]"
    >
      {children}
    </button>
  );
}

function Tile({ category: c, variant, onOpen }: { category: ServiceCategory; variant: "hero" | "wide" | "small" | "fleet"; onOpen: () => void }) {
  const Icon = CATEGORY_ICON[c.id];
  const tilt = useMemo(() => tiltHandlers(), []);
  const dark = variant === "hero" || variant === "fleet";
  const label = `${c.name}: ${jobsLabel(c.jobs.length)}. Ver detalle`;
  const motifKind = c.id === "mantenimiento" || c.id === "frenos" || c.id === "diagnostico" || c.id === "aire" || c.id === "flotillas" ? c.id : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={label}
      {...tilt}
      className={cn(
        "lp-tile group flex w-full flex-col",
        dark ? "lp-tile-dark" : "lp-tile-plain",
        variant === "hero" ? "min-h-[360px] p-6 sm:p-8 lg:min-h-[400px]" : variant === "small" ? "min-h-[150px] p-4 sm:min-h-[170px] sm:p-5" : "min-h-[190px] p-6 sm:p-7",
      )}
    >
      {motifKind && (
        <span
          aria-hidden
          className={cn(
            "lp-tile-motif pointer-events-none absolute",
            variant === "hero" && "-bottom-10 -right-10 h-[260px] w-[260px] text-white/25 sm:h-[320px] sm:w-[320px] lg:-bottom-6 lg:-right-6 lg:h-[340px] lg:w-[340px]",
            c.id === "frenos" && "hidden sm:block -right-8 top-1/2 h-[200px] w-[200px] -translate-y-1/2 text-[var(--lp-navy)]/25 sm:right-2 sm:h-[180px] sm:w-[180px]",
            (c.id === "diagnostico" || c.id === "aire") && "hidden sm:block right-5 top-6 h-[64px] w-[150px] text-[var(--lp-electric-ink)]/40 sm:h-[80px] sm:w-[220px]",
            c.id === "flotillas" && "hidden sm:block bottom-3 right-4 h-[80px] w-[260px] text-white/30 sm:w-[300px]",
          )}
        >
          <Motif kind={motifKind} className="h-full w-full" />
        </span>
      )}
      <span className={cn("relative flex h-11 w-11 items-center justify-center rounded-xl", dark ? "bg-white/10 text-white" : "bg-[var(--lp-paper)] text-[var(--lp-navy)]")}>
        <Icon className="h-[22px] w-[22px]" aria-hidden strokeWidth={1.8} />
      </span>
      <span className={cn("relative mt-auto block pt-6", variant !== "small" && "max-w-[22rem]")}>
        <span className={cn("lp-display block", variant === "hero" ? "text-[clamp(1.7rem,3vw,2.5rem)] leading-[1.02]" : variant === "small" ? "text-[1.02rem] leading-[1.1] sm:text-[1.12rem]" : "text-[1.45rem] leading-[1.05]", dark ? "text-white" : "text-[var(--lp-navy)]")}>
          {variant === "small" ? c.short : c.name}
        </span>
        {variant === "small" && <span className="mt-2 hidden text-[0.88rem] leading-snug text-[var(--lp-mute)] lg:block">{c.blurb}</span>}
        {variant !== "small" && (
          <span className={cn("mt-3 block max-w-[30rem] text-[0.95rem] leading-relaxed", dark ? "text-[var(--lp-mute-dark)]" : "text-[var(--lp-mute)]")}>{c.blurb}</span>
        )}
        <span className={cn("mt-4 flex items-center gap-2 text-sm font-semibold", dark ? "text-white" : "text-[var(--lp-electric-ink)]")}>
          {jobsLabel(c.jobs.length)}
          <ArrowRight className="lp-tile-go h-4 w-4" aria-hidden />
        </span>
      </span>
    </button>
  );
}

function Highlight({ text, groups }: { text: string; groups: string[][] }) {
  const ranges = groups.length ? highlightRanges(text, groups) : [];
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function Results({ results, groups, query, onOpen, onReset }: { results: ReturnType<typeof searchCatalog>; groups: string[][]; query: string; onOpen: (id: CategoryId) => void; onReset: () => void }) {
  if (!results.length) {
    const wa = waLink(`Hola RAPIFIX, busqué "${query.trim()}" en su sitio y quisiera consultar si lo pueden hacer.`);
    return (
      <div className="lp-result mt-8 rounded-3xl border border-dashed border-[rgb(1_25_85/0.2)] px-6 py-14 text-center">
        <SearchX className="mx-auto h-8 w-8 text-[var(--lp-mute)]" aria-hidden />
        <p className="lp-display lp-h3 mt-4 text-[var(--lp-navy)]">No encontramos "{query.trim()}" en el catálogo</p>
        <p className="mx-auto mt-2 max-w-md text-[var(--lp-mute)]">Prueba con otra palabra, quita el filtro o escríbenos y te decimos si podemos ayudarte.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={onReset} className="lp-btn lp-btn-line">Ver todo el catálogo</button>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa"><MessageCircle className="h-4 w-4" aria-hidden /> Preguntar por WhatsApp</a>}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-2">
      {results.map((r, i) => {
        const Icon = CATEGORY_ICON[r.category.id];
        return (
          <section key={r.category.id} className="lp-result rounded-3xl border border-[var(--lp-line)] bg-white p-5 sm:p-6" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} aria-labelledby={`r-${r.category.id}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--lp-paper)] text-[var(--lp-navy)]"><Icon className="h-5 w-5" aria-hidden strokeWidth={1.8} /></span>
              <div className="min-w-0 flex-1">
                <h3 id={`r-${r.category.id}`} className="lp-display text-[1.15rem] leading-tight text-[var(--lp-navy)]"><Highlight text={r.category.name} groups={groups} /></h3>
                <p className="mt-0.5 text-sm text-[var(--lp-mute)]">
                  {r.categoryMatch ? `Todos sus ${jobsLabel(r.jobs.length)}` : `${r.jobs.length} de ${jobsLabel(r.category.jobs.length)}`}
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {r.jobs.map((j) => (
                <li key={j} className="flex gap-2.5 text-[0.95rem] leading-snug text-[var(--lp-ink)]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-electric-ink)]" aria-hidden />
                  <span><Highlight text={j} groups={groups} /></span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => onOpen(r.category.id)} aria-haspopup="dialog" className="mt-5 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--lp-electric-ink)] hover:underline">
              Ver la categoría completa <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </section>
        );
      })}
    </div>
  );
}

/** Detalle de categoría: <dialog> nativo (foco atrapado, Esc, fondo inerte) */
function CategoryDialog({ id, query, onClose, onNavigate }: { id: CategoryId | null; query: string; onClose: () => void; onNavigate: (id: CategoryId) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [shown, setShown] = useState<CategoryId | null>(id);
  if (id && id !== shown) setShown(id);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      d.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!id && d.open) {
      d.close();
    }
  }, [id]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClosed = () => {
      document.documentElement.style.overflow = "";
      onClose();
      returnTo.current?.focus({ preventScroll: true });
    };
    d.addEventListener("close", onClosed);
    return () => d.removeEventListener("close", onClosed);
  }, [onClose]);

  const c = shown ? categoryById(shown) : null;
  const groups = queryTerms(query);
  const Icon = c ? CATEGORY_ICON[c.id] : null;
  const idx = c ? CATALOG.findIndex((x) => x.id === c.id) : -1;
  const prev = idx > 0 ? CATALOG[idx - 1] : null;
  const next = idx >= 0 && idx < CATALOG.length - 1 ? CATALOG[idx + 1] : null;
  const wa = c ? (c.id === "flotillas" ? waLink(WA_MESSAGES.fleet) : waCategory(c.short)) : null;

  return (
    <dialog
      ref={ref}
      className="lp-dialog"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      {c && Icon && (
        <div className="flex max-h-[inherit] flex-col overflow-hidden rounded-t-[28px] bg-white text-[var(--lp-ink)] shadow-2xl sm:rounded-[28px]">
          <div className="relative shrink-0 overflow-hidden bg-[var(--lp-navy)] px-6 pb-7 pt-6 text-white sm:px-8">
            <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[var(--lp-electric)]/25 blur-3xl" aria-hidden />
            <div className="relative flex items-start justify-between gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10"><Icon className="h-6 w-6" aria-hidden strokeWidth={1.8} /></span>
              <button type="button" onClick={() => ref.current?.close()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Cerrar detalle">
                <X className="h-5 w-5" />
              </button>
            </div>
            <h3 id={titleId} className="lp-display relative mt-5 text-[clamp(1.6rem,4vw,2.2rem)] leading-[1.02]">{c.name}</h3>
            <p className="relative mt-2 text-sm text-[var(--lp-mute-dark)]">Categoría {c.order} de {CATALOG.length} del catálogo. {jobsLabel(c.jobs.length)}.</p>
          </div>
          <div className="overflow-y-auto overscroll-contain px-6 py-6 sm:px-8">
            {c.intro && <p className="mb-5 text-[0.98rem] leading-relaxed text-[var(--lp-mute)]">{c.intro}</p>}
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {c.jobs.map((j) => (
                <li key={j} className="flex gap-3 border-b border-[var(--lp-line)] pb-3 text-[0.97rem] leading-snug">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-electric-ink)]" aria-hidden />
                  <span><Highlight text={j} groups={groups} /></span>
                </li>
              ))}
            </ul>
            {c.id === "flotillas" && (
              <a href="#flotillas" onClick={() => ref.current?.close()} className="mt-5 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[var(--lp-electric-ink)] hover:underline">
                Conoce la propuesta para flotillas <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--lp-line)] bg-[var(--lp-paper)] px-6 py-4 sm:flex-row sm:items-center sm:px-8">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa">
                <MessageCircle className="h-4 w-4" aria-hidden /> {c.id === "flotillas" ? "Solicitar información" : "Consultar por WhatsApp"}
              </a>
            )}
            <div className="flex gap-2 sm:ml-auto">
              {prev && <button type="button" onClick={() => onNavigate(prev.id)} className="lp-btn lp-btn-line flex-1 !min-h-[44px] !px-4 text-sm" aria-label={`Categoría anterior: ${prev.name}`}>Anterior</button>}
              {next && <button type="button" onClick={() => onNavigate(next.id)} className="lp-btn lp-btn-line flex-1 !min-h-[44px] !px-4 text-sm" aria-label={`Categoría siguiente: ${next.name}`}>Siguiente</button>}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
