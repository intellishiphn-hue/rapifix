import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BadgeCheck, ChevronRight, Clock, CreditCard, Droplets, FileClock, Gift, MessageCircle, Plus, StickyNote, User } from "lucide-react";
import { formatMoney, isPlaceholderPlate, QUEUE_STATUSES, VEHICLE_SIZE_SHORT, WASH_STATUS_LABELS, type QueueStatus, type Wash } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { formatPlate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { hnTodayStart } from "@/features/reports/period";
import { usePendingProofs } from "@/features/payments/proofs";
import { useWash, useWashQueue } from "./api";
import { ChargeDialog } from "./ChargeDialog";
import { RegisterWashDialog } from "./RegisterWashDialog";
import { CarwashTabs, formatMinutes, formatTime, msOf, STATUS_STYLE, useNow } from "./ui";
import { PhotoCountChip, useWashPhotoPicker } from "./photos";
import { CancelWashDialog, moveWash, needsCharge, NEXT_LABEL, nextStatus, stageMinutes, WashDetailDialog, WhatsAppReadyDialog } from "./WashDialogs";

const COLUMN_TITLE: Record<QueueStatus, string> = { waiting: "En espera", washing: "Lavando", ready: "Listo", delivered: "Entregados hoy" };

export function CarwashQueuePage() {
  const { can } = useAuth();
  const now = useNow(30000);
  const today = useMemo(() => hnTodayStart(), [Math.floor(now / 3600000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const queue = useWashQueue(today);

  const [mobileTab, setMobileTab] = useState<QueueStatus>("waiting");
  const [register, setRegister] = useState<{ open: boolean; wash: Wash | null }>({ open: false, wash: null });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [charge, setCharge] = useState<Wash | null>(null);
  const [whatsapp, setWhatsapp] = useState<Wash | null>(null);
  const [cancel, setCancel] = useState<Wash | null>(null);
  const [unpaid, setUnpaid] = useState<Wash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const camera = useWashPhotoPicker();
  const proofs = usePendingProofs(can("payments.read"));
  const proofWashIds = useMemo(() => new Set(proofs.data.map((p) => p.washId).filter(Boolean)), [proofs.data]);

  // /carwash?lavado=<id> (desde "Comprobantes por revisar" en Pagos) abre el detalle de ese lavado
  const [params, setParams] = useSearchParams();
  const linked = params.get("lavado");
  useEffect(() => {
    if (!linked) return;
    setDetailId(linked);
    setParams((p) => { p.delete("lavado"); return p; }, { replace: true });
  }, [linked, setParams]);
  const outside = useWash(detailId && !queue.data.some((w) => w.id === detailId) ? detailId : undefined);

  const columns = useMemo(() => {
    const map: Record<QueueStatus, Wash[]> = { waiting: [], washing: [], ready: [], delivered: [] };
    for (const w of queue.data) {
      if (w.status === "cancelled") continue;
      if (w.status === "delivered" && msOf(w.deliveredAt) < today.getTime()) continue;
      map[w.status].push(w);
    }
    const asc = (a: Wash, b: Wash) => msOf(a.createdAt) - msOf(b.createdAt);
    map.waiting.sort(asc);
    map.washing.sort((a, b) => msOf(a.startedAt) - msOf(b.startedAt));
    map.ready.sort((a, b) => msOf(a.readyAt) - msOf(b.readyAt));
    map.delivered.sort((a, b) => msOf(b.deliveredAt) - msOf(a.deliveredAt));
    return map;
  }, [queue.data, today]);

  const detail = detailId ? queue.data.find((w) => w.id === detailId) ?? (outside.data?.id === detailId ? outside.data : null) : null;
  const isManager = can("carwash.manage");

  const advance = async (w: Wash, force = false) => {
    const to = nextStatus(w);
    if (!to) return;
    if (to === "delivered" && needsCharge(w) && !force) {
      if (can("carwash.charge")) {
        if (isManager) return setUnpaid(w);
        toast.message("Cobre el lavado antes de entregarlo.");
        return setCharge(w);
      }
      return toast.error("Este carro no está cobrado. Pida que lo cobren en caja antes de entregarlo.");
    }
    setBusy(w.id);
    const ok = await moveWash(w, to);
    setBusy(null);
    if (ok && (to === "ready" || to === "delivered")) offerExitPhotos(w);
    if (ok && to === "ready" && w.phone) setWhatsapp({ ...w, status: "ready" });
  };

  /** Aviso suave (no obligatorio) para tomar fotos de salida, solo si aún no tiene. */
  const offerExitPhotos = (w: Wash) => {
    const exit = w.photoCounts?.exit ?? 0;
    if (!can("carwash.create") || exit > 0) return;
    toast("¿Tomar fotos de salida?", {
      id: `exit-photos-${w.id}`,
      description: `${w.code} · opcional`,
      duration: 9000,
      action: { label: "Tomar fotos", onClick: () => camera.pick(w, "exit", exit) },
    });
  };

  if (queue.loading && !queue.data.length) return <PageLoader />;

  return (
    <>
      <PageHeader
        title="Carwash"
        description="Cola de lavado en tiempo real."
        actions={can("carwash.create") && (
          <Button size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setRegister({ open: true, wash: null })}>Registrar carro</Button>
        )}
      />
      <CarwashTabs />
      {queue.error && <Card className="mb-4"><ErrorState message={queue.error} /></Card>}

      {/* Pestañas por estado (celular y tablet vertical) */}
      <div className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-slate-200/70 p-1 lg:hidden">
        {QUEUE_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setMobileTab(s)}
            className={cn("flex flex-col items-center rounded-lg px-1 py-2 text-xs font-semibold", mobileTab === s ? "bg-white shadow-sm text-slate-900" : "text-slate-600")}
          >
            <span className="tabular text-lg leading-none">{columns[s].length}</span>
            <span className="mt-0.5 truncate">{s === "delivered" ? "Entregados" : WASH_STATUS_LABELS[s]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {QUEUE_STATUSES.map((s) => (
          <section key={s} className={cn("min-w-0", mobileTab !== s && "hidden lg:block")}>
            <div className={cn("mb-2 hidden items-center justify-between rounded-xl px-3 py-2 lg:flex", STATUS_STYLE[s].head)}>
              <span className="flex items-center gap-2 text-sm font-bold"><span className={cn("h-2.5 w-2.5 rounded-full", STATUS_STYLE[s].dot)} />{COLUMN_TITLE[s]}</span>
              <span className="tabular text-sm font-bold">{columns[s].length}</span>
            </div>
            <div className="space-y-3">
              {columns[s].map((w) => (
                <WashCard
                  key={w.id}
                  wash={w}
                  now={now}
                  busy={busy === w.id}
                  onOpen={() => setDetailId(w.id)}
                  onAdvance={() => void advance(w)}
                  onCharge={can("carwash.charge") ? () => setCharge(w) : undefined}
                  onWhatsApp={() => setWhatsapp(w)}
                  proofPending={proofWashIds.has(w.id)}
                />
              ))}
              {!columns[s].length && (
                <div className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  {s === "waiting" ? "No hay carros esperando." : s === "washing" ? "Nadie lavando ahora." : s === "ready" ? "No hay carros listos." : "Aún no se entrega ningún carro hoy."}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {!queue.loading && !queue.data.length && can("carwash.create") && (
        <Card className="mt-6">
          <EmptyState
            icon={<Droplets className="h-7 w-7" />}
            title="La cola está vacía"
            description="Registre el primer carro del día. Toma menos de 20 segundos."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setRegister({ open: true, wash: null })}>Registrar carro</Button>}
          />
        </Card>
      )}

      {camera.element}
      <RegisterWashDialog open={register.open} wash={register.wash} onClose={() => setRegister({ open: false, wash: null })} />
      {charge && <ChargeDialog wash={queue.data.find((w) => w.id === charge.id) ?? charge} onClose={() => setCharge(null)} />}
      <WhatsAppReadyDialog wash={whatsapp} onClose={() => setWhatsapp(null)} />
      <CancelWashDialog wash={cancel} onClose={(done) => { setCancel(null); if (done) setDetailId(null); }} />
      <WashDetailDialog
        wash={detail}
        onClose={() => setDetailId(null)}
        onCharge={(w) => setCharge(w)}
        onEdit={(w) => { setDetailId(null); setRegister({ open: true, wash: w }); }}
        onWhatsApp={(w) => setWhatsapp(w)}
        onCancel={(w) => setCancel(w)}
      />
      <ConfirmDialog
        open={!!unpaid}
        onClose={() => setUnpaid(null)}
        title="Entregar sin cobrar"
        message={unpaid ? `${unpaid.code} tiene ${formatMoney(unpaid.total)} pendiente. ¿Entregar sin cobrar? Quedará marcado como "entregado sin cobrar".` : ""}
        confirmLabel="Entregar sin cobrar"
        danger
        onConfirm={() => {
          const w = unpaid;
          setUnpaid(null);
          if (w) void advance(w, true);
        }}
      />
    </>
  );
}

function WashCard({
  wash: w, now, busy, onOpen, onAdvance, onCharge, onWhatsApp, proofPending,
}: {
  wash: Wash; now: number; busy: boolean; onOpen: () => void; onAdvance: () => void; onCharge?: () => void; onWhatsApp: () => void; proofPending?: boolean;
}) {
  const { can } = useAuth();
  const mins = stageMinutes(w, now);
  const late = (w.status === "waiting" && mins > 30) || (w.status === "ready" && mins > 30);
  const main = w.items.find((i) => i.kind === "wash");
  const extras = w.items.filter((i) => i.kind === "extra");
  const nextLabel = NEXT_LABEL[w.status];
  const money = can("carwash.charge");
  return (
    <Card className="overflow-hidden">
      <button onClick={onOpen} className="block w-full p-3.5 text-left hover:bg-slate-50/70">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={cn("text-xl font-extrabold tracking-wider", isPlaceholderPlate(w.plate) ? "text-amber-600" : "text-slate-900")} title={isPlaceholderPlate(w.plate) ? "Sin placa real: no suma sellos" : undefined}>{formatPlate(w.plate)}</div>
            <div className="truncate text-xs text-slate-500">{w.code} · {VEHICLE_SIZE_SHORT[w.size]}{w.customerName ? ` · ${w.customerName}` : ""}</div>
          </div>
          <div className={cn("flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold", late ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700")}>
            <Clock className="h-3.5 w-3.5" />
            {w.status === "delivered" ? formatTime(w.deliveredAt) : formatMinutes(mins)}
          </div>
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-800">{main?.name ?? "Solo extras"}</div>
        {extras.length > 0 && <div className="text-xs text-slate-500">+ {extras.map((e) => e.name).join(", ")}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5", w.washerName ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-500")}>
            <User className="h-3 w-3" />{w.washerName || "Sin lavador"}
          </span>
          {w.membershipId && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700"><BadgeCheck className="h-3 w-3" />Membresía</span>}
          {w.loyaltyRedeemed && <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700"><Gift className="h-3 w-3" />Premio</span>}
          {w.notes && <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-800"><StickyNote className="h-3 w-3" />Notas</span>}
          <PhotoCountChip wash={w} />
          {proofPending && needsCharge(w) && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"><FileClock className="h-3 w-3" />Comprobante por revisar</span>}
          {money && (
            <span className={cn("ml-auto tabular font-bold", w.paid ? "text-emerald-700" : "text-slate-900")}>
              {w.total > 0 ? formatMoney(w.total) : "Sin cobro"}{w.paid && w.total > 0 ? " · pagado" : ""}
            </span>
          )}
          {!money && w.paid && <span className="ml-auto font-semibold text-emerald-700">Pagado</span>}
        </div>
      </button>
      {w.status !== "delivered" && (
        <div className="flex gap-2 border-t border-slate-100 p-2.5">
          {nextLabel && (
            <Button size="lg" className="flex-1" onClick={onAdvance} loading={busy} icon={<ChevronRight className="h-5 w-5" />}>{nextLabel}</Button>
          )}
          {onCharge && needsCharge(w) && (
            <Button size="lg" variant={w.status === "ready" ? "primary" : "secondary"} className={w.status === "ready" ? "bg-emerald-600 hover:bg-emerald-700" : ""} onClick={onCharge} icon={<CreditCard className="h-5 w-5" />}>
              Cobrar
            </Button>
          )}
          {w.status === "ready" && w.phone && (
            <Button size="lg" variant="secondary" onClick={onWhatsApp} aria-label="Avisar por WhatsApp" className="px-3.5">
              <MessageCircle className="h-5 w-5 text-[#1faa53]" />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
