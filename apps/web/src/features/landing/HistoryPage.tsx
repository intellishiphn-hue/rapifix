import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarCheck, ChevronRight, Clock, CreditCard, Droplets, ExternalLink, FileText, MapPin, MessageCircle, Phone, Search, ThumbsUp, Wrench } from "lucide-react";
import {
  formatMoney, formatOdometer, historyBookingUrl, historyLinkAlive, historyVisitPath,
  type HistoryMaintenanceView, type HistoryUpcomingView, type HistoryVehicleView, type HistoryVisitView, type PublicHistory,
} from "@rapifix/shared";
import { cn } from "@/lib/cn";
import "./landing.css";
import { BUSINESS, addressLines, telLink, waLink } from "./business";
import { BrandLogo } from "./Brand";
import { loadPublicHistory, type HistoryLoad } from "./historyData";

/**
 * "Mi historial RAPIFIX" (/historial/:token): link privado y permanente de un cliente o empresa.
 * Solo lee publicHistory/{token} (API REST). Móvil primero: la mayoría lo abre desde WhatsApp.
 */

const TZ = "America/Tegucigalpa";
const fmtDate = new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const fmtShort = new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", timeZone: TZ });
export const date = (ms: number | null | undefined) => (ms ? fmtDate.format(ms).replace(/\./g, "") : "");
const shortDate = (ms: number | null | undefined) => (ms ? fmtShort.format(ms).replace(/\./g, "") : "");
const yearOf = (ms: number | null) => (ms ? Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TZ }).format(ms)) : 0);
export const vehicleName = (v: Pick<HistoryVehicleView, "make" | "model" | "year">) => [v.make, v.model, v.year || ""].filter(Boolean).join(" ");

const URGENCY_LABEL = { overdue: "Vencido", due: "Próximo", upcoming: "Programado" } as const;
const URGENCY_TONE = {
  overdue: "bg-[#fde8e8] text-[#a30000] ring-[#f5b5b5]",
  due: "bg-[#fff4d6] text-[#7a4b00] ring-[#f2d189]",
  upcoming: "bg-[#e7efff] text-[#0b3a9e] ring-[#bcd0fb]",
} as const;
export const VISIT_LABEL = { in_shop: "En el taller", ready: "Listo para retirar", delivered: "Entregado" } as const;

export function useHistoryMeta() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Mi historial | RAPIFIX";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.title = prev;
      meta.remove();
    };
  }, []);
}

export function HistoryPage() {
  const { token = "" } = useParams();
  const [load, setLoad] = useState<HistoryLoad>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useHistoryMeta();

  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ state: "loading" });
    void loadPublicHistory(token, ctl.signal).then((r) => {
      if (!ctl.signal.aborted) setLoad(r);
    });
    return () => ctl.abort();
  }, [token, attempt]);

  return (
    <div className="lp lp-light min-h-screen !bg-[var(--lp-paper)]">
      <a href="#contenido" className="sr-only z-[60] rounded-full bg-white px-4 py-2 font-semibold text-[var(--lp-navy)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Saltar al contenido
      </a>
      <TopBar />
      <main id="contenido">
        {load.state === "loading" && <LoadingView />}
        {load.state === "missing" && <MissingView />}
        {load.state === "error" && <ErrorView onRetry={() => setAttempt((n) => n + 1)} />}
        {load.state === "ready" && <HistoryView data={load.data} />}
      </main>
      <ContactFooter />
    </div>
  );
}

/* ---------------------------------------------------------------- Marco */

export function TopBar() {
  const wa = waLink("Hola RAPIFIX, tengo una consulta sobre mi historial.");
  return (
    <header className="bg-[var(--lp-night)]">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <a href="/inicio" aria-label="RAPIFIX, ir al sitio"><BrandLogo /></a>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost !min-h-[40px] !px-4 !text-sm">
            <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
          </a>
        )}
      </div>
    </header>
  );
}

export function ContactFooter() {
  const wa = waLink("Hola RAPIFIX, tengo una consulta.");
  const tel = telLink();
  return (
    <footer className="mt-16 bg-[var(--lp-night)] text-white">
      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-12 sm:px-8 md:grid-cols-3">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-[22rem] text-sm leading-relaxed text-[var(--lp-mute-dark)]">
            Este enlace es privado. Guárdalo para consultar tu historial cuando quieras y no lo compartas con otras personas.
          </p>
        </div>
        <div className="text-sm text-[var(--lp-mute-dark)]">
          <h2 className="font-semibold text-white">Dónde estamos</h2>
          <p className="mt-3 flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {BUSINESS.mapsUrl ? <a className="hover:text-white" href={BUSINESS.mapsUrl} target="_blank" rel="noopener noreferrer">{addressLines().slice(0, 2).join(", ")}</a> : addressLines().slice(0, 2).join(", ")}
          </p>
          <ul className="mt-3 space-y-1">
            {(BUSINESS.hours ?? []).map((h) => (
              <li key={h.days} className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><span className="text-white/90">{h.days}:</span> {h.hours ?? "Cerrado"}</span></li>
            ))}
          </ul>
        </div>
        <div className="text-sm text-[var(--lp-mute-dark)]">
          <h2 className="font-semibold text-white">Contacto</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa !min-h-[44px] !text-sm"><MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp {BUSINESS.phoneDisplay}</a>}
            {tel && <a href={tel} className="lp-btn lp-btn-ghost !min-h-[44px] !text-sm"><Phone className="h-4 w-4" aria-hidden /> Llamar</a>}
          </div>
        </div>
      </div>
    </footer>
  );
}

export function LoadingView() {
  const bar = "animate-pulse rounded-lg bg-[rgb(1_25_85/0.08)]";
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando tu historial</span>
      <div className="bg-[var(--lp-navy)] px-4 pb-10 pt-8 sm:px-8">
        <div className="mx-auto max-w-[1180px] space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-white/15" />
          <div className="h-10 w-64 max-w-full animate-pulse rounded-lg bg-white/15" />
          <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
        </div>
      </div>
      <div className="mx-auto mt-6 max-w-[1180px] space-y-4 px-4 sm:px-8">
        <div className="flex gap-2"><div className={cn(bar, "h-12 w-32")} /><div className={cn(bar, "h-12 w-32")} /></div>
        <div className={cn(bar, "h-40")} />
        <div className={cn(bar, "h-56")} />
      </div>
    </div>
  );
}

export function MissingView() {
  const wa = waLink("Hola RAPIFIX, mi enlace del historial ya no funciona. ¿Me pueden enviar uno nuevo?");
  return (
    <div className="mx-auto max-w-[560px] px-4 py-20 text-center sm:px-8">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[var(--lp-navy)] shadow-sm"><FileText className="h-7 w-7" aria-hidden /></span>
      <h1 className="lp-display mt-6 text-[1.8rem] leading-tight text-[var(--lp-navy)]">Este enlace ya no está disponible</h1>
      <p className="mt-3 text-[var(--lp-mute)]">Escríbenos por WhatsApp y te enviamos el enlace actualizado de tu historial.</p>
      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-wa mt-8"><MessageCircle className="h-4 w-4" aria-hidden /> Escribir por WhatsApp</a>}
    </div>
  );
}

export function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-20 text-center sm:px-8">
      <h1 className="lp-display text-[1.6rem] text-[var(--lp-navy)]">No pudimos cargar tu historial</h1>
      <p className="mt-3 text-[var(--lp-mute)]">Revisa tu conexión a internet e intenta de nuevo.</p>
      <button type="button" onClick={onRetry} className="lp-btn lp-btn-navy mt-8">Intentar de nuevo</button>
    </div>
  );
}

/* ---------------------------------------------------------------- Vista */

function HistoryView({ data }: { data: PublicHistory }) {
  const isCompany = data.kind === "company";
  const [selected, setSelected] = useState(data.vehicles[0]?.key ?? "");
  const vehicle = data.vehicles.find((v) => v.key === selected) ?? data.vehicles[0] ?? null;
  const detailRef = useRef<HTMLDivElement>(null);
  const choose = (key: string, scroll: boolean) => {
    setSelected(key);
    if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      <Hero data={data} />
      <div className="mx-auto max-w-[1180px] px-4 sm:px-8">
        <CurrentOrders data={data} />
        {isCompany && <FleetUpcoming items={data.summary.upcoming} onPick={(plate) => { const v = data.vehicles.find((x) => x.plate === plate); if (v) choose(v.key, true); }} />}
        {!data.vehicles.length ? (
          <div className="mt-8 rounded-[22px] bg-white p-8 text-center shadow-sm">
            <h2 className="lp-display text-xl text-[var(--lp-navy)]">Aún no hay vehículos en este historial</h2>
            <p className="mt-2 text-[var(--lp-mute)]">Cuando nos visites, aquí verás cada trabajo, sus pagos y los próximos mantenimientos.</p>
            <Link to="/agendar" className="lp-btn lp-btn-red mt-6"><CalendarCheck className="h-4 w-4" aria-hidden /> Agendar cita</Link>
          </div>
        ) : (
          <>
            <VehiclePicker vehicles={data.vehicles} selected={vehicle?.key ?? ""} onSelect={(k) => choose(k, isCompany)} fleet={isCompany} />
            <div ref={detailRef} className="scroll-mt-4">{vehicle && <VehicleDetail key={vehicle.key} v={vehicle} fleet={isCompany} />}</div>
          </>
        )}
        {data.truncated && <p className="mt-6 text-sm text-[var(--lp-mute)]">Se muestran las visitas más recientes. Si necesitas una más antigua, pídela por WhatsApp.</p>}
      </div>
    </>
  );
}

function Hero({ data }: { data: PublicHistory }) {
  const s = data.summary;
  const isCompany = data.kind === "company";
  const first = data.name.split(/\s+/)[0] ?? "";
  const wa = waLink(isCompany ? `Hola RAPIFIX, les escribo de ${data.name} por nuestra flotilla.` : "Hola RAPIFIX, quisiera hacer una consulta sobre mi vehículo.");
  return (
    <section className="lp-hero text-white" aria-labelledby="hist-title">
      <div className="mx-auto max-w-[1180px] px-4 pb-9 pt-8 sm:px-8 sm:pb-12 sm:pt-12">
        <p className="text-[0.95rem] font-semibold text-white/75">{isCompany ? "Historial de la flotilla" : `Hola, ${first}`}</p>
        <h1 id="hist-title" className="lp-display mt-2 text-[clamp(2rem,6vw,3.6rem)] leading-[0.98]">
          {isCompany ? data.name : "Tu historial RAPIFIX"}
        </h1>
        <p className="mt-3 max-w-[40rem] text-white/75">
          {isCompany
            ? "Visitas, trabajos, pagos y próximos mantenimientos de cada unidad."
            : "Lo que le hemos hecho a tus vehículos, lo que has pagado y lo que toca hacer pronto."}
        </p>
        <dl className={cn("mt-7 grid gap-px overflow-hidden rounded-2xl bg-white/10", isCompany ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 sm:max-w-[640px] sm:grid-cols-3")}>
          <Stat label={isCompany ? "Unidades" : "Vehículos"} value={String(s.vehicles)} />
          <Stat label={`Visitas ${s.year}`} value={String(s.visitsYear)} />
          {isCompany && <Stat label={`Gasto ${s.year}`} value={formatMoney(s.spentYear)} />}
          <Stat
            wide={!isCompany}
            label="Saldo pendiente"
            value={formatMoney(s.balance)}
            hint={isCompany ? (s.overdue > 0 ? `${formatMoney(s.overdue)} vencido` : s.termsLabel ?? undefined) : undefined}
            alert={s.overdue > 0}
          />
        </dl>
        {isCompany && s.termsDetail && <p className="mt-3 text-sm text-white/60">Forma de pago: {s.termsLabel}. {s.termsDetail}</p>}
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to={historyBookingUrl()} className="lp-btn lp-btn-red"><CalendarCheck className="h-4 w-4" aria-hidden /> Agendar cita</Link>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-ghost"><MessageCircle className="h-4 w-4" aria-hidden /> Escribir por WhatsApp</a>}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, alert, wide }: { label: string; value: string; hint?: string; alert?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 bg-[rgb(0_10_43/0.55)] px-4 py-3.5", wide && "col-span-2 sm:col-span-1")}>
      <dt className="text-[0.8rem] text-white/65">{label}</dt>
      <dd className="lp-display mt-1 truncate text-[clamp(1.15rem,3.2vw,1.6rem)] tabular-nums">{value}</dd>
      {hint && <dd className={cn("mt-0.5 truncate text-xs", alert ? "font-semibold text-[#ff8a8a]" : "text-white/60")}>{hint}</dd>}
    </div>
  );
}

/* ---------------------------------------------------------------- En el taller ahora */

/** Órdenes abiertas (en el taller o listas para retirar), arriba y destacadas, con lo que el cliente puede hacer. */
function CurrentOrders({ data }: { data: PublicHistory }) {
  const { token = "" } = useParams();
  const now = Date.now();
  const open = data.vehicles.flatMap((v) => v.visits.filter((x) => x.state !== "delivered").map((x) => ({ v, x })));
  if (!open.length) return null;
  return (
    <section aria-labelledby="now-title" className="relative z-10 -mt-5 sm:-mt-7">
      <h2 id="now-title" className="sr-only">En el taller ahora</h2>
      <ul className="space-y-3">
        {open.map(({ v, x }) => {
          const alive = historyLinkAlive(x, now);
          const ready = x.state === "ready";
          const canPay = alive && x.link && x.balance > 0 && x.total > 0 && !x.quoteLink;
          return (
            <li key={x.id || x.code} className="overflow-hidden rounded-[22px] bg-white shadow-[0_18px_40px_-24px_rgb(1_25_85/0.45)] ring-1 ring-[rgb(234_1_1/0.25)]">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:p-5">
                <Plate plate={v.plate} small />
                <div className="min-w-0 flex-1 basis-[12rem]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--lp-red-ink)]">{ready ? "Listo para retirar" : "En el taller ahora"}</p>
                  <p className="lp-display mt-0.5 text-[1.2rem] leading-tight text-[var(--lp-navy)]">{vehicleName(v) || "Vehículo"}</p>
                  <p className="mt-0.5 text-sm text-[var(--lp-mute)]">Orden {x.code}{x.inAt ? `, ingresó el ${date(x.inAt)}` : ""}</p>
                </div>
                {x.total > 0 && (
                  <div className="flex basis-full items-baseline gap-2 sm:block sm:basis-auto sm:shrink-0 sm:text-right">
                    <p className="text-sm text-[var(--lp-mute)] sm:text-xs">{x.balance > 0 ? "Saldo por pagar" : "Total"}</p>
                    <p className={cn("lp-display tabular-nums text-[1.15rem]", x.balance > 0 ? "text-[var(--lp-red-ink)]" : "text-[var(--lp-navy)]")}>{formatMoney(x.balance > 0 ? x.balance : x.total)}</p>
                  </div>
                )}
              </div>
              <div className="px-4 sm:px-5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[var(--lp-ink)]">{x.statusLabel || VISIT_LABEL[x.state]}</span>
                  <span className="tabular-nums text-[var(--lp-mute)]">{x.progress}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--lp-paper)]" role="progressbar" aria-valuenow={x.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la orden">
                  <div className={cn("h-full rounded-full", ready ? "bg-[#1faa53]" : "bg-[var(--lp-electric)]")} style={{ width: `${Math.max(4, x.progress)}%` }} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--lp-line)] bg-[var(--lp-paper)]/60 p-3 sm:flex sm:flex-wrap sm:px-5">
                {x.quoteLink && alive && <a href={x.quoteLink} className="lp-btn lp-btn-red col-span-2 !min-h-[44px] !px-4 !text-sm"><ThumbsUp className="h-4 w-4" aria-hidden /> Aprobar cotización</a>}
                {canPay && <a href={`${x.link}#pago`} className="lp-btn lp-btn-navy col-span-2 !min-h-[44px] !px-4 !text-sm"><CreditCard className="h-4 w-4" aria-hidden /> Pagar</a>}
                {alive && x.link && <a href={x.link} className="lp-btn lp-btn-line !min-h-[44px] !px-4 !text-sm"><ExternalLink className="h-4 w-4" aria-hidden /> Ver cómo va</a>}
                {x.id && <Link to={historyVisitPath(token, x.id)} className="lp-btn lp-btn-line !min-h-[44px] !px-4 !text-sm">Detalle <ChevronRight className="h-4 w-4" aria-hidden /></Link>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- Flotilla */

function FleetUpcoming({ items, onPick }: { items: HistoryUpcomingView[]; onPick: (plate: string) => void }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  return (
    <section aria-labelledby="fleet-up" className="mt-8">
      <h2 id="fleet-up" className="lp-display text-[1.35rem] text-[var(--lp-navy)]">Lo que toca en la flotilla</h2>
      <p className="mt-1 text-sm text-[var(--lp-mute)]">Ordenado del más urgente al menos urgente.</p>
      <ul className="mt-4 divide-y divide-[var(--lp-line)] overflow-hidden rounded-[18px] bg-white shadow-[0_1px_0_rgb(1_25_85/0.06)] ring-1 ring-[var(--lp-line)]">
        {shown.map((m, i) => (
          <li key={`${m.plate}-${m.service}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
            <button type="button" onClick={() => onPick(m.plate)} className="shrink-0" aria-label={`Ver la unidad ${m.plate}`}><Plate plate={m.plate} small /></button>
            <span className="ml-auto sm:order-3 sm:ml-0"><UrgencyChip status={m.status} /></span>
            <div className="min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
              <div className="font-semibold text-[var(--lp-ink)]">{m.service}</div>
              <div className="text-sm text-[var(--lp-mute)] sm:truncate">{m.vehicle}{dueText(m) ? `. ${dueText(m)}` : ""}</div>
            </div>
            <Link to={historyBookingUrl({ service: m.service, plate: m.plate, vehicle: m.vehicle })} className="text-sm font-semibold text-[var(--lp-electric-ink)] underline-offset-4 hover:underline sm:order-4">Agendar cita</Link>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-3 text-sm font-semibold text-[var(--lp-electric-ink)] underline-offset-4 hover:underline" aria-expanded={all}>
          {all ? "Ver menos" : `Ver los ${items.length} mantenimientos`}
        </button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Selección de vehículo */

function VehiclePicker({ vehicles, selected, onSelect, fleet }: { vehicles: HistoryVehicleView[]; selected: string; onSelect: (key: string) => void; fleet: boolean }) {
  const [q, setQ] = useState("");
  const searchable = vehicles.length > 5;
  const list = useMemo(() => {
    const t = q.replace(/[^a-z0-9]/gi, "").toUpperCase();
    return t ? vehicles.filter((v) => v.plate.toUpperCase().includes(t) || `${v.make}${v.model}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(t)) : vehicles;
  }, [q, vehicles]);
  if (vehicles.length === 1 && !fleet) return null;
  return (
    <section aria-labelledby="pick-title" className="mt-8">
      <h2 id="pick-title" className="lp-display text-[1.35rem] text-[var(--lp-navy)]">{fleet ? "Unidades" : "Tus vehículos"}</h2>
      {searchable && (
        <label className="lp-search mt-3 flex min-h-[48px] max-w-[420px] items-center gap-2 rounded-2xl border border-[rgb(1_25_85/0.18)] bg-white px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--lp-mute)]" aria-hidden />
          <span className="sr-only">Buscar por placa</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por placa" className="min-w-0 flex-1 bg-transparent text-base outline-none" inputMode="search" autoComplete="off" />
        </label>
      )}
      <div role="group" aria-label="Elegir vehículo" className={cn("mt-4", fleet ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap gap-2")}>
        {list.map((v) => {
          const on = v.key === selected;
          const next = v.maintenance[0];
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(v.key)}
              className={cn(
                "flex min-w-0 shrink-0 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                on ? "border-[var(--lp-navy)] bg-[var(--lp-navy)] text-white" : "border-[var(--lp-line)] bg-white text-[var(--lp-ink)] hover:border-[rgb(1_25_85/0.35)]",
              )}
            >
              <Plate plate={v.plate} small />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{vehicleName(v) || "Vehículo"}</span>
                {fleet && (
                  <span className={cn("block truncate text-xs", on ? "text-white/70" : "text-[var(--lp-mute)]")}>
                    {next ? `${URGENCY_LABEL[next.status]}: ${next.service}` : v.visits[0] ? `Última visita ${shortDate(v.visits[0].inAt)}` : "Sin visitas"}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {!list.length && <p className="text-sm text-[var(--lp-mute)]">Ninguna unidad tiene esa placa.</p>}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Detalle del vehículo */

function VehicleDetail({ v, fleet }: { v: HistoryVehicleView; fleet: boolean }) {
  const now = Date.now();
  return (
    <section aria-labelledby={`veh-${v.key}`} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-6 lg:sticky lg:top-4">
        <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-[var(--lp-line)]">
          <div className="flex items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <h2 id={`veh-${v.key}`} className="lp-display text-[1.45rem] leading-tight text-[var(--lp-navy)]">{vehicleName(v) || "Vehículo"}</h2>
              {v.color && <p className="mt-1 text-sm text-[var(--lp-mute)]">{v.color}</p>}
            </div>
            <Plate plate={v.plate} />
          </div>
          <Odometer v={v} />
          {fleet && (v.spentYear > 0 || v.balance > 0) && (
            <dl className="grid grid-cols-2 border-t border-[var(--lp-line)] text-sm">
              <div className="px-5 py-3"><dt className="text-[var(--lp-mute)]">Gasto este año</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatMoney(v.spentYear)}</dd></div>
              <div className="border-l border-[var(--lp-line)] px-5 py-3"><dt className="text-[var(--lp-mute)]">Saldo</dt><dd className={cn("mt-0.5 font-semibold tabular-nums", v.balance > 0 && "text-[var(--lp-red-ink)]")}>{formatMoney(v.balance)}</dd></div>
            </dl>
          )}
        </div>
        <MaintenanceList v={v} />
        <Carwash v={v} now={now} />
      </div>
      <div className="min-w-0 space-y-6">
        {v.quotes.length > 0 && (
          <div className="rounded-[22px] bg-[#fff8e6] p-5 ring-1 ring-[#f2d189]">
            <h3 className="font-semibold text-[#5c3a00]">{v.quotes.length === 1 ? "Tienes una cotización por aprobar" : `Tienes ${v.quotes.length} cotizaciones por aprobar`}</h3>
            <ul className="mt-3 space-y-2">
              {v.quotes.map((q) => (
                <li key={q.code} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{q.code}</div>
                    <div className="text-sm text-[var(--lp-mute)]">{q.items === 1 ? "1 trabajo" : `${q.items} trabajos`}{q.sentAt ? `, enviada el ${date(q.sentAt)}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="lp-display tabular-nums">{formatMoney(q.total)}</span>
                    <a href={q.link} className="lp-btn lp-btn-navy !min-h-[42px] !text-sm">Revisar y aprobar</a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Visits v={v} now={now} />
      </div>
    </section>
  );
}

export function Plate({ plate, small }: { plate: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 flex-col items-center rounded-[8px] border-2 border-[var(--lp-navy)] bg-white leading-none text-[var(--lp-navy)] shadow-[inset_0_0_0_2px_#fff]",
        small ? "min-w-[78px] px-2 pb-1 pt-0.5" : "min-w-[112px] px-3 pb-1.5 pt-1",
      )}
      aria-label={`Placa ${plate}`}
    >
      <span className={cn("font-semibold tracking-wide text-[var(--lp-electric-ink)]", small ? "text-[7px]" : "text-[9px]")} aria-hidden>HONDURAS</span>
      <span className={cn("lp-display tabular-nums", small ? "mt-0.5 text-[15px]" : "mt-1 text-[22px]")} aria-hidden>{plate}</span>
    </span>
  );
}

function Odometer({ v }: { v: HistoryVehicleView }) {
  if (!v.mileage) return null;
  const digits = String(Math.round(v.mileage)).padStart(6, "0");
  return (
    <div className="border-t border-[var(--lp-line)] bg-[var(--lp-night)] px-5 py-4 text-white">
      <p className="text-[0.8rem] text-white/60">{v.unit === "mi" ? "Último millaje registrado" : "Último kilometraje registrado"}</p>
      <div className="mt-2 flex items-end gap-2" aria-label={formatOdometer(v.mileage, v.unit)} role="img">
        <span className="flex gap-[3px]" aria-hidden>
          {digits.split("").map((d, i) => (
            <span key={i} className="lp-display flex h-9 w-[26px] items-center justify-center rounded-[5px] bg-[linear-gradient(#1b2a55,#0a1638_50%,#1b2a55)] text-[1.2rem] tabular-nums text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]">{d}</span>
          ))}
        </span>
        <span className="pb-1 text-sm font-semibold text-white/80" aria-hidden>{v.unit}</span>
      </div>
      {v.mileageAt && <p className="mt-2 text-xs text-white/55">Registrado el {date(v.mileageAt)}</p>}
    </div>
  );
}

function UrgencyChip({ status }: { status: HistoryMaintenanceView["status"] }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1", URGENCY_TONE[status])}>{URGENCY_LABEL[status]}</span>;
}

function dueText(m: HistoryMaintenanceView): string {
  const parts: string[] = [];
  if (m.dueAt) parts.push(m.status === "overdue" ? `Tocaba el ${date(m.dueAt)}` : `Toca cerca del ${date(m.dueAt)}`);
  if (m.nextMileage) parts.push(`${parts.length ? "o a los" : "A los"} ${formatOdometer(m.nextMileage, m.unit)}`);
  return parts.join(" ");
}

function MaintenanceList({ v }: { v: HistoryVehicleView }) {
  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-[var(--lp-line)]">
      <h3 className="flex items-center gap-2 font-semibold text-[var(--lp-navy)]"><Wrench className="h-4 w-4" aria-hidden /> Próximos mantenimientos</h3>
      {!v.maintenance.length ? (
        <p className="mt-2 text-sm text-[var(--lp-mute)]">No hay mantenimientos programados por ahora. Te avisaremos cuando toque el siguiente.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {v.maintenance.map((m, i) => (
            <li key={`${m.service}-${i}`} className="rounded-2xl bg-[var(--lp-paper)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-[var(--lp-ink)]">{m.service}</span>
                <UrgencyChip status={m.status} />
              </div>
              {dueText(m) && <p className="mt-1 text-sm text-[var(--lp-mute)]">{dueText(m)}</p>}
              <Link
                to={historyBookingUrl({ service: m.service, plate: v.plate, vehicle: vehicleName(v) })}
                className={cn("lp-btn mt-3 !min-h-[40px] !px-4 !text-sm", m.status === "upcoming" ? "lp-btn-line" : "lp-btn-red")}
              >
                <CalendarCheck className="h-4 w-4" aria-hidden /> Agendar cita
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Visitas */

function Visits({ v, now }: { v: HistoryVehicleView; now: number }) {
  const [limit, setLimit] = useState(6);
  const shown = v.visits.slice(0, limit);
  const groups: Array<{ year: number; visits: HistoryVisitView[] }> = [];
  for (const x of shown) {
    const y = yearOf(x.inAt);
    const g = groups[groups.length - 1];
    if (g && g.year === y) g.visits.push(x);
    else groups.push({ year: y, visits: [x] });
  }
  const byYear = groups.length > 1;
  return (
    <div>
      <h3 className="lp-display text-[1.35rem] text-[var(--lp-navy)]">Historial de visitas</h3>
      {!v.visits.length ? (
        <p className="mt-2 rounded-[22px] bg-white p-5 text-[var(--lp-mute)] ring-1 ring-[var(--lp-line)]">Todavía no hay visitas al taller con este vehículo.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map((g) => (
            <div key={g.year}>
              {byYear && <h4 className="lp-display mb-3 text-lg text-[var(--lp-mute)]">{g.year || "Sin fecha"}</h4>}
              <ol className="relative space-y-4 border-l-2 border-[rgb(1_25_85/0.12)] pl-5 sm:pl-6">
                {g.visits.map((x) => <VisitCard key={x.code} x={x} now={now} />)}
              </ol>
            </div>
          ))}
          {v.visits.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + 10)} className="lp-btn lp-btn-line !min-h-[44px] !text-sm">Ver visitas anteriores</button>
          )}
          {v.visitsTotal > v.visits.length && v.visits.length <= limit && (
            <p className="text-sm text-[var(--lp-mute)]">Se muestran las {v.visits.length} visitas más recientes de {v.visitsTotal}.</p>
          )}
        </div>
      )}
    </div>
  );
}

function VisitCard({ x, now }: { x: HistoryVisitView; now: number }) {
  const { token = "" } = useParams();
  const open = x.state !== "delivered";
  const alive = historyLinkAlive(x, now);
  const lines = x.work.length + x.parts.length;
  return (
    <li className="relative">
      <span
        className={cn("absolute -left-[29px] top-5 h-3.5 w-3.5 rounded-full border-[3px] border-[var(--lp-paper)] sm:-left-[33px]", open ? "bg-[var(--lp-red)]" : "bg-[var(--lp-navy)]")}
        aria-hidden
      />
      <article className={cn("rounded-[22px] bg-white ring-1", open ? "ring-[rgb(234_1_1/0.35)]" : "ring-[var(--lp-line)]")}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--lp-ink)]">
              {date(x.inAt) || "Sin fecha"}
              {x.outAt && x.outAt - (x.inAt ?? 0) > 86_400_000 ? <span className="font-normal text-[var(--lp-mute)]"> al {date(x.outAt)}</span> : null}
            </p>
            <p className="text-sm text-[var(--lp-mute)]">
              Orden {x.code}
              {(x.mileageIn ?? x.mileageOut) ? `, ${formatOdometer(x.mileageIn ?? x.mileageOut, x.unit)}` : ""}
            </p>
          </div>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", open ? "bg-[#fde8e8] text-[#a30000]" : "bg-[#e7f6ec] text-[#13652f]")}>{VISIT_LABEL[x.state]}</span>
        </header>
        <div className="px-5 py-3">
          {!lines ? (
            <p className="text-sm text-[var(--lp-mute)]">{open ? "Estamos revisando tu vehículo. Te enviaremos la cotización para aprobar." : "Sin detalle de trabajos."}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {x.work.length > 0 && <LineList title="Trabajos realizados" lines={x.work} />}
              {x.parts.length > 0 && <LineList title="Repuestos cambiados" lines={x.parts} qty />}
            </div>
          )}
        </div>
        {x.total > 0 && (
          <footer className="border-t border-[var(--lp-line)] px-5 py-3.5">
            {x.total > 0 && <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div><dt className="inline text-[var(--lp-mute)]">Total </dt><dd className="inline font-semibold tabular-nums">{formatMoney(x.total)}</dd></div>
              <div><dt className="inline text-[var(--lp-mute)]">Pagado </dt><dd className="inline font-semibold tabular-nums">{formatMoney(x.paid)}</dd></div>
              {x.balance > 0 && <div><dt className="inline text-[var(--lp-mute)]">Saldo </dt><dd className="inline font-semibold tabular-nums text-[var(--lp-red-ink)]">{formatMoney(x.balance)}</dd></div>}
            </dl>}
            {x.payments.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-[var(--lp-mute)]">
                {x.payments.map((p) => <li key={p.code}>Recibo {p.code}: {formatMoney(p.amount)} en {p.method.toLowerCase()}{p.at ? `, ${date(p.at)}` : ""}</li>)}
              </ul>
            )}
          </footer>
        )}
        {!x.id && alive && x.link && (
          <a href={x.link} className="flex min-h-[48px] items-center gap-1.5 border-t border-[var(--lp-line)] px-5 py-3 text-sm font-semibold text-[var(--lp-electric-ink)]">
            <ExternalLink className="h-4 w-4" aria-hidden /> {open ? "Ver cómo va la orden" : "Ver orden y recibo"}
          </a>
        )}
        {x.id && (
          <Link
            to={historyVisitPath(token, x.id)}
            className="flex min-h-[48px] items-center justify-between gap-3 rounded-b-[22px] border-t border-[var(--lp-line)] px-5 py-3 text-sm font-semibold text-[var(--lp-electric-ink)] hover:bg-[var(--lp-paper)]"
          >
            <span>{open ? "Ver detalle y cómo va" : "Ver detalle, fotos y recibos"}</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        )}
      </article>
    </li>
  );
}

function LineList({ title, lines, qty }: { title: string; lines: Array<{ d: string; q: number }>; qty?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 6);
  return (
    <div className="min-w-0">
      <h5 className="text-xs font-semibold text-[var(--lp-mute)]">{title}</h5>
      <ul className="mt-1.5 space-y-1 text-[0.93rem] text-[var(--lp-ink)]">
        {shown.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lp-electric)]" aria-hidden />
            <span className="min-w-0 break-words">{l.d}{qty && l.q !== 1 ? <span className="text-[var(--lp-mute)]"> (x{l.q})</span> : null}</span>
          </li>
        ))}
      </ul>
      {lines.length > 6 && (
        <button type="button" onClick={() => setAll((x) => !x)} aria-expanded={all} className="mt-1 text-xs font-semibold text-[var(--lp-electric-ink)] underline-offset-4 hover:underline">
          {all ? "Ver menos" : `Ver ${lines.length - 6} más`}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Carwash */

function Carwash({ v, now }: { v: HistoryVehicleView; now: number }) {
  if (!v.washes.length && !v.loyalty && !v.membership) return null;
  const membershipActive = v.membership && v.membership.paidUntil > now ? v.membership : null;
  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-[var(--lp-line)]">
      <h3 className="flex items-center gap-2 font-semibold text-[var(--lp-navy)]"><Droplets className="h-4 w-4" aria-hidden /> Carwash</h3>
      {v.loyalty && v.loyalty.every > 0 && (
        <div className="mt-3 rounded-2xl bg-[var(--lp-navy)] p-4 text-white">
          <p className="text-sm text-white/75">Tarjeta de sellos</p>
          <div className="mt-2 flex flex-wrap gap-1" role="img" aria-label={`${v.loyalty.count} de ${v.loyalty.every} sellos`}>
            {Array.from({ length: v.loyalty.every }, (_, i) => (
              <span key={i} className={cn("h-[22px] w-[22px] rounded-full border-2", i < v.loyalty!.count ? "border-[var(--lp-electric)] bg-[var(--lp-electric)]" : "border-white/30")} aria-hidden />
            ))}
          </div>
          <p className="mt-2 text-sm font-semibold">
            {v.loyalty.rewardsAvailable > 0
              ? v.loyalty.rewardsAvailable === 1 ? "Tienes 1 lavado gratis disponible." : `Tienes ${v.loyalty.rewardsAvailable} lavados gratis disponibles.`
              : v.loyalty.every - v.loyalty.count === 1 ? "Tu próximo lavado es gratis." : `Te faltan ${v.loyalty.every - v.loyalty.count} lavados para uno gratis.`}
          </p>
        </div>
      )}
      {membershipActive && (
        <p className="mt-3 rounded-2xl bg-[var(--lp-paper)] p-3.5 text-sm">
          <span className="font-semibold">Membresía {membershipActive.planName}</span>
          <span className="block text-[var(--lp-mute)]">
            {membershipActive.washesPerMonth === null ? "Lavados ilimitados" : `Te quedan ${Math.max(0, membershipActive.washesPerMonth - membershipActive.usedInPeriod)} de ${membershipActive.washesPerMonth} lavados este mes`}. Vigente hasta el {date(membershipActive.paidUntil)}.
          </span>
        </p>
      )}
      {v.washes.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--lp-line)]">
          {v.washes.slice(0, 8).map((w) => (
            <li key={w.code} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{date(w.at)}</div>
                <div className="truncate text-[var(--lp-mute)]">{w.services.join(", ") || "Lavado"}</div>
                {historyLinkAlive(w, now) && w.link && <a href={w.link} className="text-xs font-semibold text-[var(--lp-electric-ink)] underline-offset-4 hover:underline">Ver lavado</a>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">{w.total > 0 ? formatMoney(w.total) : "Sin costo"}</div>
                <div className={cn("text-xs", w.paid ? "text-[#13652f]" : "text-[var(--lp-red-ink)]")}>{w.paid ? "Pagado" : "Pendiente"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link to={historyBookingUrl({ reason: "carwash", plate: v.plate, vehicle: vehicleName(v) })} className="lp-btn lp-btn-line mt-3 !min-h-[40px] !px-4 !text-sm">
        <CalendarCheck className="h-4 w-4" aria-hidden /> Agendar lavado
      </Link>
    </div>
  );
}
