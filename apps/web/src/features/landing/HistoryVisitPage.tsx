import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle2, ClipboardList, CreditCard, ExternalLink, Hourglass, Printer, ReceiptText, ShieldCheck, Stethoscope, ThumbsUp, Wrench } from "lucide-react";
import {
  formatMoney, formatOdometer, historyLinkAlive, historyPath, historyReceiptPath, historyVisitPath, visitReceipt,
  type HistoryVehicleView, type HistoryVisitView, type PublicHistory, type PublicVisitDetail,
} from "@rapifix/shared";
import { cn } from "@/lib/cn";
import "./landing.css";
import { BUSINESS, addressLines } from "./business";
import { BrandLogo } from "./Brand";
import { ContactFooter, date, ErrorView, LoadingView, MissingView, Plate, TopBar, useHistoryMeta, vehicleName, VISIT_LABEL } from "./HistoryPage";
import { loadPublicHistory, loadVisitDetail, type HistoryLoad, type VisitLoad } from "./historyData";

/**
 * Detalle de una visita (/historial/:token/visita/:orderId) y su recibo imprimible
 * (/historial/:token/visita/:orderId/recibo/:receipt). Lee el historial (para saber que el link sigue activo)
 * y el detalle publicHistory/{token}/visits/{orderId}, ambos por REST.
 */

const TZ = "America/Tegucigalpa";
const fmtDateTime = new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dateTime = (ms: number | null | undefined) => (ms ? fmtDateTime.format(ms).replace(/\./g, "") : "");
const STAGE_LABELS: Record<string, string> = {
  reception: "Recepción", damage: "Daños que ya tenía", diagnosis: "Diagnóstico", before: "Antes", during: "Durante la reparación", after: "Terminado",
};

type Found = { history: PublicHistory; vehicle: HistoryVehicleView | null; visit: HistoryVisitView | null; detail: PublicVisitDetail | null };
type Load = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ready"; data: Found };

function useVisit(token: string, orderId: string): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setLoad({ state: "loading" });
    void Promise.all([loadPublicHistory(token, ctl.signal), loadVisitDetail(token, orderId, ctl.signal)]).then(([h, d]: [HistoryLoad, VisitLoad]) => {
      if (ctl.signal.aborted) return;
      if (h.state === "missing") {
        setLoad({ state: "missing" });
        return;
      }
      if (h.state !== "ready" || d.state === "error") {
        setLoad({ state: h.state === "loading" ? "loading" : "error" });
        return;
      }
      const vehicle = h.data.vehicles.find((v) => v.visits.some((x) => x.id === orderId)) ?? null;
      const visit = vehicle?.visits.find((x) => x.id === orderId) ?? null;
      const detail = d.state === "ready" ? d.data : null;
      setLoad(!visit && !detail ? { state: "missing" } : { state: "ready", data: { history: h.data, vehicle, visit, detail } });
    });
    return () => ctl.abort();
  }, [token, orderId, attempt]);
  return [load, () => setAttempt((n) => n + 1)];
}

export function HistoryVisitPage() {
  const { token = "", orderId = "" } = useParams();
  const [load, retry] = useVisit(token, orderId);
  useHistoryMeta();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [orderId]);
  return (
    <div className="lp lp-light min-h-screen !bg-[var(--lp-paper)]">
      <TopBar />
      <main id="contenido">
        {load.state === "loading" && <LoadingView />}
        {load.state === "missing" && <MissingView />}
        {load.state === "error" && <ErrorView onRetry={retry} />}
        {load.state === "ready" && <VisitView token={token} found={load.data} />}
      </main>
      <ContactFooter />
    </div>
  );
}

/* ---------------------------------------------------------------- Detalle */

function VisitView({ token, found }: { token: string; found: Found }) {
  const { detail, visit, vehicle } = found;
  const now = Date.now();
  const d = detail;
  const code = d?.code ?? visit?.code ?? "";
  const state = d?.state ?? visit?.state ?? "delivered";
  const open = state !== "delivered";
  const v = d ? d.vehicle : vehicle ? { plate: vehicle.plate, make: vehicle.make, model: vehicle.model, year: vehicle.year, color: vehicle.color } : null;
  const link = d?.link ?? visit?.link ?? null;
  const alive = historyLinkAlive({ link, linkUntil: d?.linkUntil ?? visit?.linkUntil ?? null }, now);
  const quoteLink = alive ? visit?.quoteLink ?? null : null;
  const total = d?.total ?? visit?.total ?? 0;
  const balance = d?.balance ?? visit?.balance ?? 0;
  const statusLabel = d?.statusLabel || visit?.statusLabel || VISIT_LABEL[state];
  const progress = d?.progress ?? visit?.progress ?? 0;
  const inAt = d?.inAt ?? visit?.inAt ?? null;
  const outAt = d?.outAt ?? visit?.outAt ?? null;
  const unit = d?.unit ?? visit?.unit ?? "km";
  const mileageIn = d?.mileageIn ?? visit?.mileageIn ?? null;
  const mileageOut = d?.mileageOut ?? visit?.mileageOut ?? null;

  return (
    <>
      <section className="lp-hero text-white" aria-labelledby="visit-title">
        <div className="mx-auto max-w-[1180px] px-4 pb-9 pt-5 sm:px-8 sm:pb-12 sm:pt-8">
          <Link to={historyPath(token)} className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-white/80 hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver a mi historial
          </Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[0.95rem] font-semibold text-white/75">Orden {code}</p>
              <h1 id="visit-title" className="lp-display mt-1 text-[clamp(1.8rem,5.5vw,3.2rem)] leading-[1]">{v ? vehicleName(v) || "Vehículo" : "Visita"}</h1>
              <p className="mt-2 text-white/75">
                {date(inAt) ? `Ingresó el ${date(inAt)}` : ""}
                {outAt ? `, entregado el ${date(outAt)}` : ""}
              </p>
            </div>
            {v?.plate && <Plate plate={v.plate} />}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Chip tone={open ? (state === "ready" ? "green" : "red") : "navy"}>{open ? statusLabel : "Entregado"}</Chip>
            {d?.typeLabel && <Chip tone="navy">{d.typeLabel}</Chip>}
            {d?.warranty && <Chip tone="green"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Trabajo de garantía</Chip>}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1180px] px-4 sm:px-8">
        {open && (
          <section className="relative z-10 -mt-5 rounded-[22px] bg-white p-4 shadow-[0_18px_40px_-24px_rgb(1_25_85/0.45)] ring-1 ring-[rgb(234_1_1/0.25)] sm:-mt-7 sm:p-5" aria-label="Cómo va la orden">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-[var(--lp-ink)]">{statusLabel}</span>
              <span className="tabular-nums text-[var(--lp-mute)]">{progress}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--lp-paper)]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la orden">
              <div className={cn("h-full rounded-full", state === "ready" ? "bg-[#1faa53]" : "bg-[var(--lp-electric)]")} style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            {alive && link && (
              <div className="mt-4 flex flex-wrap gap-2">
                {quoteLink && <a href={quoteLink} className="lp-btn lp-btn-red !min-h-[44px] !px-4 !text-sm"><ThumbsUp className="h-4 w-4" aria-hidden /> Aprobar cotización</a>}
                {!quoteLink && balance > 0 && total > 0 && <a href={`${link}#pago`} className="lp-btn lp-btn-navy !min-h-[44px] !px-4 !text-sm"><CreditCard className="h-4 w-4" aria-hidden /> Pagar {formatMoney(balance)}</a>}
                <a href={link} className="lp-btn lp-btn-line !min-h-[44px] !px-4 !text-sm"><ExternalLink className="h-4 w-4" aria-hidden /> Ver cómo va</a>
              </div>
            )}
          </section>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
          <div className="min-w-0 space-y-6">
            <Card title="Datos de la visita" icon={<ClipboardList className="h-4 w-4" aria-hidden />}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <Fact label="Ingreso" value={date(inAt) || "Sin fecha"} />
                <Fact label="Entrega" value={outAt ? date(outAt) : open ? "Aún en el taller" : "Sin fecha"} />
                <Fact label={unit === "mi" ? "Millaje al ingresar" : "Kilometraje al ingresar"} value={mileageIn ? formatOdometer(mileageIn, unit) : "No registrado"} />
                <Fact label={unit === "mi" ? "Millaje al entregar" : "Kilometraje al entregar"} value={mileageOut ? formatOdometer(mileageOut, unit) : open ? "Al entregar" : "No registrado"} />
              </dl>
              {v && <p className="mt-4 border-t border-[var(--lp-line)] pt-3 text-sm text-[var(--lp-mute)]">{[vehicleName(v), v.color, v.plate && `placa ${v.plate}`].filter(Boolean).join(", ")}</p>}
            </Card>

            {d && (d.reported || d.diagnosis) && (
              <Card title="Lo que revisamos" icon={<Stethoscope className="h-4 w-4" aria-hidden />}>
                <div className="space-y-4 text-[0.95rem]">
                  {d.reported && <Block label="Lo que nos contaste">{d.reported}</Block>}
                  {d.diagnosis?.summary && <Block label="Diagnóstico del técnico">{d.diagnosis.summary}</Block>}
                  {!!d.diagnosis?.obdCodes.length && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--lp-mute)]">Códigos de la computadora del vehículo (OBD)</p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">{d.diagnosis.obdCodes.map((c) => <li key={c} className="rounded-lg bg-[var(--lp-paper)] px-2 py-1 font-mono text-sm font-semibold text-[var(--lp-navy)]">{c}</li>)}</ul>
                    </div>
                  )}
                  {d.diagnosis?.recommendations && <Block label="Recomendaciones" tone="tip">{d.diagnosis.recommendations}</Block>}
                  {!d.diagnosis && open && <p className="text-sm text-[var(--lp-mute)]">El diagnóstico aparecerá aquí cuando el técnico lo termine.</p>}
                </div>
              </Card>
            )}

            {d ? <QuoteCard d={d} open={open} /> : visit && <SummaryLines visit={visit} />}
            {d && d.photos.length > 0 && <Photos photos={d.photos} />}
            {d && d.timeline.length > 0 && <Timeline items={d.timeline} />}
            {!d && <p className="rounded-[22px] bg-white p-5 text-sm text-[var(--lp-mute)] ring-1 ring-[var(--lp-line)]">El detalle completo de esta visita (diagnóstico, fotos y recibos) estará disponible en unos minutos.</p>}
          </div>

          <aside className="min-w-0 space-y-6 lg:sticky lg:top-4">
            <Payments token={token} d={d} visit={visit} />
            {alive && link && !open && (
              <a href={link} className="flex min-h-[48px] items-center gap-2 rounded-[22px] bg-white px-5 py-3 text-sm font-semibold text-[var(--lp-electric-ink)] ring-1 ring-[var(--lp-line)]">
                <ExternalLink className="h-4 w-4" aria-hidden /> Ver la orden en su página
              </a>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function Chip({ tone, children }: { tone: "red" | "green" | "navy"; children: React.ReactNode }) {
  const cls = { red: "bg-[#ea0101] text-white", green: "bg-[#1faa53] text-white", navy: "bg-white/12 text-white ring-1 ring-white/25" }[tone];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", cls)}>{children}</span>;
}

function Card({ title, icon, children, className }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[22px] bg-white p-5 ring-1 ring-[var(--lp-line)]", className)}>
      <h2 className="flex items-center gap-2 font-semibold text-[var(--lp-navy)]">{icon} {title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--lp-mute)]">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-[var(--lp-ink)]">{value}</dd>
    </div>
  );
}

function Block({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "tip" }) {
  return (
    <div className={cn(tone === "tip" && "rounded-2xl bg-[#fff8e6] p-3.5 ring-1 ring-[#f2d189]")}>
      <p className={cn("text-xs font-semibold", tone === "tip" ? "text-[#7a4b00]" : "text-[var(--lp-mute)]")}>{label}</p>
      <p className="mt-1 whitespace-pre-line break-words text-[var(--lp-ink)]">{children}</p>
    </div>
  );
}

function QuoteCard({ d, open }: { d: PublicVisitDetail; open: boolean }) {
  const q = d.quote;
  if (!q || !q.lines.length) {
    return (
      <Card title="Trabajos y repuestos" icon={<Wrench className="h-4 w-4" aria-hidden />}>
        <p className="text-sm text-[var(--lp-mute)]">{open ? "Aquí verás los trabajos y repuestos cuando apruebes la cotización." : "Esta visita no tiene trabajos registrados."}</p>
      </Card>
    );
  }
  return (
    <Card title="Trabajos y repuestos" icon={<Wrench className="h-4 w-4" aria-hidden />}>
      <p className="-mt-1 text-sm text-[var(--lp-mute)]">Según la cotización aprobada {q.code}.</p>
      {/* Móvil: lista. Escritorio: tabla */}
      <ul className="mt-3 divide-y divide-[var(--lp-line)] sm:hidden">
        {q.lines.map((l, i) => (
          <li key={i} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words font-medium text-[var(--lp-ink)]">{l.d}</span>
              <span className="shrink-0 font-semibold tabular-nums">{formatMoney(l.total)}</span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--lp-mute)]">
              {l.kind}. {l.q} x {formatMoney(l.unitPrice)}{l.discount > 0 ? `, descuento ${formatMoney(l.discount)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--lp-line)] text-left text-xs text-[var(--lp-mute)]">
              <th className="py-2 pr-3 font-semibold">Descripción</th>
              <th className="py-2 pr-3 font-semibold">Tipo</th>
              <th className="py-2 pr-3 text-right font-semibold">Cant.</th>
              <th className="py-2 pr-3 text-right font-semibold">Precio</th>
              <th className="py-2 pr-3 text-right font-semibold">Desc.</th>
              <th className="py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={i} className="border-b border-[var(--lp-line)] last:border-0">
                <td className="py-2.5 pr-3 font-medium text-[var(--lp-ink)]">{l.d}</td>
                <td className="py-2.5 pr-3 text-[var(--lp-mute)]">{l.kind}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{l.q}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{formatMoney(l.unitPrice)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--lp-mute)]">{l.discount ? formatMoney(l.discount) : ""}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <QuoteTotals q={q} />
    </Card>
  );
}

function QuoteTotals({ q, className }: { q: NonNullable<PublicVisitDetail["quote"]>; className?: string }) {
  return (
    <dl className={cn("ml-auto mt-3 max-w-[320px] space-y-1 border-t border-[var(--lp-line)] pt-3 text-sm", className)}>
      <Row label="Subtotal" value={formatMoney(q.subtotal)} />
      {q.discount > 0 && <Row label="Descuento" value={`- ${formatMoney(q.discount)}`} />}
      {q.coupon && <Row label={`Cupón ${q.coupon.code}`} value={`- ${formatMoney(q.coupon.amount)}`} />}
      <Row label={`ISV (${q.taxRate}%)`} value={formatMoney(q.tax)} />
      <Row label="Total" value={formatMoney(q.total)} strong />
    </dl>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "red" | "green" }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "border-t border-[var(--lp-line)] pt-1.5 text-base font-bold")}>
      <dt className={cn(!strong && "text-[var(--lp-mute)]")}>{label}</dt>
      <dd className={cn("tabular-nums", tone === "red" && "font-semibold text-[var(--lp-red-ink)]", tone === "green" && "font-semibold text-[#13652f]")}>{value}</dd>
    </div>
  );
}

/** Sin detalle todavía: lo que ya trae el historial (descripción y cantidad). */
function SummaryLines({ visit }: { visit: HistoryVisitView }) {
  const lines = [...visit.work.map((l) => ({ ...l, part: false })), ...visit.parts.map((l) => ({ ...l, part: true }))];
  return (
    <Card title="Trabajos y repuestos" icon={<Wrench className="h-4 w-4" aria-hidden />}>
      {!lines.length ? (
        <p className="text-sm text-[var(--lp-mute)]">Sin detalle de trabajos.</p>
      ) : (
        <ul className="space-y-1.5 text-[0.95rem]">
          {lines.map((l, i) => <li key={i}>{l.d}{l.part && l.q !== 1 ? <span className="text-[var(--lp-mute)]"> (x{l.q})</span> : null}</li>)}
        </ul>
      )}
    </Card>
  );
}

function Photos({ photos }: { photos: PublicVisitDetail["photos"] }) {
  return (
    <Card title={`Fotos (${photos.length})`} icon={<Camera className="h-4 w-4" aria-hidden />}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {photos.map((p, i) => (
          <li key={i}>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl bg-[var(--lp-paper)]">
              <img src={p.url} alt={p.caption || STAGE_LABELS[p.stage] || "Foto de la visita"} loading="lazy" decoding="async" className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            </a>
            <p className="mt-1 truncate text-xs text-[var(--lp-mute)]">{p.caption || STAGE_LABELS[p.stage] || ""}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Timeline({ items }: { items: PublicVisitDetail["timeline"] }) {
  return (
    <Card title="Cómo fue la visita">
      <ol className="relative ml-1.5 space-y-4 border-l-2 border-[rgb(1_25_85/0.12)] pl-5">
        {items.map((e, i) => (
          <li key={i} className="relative">
            <span className={cn("absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white", i === items.length - 1 ? "bg-[var(--lp-red)]" : "bg-[var(--lp-navy)]")} aria-hidden />
            <p className="text-xs text-[var(--lp-mute)]">{dateTime(e.at)}</p>
            <p className="mt-0.5 break-words text-[0.95rem] text-[var(--lp-ink)]">{e.text}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Payments({ token, d, visit }: { token: string; d: PublicVisitDetail | null; visit: HistoryVisitView | null }) {
  const total = d?.total ?? visit?.total ?? 0;
  const paid = d?.paid ?? visit?.paid ?? 0;
  const balance = d?.balance ?? visit?.balance ?? 0;
  const payments = d?.payments ?? visit?.payments ?? [];
  const pending = d?.pending ?? [];
  const orderId = d?.id ?? visit?.id ?? "";
  return (
    <Card title="Pagos" icon={<ReceiptText className="h-4 w-4" aria-hidden />}>
      <dl className="space-y-1 text-sm">
        <Row label="Total de la orden" value={formatMoney(total)} />
        <Row label="Pagado" value={formatMoney(paid)} tone={paid > 0 ? "green" : undefined} />
        <Row label="Saldo" value={formatMoney(balance)} strong tone={balance > 0 ? "red" : undefined} />
      </dl>
      {!payments.length && !pending.length ? (
        <p className="mt-4 text-sm text-[var(--lp-mute)]">Todavía no hay pagos registrados en esta orden.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {payments.map((p) => (
            <li key={p.code} className="rounded-2xl bg-[var(--lp-paper)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-[var(--lp-ink)]"><CheckCircle2 className="h-4 w-4 shrink-0 text-[#13652f]" aria-hidden /> {p.method}</p>
                  <p className="mt-0.5 text-xs text-[var(--lp-mute)]">Recibo {p.code}{p.at ? `, ${date(p.at)}` : ""}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{formatMoney(p.amount)}</span>
              </div>
              {d && p.code && (
                <Link to={historyReceiptPath(token, orderId, p.code)} className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-[var(--lp-electric-ink)] underline-offset-4 hover:underline">
                  <ReceiptText className="h-4 w-4" aria-hidden /> Ver recibo
                </Link>
              )}
            </li>
          ))}
          {pending.map((p, i) => (
            <li key={`pend-${i}`} className="rounded-2xl bg-[#fff8e6] p-3.5 ring-1 ring-[#f2d189]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-[#5c3a00]"><Hourglass className="h-4 w-4 shrink-0" aria-hidden /> {p.method} <span className="rounded-full bg-[#f2d189] px-2 py-0.5 text-xs font-bold">En revisión</span></p>
                  <p className="mt-0.5 text-xs text-[#7a4b00]">Enviaste el comprobante{p.at ? ` el ${date(p.at)}` : ""}. Aún no cuenta como pagado.</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-[#5c3a00]">{formatMoney(p.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Recibo */

export function HistoryReceiptPage() {
  const { token = "", orderId = "", receipt = "" } = useParams();
  const [load, retry] = useVisit(token, orderId);
  useHistoryMeta();
  if (load.state === "loading") return <div className="lp lp-light min-h-screen !bg-[var(--lp-paper)]"><LoadingView /></div>;
  if (load.state === "error") return <div className="lp lp-light min-h-screen !bg-[var(--lp-paper)]"><ErrorView onRetry={retry} /></div>;
  const d = load.state === "ready" ? load.data.detail : null;
  const r = d ? visitReceipt(d, receipt) : null;
  if (load.state === "missing" || !d || !r) return <div className="lp lp-light min-h-screen !bg-[var(--lp-paper)]"><TopBar /><MissingView /></div>;
  return <Receipt token={token} d={d} r={r} />;
}

function Receipt({ token, d, r }: { token: string; d: PublicVisitDetail; r: NonNullable<ReturnType<typeof visitReceipt>> }) {
  const v = d.vehicle;
  const q = d.quote;
  const business = [BUSINESS.brand, addressLines().slice(0, 2).join(", "), BUSINESS.phoneDisplay && `Tel. ${BUSINESS.phoneDisplay}`, BUSINESS.email].filter(Boolean).join(". ");
  useEffect(() => {
    const prev = document.title;
    document.title = `Recibo ${r.payment.code} | RAPIFIX`;
    return () => {
      document.title = prev;
    };
  }, [r.payment.code]);
  return (
    <div className="lp lp-light min-h-screen !bg-[#dfe4ee] py-4 print:!bg-white print:py-0 sm:py-8">
      <style>{`@page { size: letter; margin: 12mm; } @media print { body { background: #fff !important; } .rx-sheet { box-shadow: none !important; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[816px] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link to={historyVisitPath(token, d.id)} className="lp-btn lp-btn-line !min-h-[44px] !px-4 !text-sm"><ArrowLeft className="h-4 w-4" aria-hidden /> Volver</Link>
        <button type="button" onClick={() => window.print()} className="lp-btn lp-btn-navy !min-h-[44px] !px-4 !text-sm"><Printer className="h-4 w-4" aria-hidden /> Imprimir o guardar PDF</button>
      </div>
      <article className="rx-sheet mx-auto w-full max-w-[816px] bg-white text-[13px] leading-relaxed text-[#1e2a44] shadow-[0_20px_50px_-25px_rgb(1_25_85/0.5)] print:max-w-none">
        <div className="h-2 bg-[var(--lp-navy)] print:[print-color-adjust:exact]" />
        <div className="px-[6%] py-6 print:px-0 print:py-4">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[var(--lp-ink)] pb-4">
            <BrandLogo tone="light" size="lg" className="!shadow-none !px-0" />
            <div className="text-right">
              <p className="text-[15px] font-extrabold uppercase tracking-wide text-[var(--lp-ink)]">Comprobante de pago</p>
              <p className="text-lg font-bold text-[var(--lp-electric-ink)]">{r.payment.code}</p>
              <p className="text-xs text-[var(--lp-mute)]">{dateTime(r.payment.at)}</p>
            </div>
          </header>
          <p className="mt-2 text-[11px] text-[var(--lp-mute)]">{business}</p>

          <dl className="mt-5 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            <RxKV k="Recibido de" v={d.ownerName} />
            <RxKV k="Concepto" v={`Orden de trabajo ${d.code}`} />
            <RxKV k="Vehículo" v={[vehicleName(v), v.plate && `placa ${v.plate}`].filter(Boolean).join(", ")} />
            <RxKV k="Método" v={r.payment.method} />
          </dl>

          <div className="mt-5 rounded-xl bg-[var(--lp-paper)] p-4 text-center print:[print-color-adjust:exact]">
            <p className="text-[11px] uppercase tracking-wide text-[var(--lp-mute)]">Monto recibido</p>
            <p className="lp-display text-[2rem] tabular-nums text-[var(--lp-ink)]">{formatMoney(r.payment.amount)}</p>
          </div>

          {q && q.lines.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-1.5 border-l-4 border-[var(--lp-navy)] pl-2 text-[11px] font-bold uppercase tracking-wider">Detalle de la orden</h2>
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[var(--lp-ink)] text-left text-[10.5px] uppercase tracking-wide text-white print:[print-color-adjust:exact]">
                    <th className="px-2 py-1.5">Descripción</th>
                    <th className="px-2 py-1.5 text-right">Cant.</th>
                    <th className="hidden px-2 py-1.5 text-right sm:table-cell print:table-cell">Precio</th>
                    <th className="hidden px-2 py-1.5 text-right sm:table-cell print:table-cell">Desc.</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {q.lines.map((l, i) => (
                    <tr key={i} className="border-b border-[#e3e7f0]">
                      <td className="px-2 py-1.5">{l.d}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.q}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell print:table-cell">{formatMoney(l.unitPrice)}</td>
                      <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell print:table-cell">{l.discount ? formatMoney(l.discount) : ""}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatMoney(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-[300px] space-y-1">
              {q && (
                <>
                  <RxRow k="Subtotal" v={formatMoney(q.subtotal)} />
                  {q.discount > 0 && <RxRow k="Descuento" v={`- ${formatMoney(q.discount)}`} />}
                  {q.coupon && <RxRow k={`Cupón ${q.coupon.code}`} v={`- ${formatMoney(q.coupon.amount)}`} />}
                  <RxRow k={`ISV (${q.taxRate}%)`} v={formatMoney(q.tax)} />
                </>
              )}
              <div className="flex justify-between border-t-2 border-[var(--lp-ink)] pt-1 text-[15px] font-extrabold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(d.total)}</dd></div>
              {d.payments.slice(0, r.number).map((p) => (
                <RxRow key={p.code} k={`${p.method} (${p.code})`} v={formatMoney(p.amount)} bold={p.code === r.payment.code} />
              ))}
              <div className="flex justify-between font-bold"><dt>Saldo después de este pago</dt><dd className="tabular-nums">{formatMoney(r.balanceAfter)}</dd></div>
            </dl>
          </div>

          <p className="mt-8 text-[10.5px] text-[var(--lp-mute)]">Comprobante de pago. No es factura fiscal. Pago {r.number} de {r.of} registrados en la orden {d.code}.</p>
        </div>
        <div className="h-2 bg-[var(--lp-navy)] print:[print-color-adjust:exact]" />
      </article>
    </div>
  );
}

function RxKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-[var(--lp-mute)]">{k}</dt>
      <dd className="min-w-0 font-semibold">{v || "No registrado"}</dd>
    </div>
  );
}

function RxRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", bold ? "font-semibold" : "text-[var(--lp-mute)]")}>
      <dt>{k}</dt>
      <dd className="tabular-nums text-[var(--lp-ink)]">{v}</dd>
    </div>
  );
}
