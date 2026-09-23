import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS, type Appointment } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { STATUS_TONE, useAgendaStaff, useAppointments, type AppointmentPreset } from "./api";
import { AppointmentDialog } from "./AppointmentDialog";
import { AppointmentDetailDialog } from "./AppointmentDetailDialog";
import {
  addDays, combine, DAY_END_HOUR, DAY_START_HOUR, dayStartMs, fmtDayMonth, fmtLongDay, fmtMonth, fmtShortDay, fmtTime,
  hourLabel, minutesOfDay, mondayOf, msToDayKey, todayKey, weekday,
} from "./time";

type View = "day" | "week";
const HOUR_PX = 60;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

const startMs = (a: Appointment) => a.start.toMillis();
const endMs = (a: Appointment) => a.end?.toMillis?.() ?? startMs(a) + a.durationMin * 60000;
const inactive = (a: Appointment) => a.status === "cancelled" || a.status === "no_show";

/** Reparte citas que se traslapan en columnas. */
function layout(items: Appointment[]) {
  const lanes: number[] = [];
  const placed = items.map((a) => {
    const s = startMs(a);
    let lane = lanes.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(0);
    }
    lanes[lane] = endMs(a);
    return { a, lane };
  });
  return { placed, lanes: Math.max(1, lanes.length) };
}

export function AgendaPage() {
  const { can, role, user } = useAuth();
  const canManage = can("agenda.manage");
  const isTech = role === "technician";
  const staff = useAgendaStaff();

  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"));
  const [anchor, setAnchor] = useState(todayKey());
  const [sunday, setSunday] = useState(false);
  const [tech, setTech] = useState<string>(isTech && user ? user.uid : "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ appointment?: Appointment; preset?: AppointmentPreset } | null>(null);

  const today = todayKey();
  const days = useMemo(() => {
    if (view === "day") return [anchor];
    const mon = mondayOf(anchor);
    return Array.from({ length: sunday ? 7 : 6 }, (_, i) => addDays(mon, i));
  }, [view, anchor, sunday]);
  const from = dayStartMs(view === "day" ? anchor : mondayOf(anchor));
  const to = from + (view === "day" ? 1 : 7) * 86400000;

  const { data, loading, error } = useAppointments(from, to, tech || null);
  const todayList = useAppointments(dayStartMs(today), dayStartMs(today) + 86400000, tech || null);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of data) {
      const k = msToDayKey(startMs(a));
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [data]);
  const visibleCount = days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);

  const summary = useMemo(() => {
    const active = todayList.data.filter((a) => a.status !== "cancelled");
    return {
      total: active.length,
      confirmed: active.filter((a) => a.status === "confirmed").length,
      pending: active.filter((a) => a.status === "scheduled").length,
    };
  }, [todayList.data]);

  const move = (dir: -1 | 1) => setAnchor((d) => addDays(d, dir * (view === "day" ? 1 : 7)));
  const title =
    view === "day"
      ? fmtLongDay(dayStartMs(anchor) + 12 * 3600000)
      : `${fmtDayMonth(dayStartMs(days[0]!) + 12 * 3600000)} – ${fmtDayMonth(dayStartMs(days.at(-1)!) + 12 * 3600000)} · ${fmtMonth(dayStartMs(days[0]!) + 12 * 3600000)}`;

  const selected = data.find((a) => a.id === selectedId) ?? todayList.data.find((a) => a.id === selectedId) ?? null;
  const newAt = (day: string, hour: number) => canManage && setEditing({ preset: { start: combine(day, `${String(hour).padStart(2, "0")}:00`) } });

  return (
    <>
      <PageHeader
        title="Agenda"
        description={isTech ? "Sus citas y las del taller (solo lectura)." : "Citas, recepciones y entregas del taller."}
        actions={canManage && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setEditing({})}>Nueva cita</Button>}
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-slate-500">Citas de hoy</div><div className="tabular text-2xl font-bold">{summary.total}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Confirmadas</div><div className="tabular text-2xl font-bold text-brand-700">{summary.confirmed}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-500">Pendientes de confirmar</div><div className="tabular text-2xl font-bold text-amber-700">{summary.pending}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="secondary" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="secondary" className="h-10" onClick={() => setAnchor(todayKey())}>Hoy</Button>
            <Button size="icon" variant="secondary" onClick={() => move(1)} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
            <h2 className="ml-1 text-base font-semibold capitalize text-slate-900 sm:text-lg">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={tech} onChange={(e) => setTech(e.target.value)} className="w-auto min-w-[170px]">
              <option value="">Todos los técnicos</option>
              {staff.active.map((s) => <option key={s.id} value={s.id}>{s.id === user?.uid ? `${s.displayName} (yo)` : s.displayName}</option>)}
            </Select>
            <div className="flex rounded-[10px] bg-slate-200/70 p-1">
              {(["day", "week"] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", view === v ? "bg-white shadow-sm" : "text-slate-600")}>{v === "day" ? "Día" : "Semana"}</button>
              ))}
            </div>
            {view === "week" && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={sunday} onChange={(e) => setSunday(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Domingo
              </label>
            )}
          </div>
        </div>

        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <>
            {/* Celular: lista por día y hora */}
            <div className="md:hidden">
              <MobileList days={days} byDay={byDay} today={today} colorOf={staff.colorOf} onOpen={setSelectedId} />
            </div>
            {/* Escritorio: grilla por horas */}
            <div className="hidden md:block">
              <Grid days={days} byDay={byDay} today={today} colorOf={staff.colorOf} onOpen={setSelectedId} onSlot={canManage ? newAt : undefined} />
            </div>
            {!visibleCount && (
              <div className="border-t border-slate-100">
                <EmptyState
                  icon={<CalendarDays className="h-7 w-7" />}
                  title={view === "day" ? "Sin citas este día" : "Sin citas esta semana"}
                  description={canManage ? "Agende citas de clientes, recepciones y entregas. Toque un espacio de la agenda o use Nueva cita." : undefined}
                />
              </div>
            )}
          </>
        )}
      </Card>

      {staff.active.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {staff.active.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: staff.colorOf(s.id) }} />{s.displayName}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" />Sin técnico</span>
        </div>
      )}

      <AppointmentDetailDialog
        appointment={selected}
        color={staff.colorOf(selected?.technicianId)}
        onClose={() => setSelectedId(null)}
        onEdit={(a) => {
          setSelectedId(null);
          setEditing({ appointment: a });
        }}
      />
      <AppointmentDialog open={!!editing} onClose={() => setEditing(null)} appointment={editing?.appointment} preset={editing?.preset} />
    </>
  );
}

function Grid({
  days, byDay, today, colorOf, onOpen, onSlot,
}: {
  days: string[];
  byDay: Map<string, Appointment[]>;
  today: string;
  colorOf: (id: string | null) => string;
  onOpen: (id: string) => void;
  onSlot?: (day: string, hour: number) => void;
}) {
  const total = HOURS.length * HOUR_PX;
  const nowMin = minutesOfDay(Date.now());
  const outside = days.flatMap((d) => (byDay.get(d) ?? []).filter((a) => {
    const m = minutesOfDay(startMs(a));
    return m < DAY_START_HOUR * 60 || m >= DAY_END_HOUR * 60;
  }));

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: days.length > 1 ? days.length * 130 + 64 : undefined }}>
        <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div key={d} className={cn("border-l border-slate-100 px-2 py-2 text-center text-sm font-semibold capitalize", d === today ? "text-brand-700" : "text-slate-700")}>
              {fmtShortDay(dayStartMs(d) + 12 * 3600000)}
              {d === today && <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold uppercase text-white">Hoy</span>}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height: total }}>
            {HOURS.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-400" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : hourLabel(h)}</div>
            ))}
          </div>
          {days.map((d) => {
            const items = (byDay.get(d) ?? []).filter((a) => {
              const m = minutesOfDay(startMs(a));
              return m >= DAY_START_HOUR * 60 && m < DAY_END_HOUR * 60;
            });
            const { placed, lanes } = layout(items);
            return (
              <div key={d} className={cn("relative border-l border-slate-100", weekday(d) === 0 && "bg-slate-50/60")} style={{ height: total }}>
                {HOURS.map((h, i) => (
                  <button
                    key={h}
                    type="button"
                    disabled={!onSlot}
                    onClick={() => onSlot?.(d, h)}
                    className={cn("absolute inset-x-0 border-t border-slate-100", onSlot && "hover:bg-brand-50/50")}
                    style={{ top: i * HOUR_PX, height: HOUR_PX }}
                    aria-label={`Nueva cita ${d} ${h}:00`}
                  />
                ))}
                {d === today && nowMin >= DAY_START_HOUR * 60 && nowMin < DAY_END_HOUR * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: ((nowMin - DAY_START_HOUR * 60) / 60) * HOUR_PX }} />
                )}
                {placed.map(({ a, lane }) => {
                  const top = ((minutesOfDay(startMs(a)) - DAY_START_HOUR * 60) / 60) * HOUR_PX;
                  const height = Math.max(24, Math.min((a.durationMin / 60) * HOUR_PX, total - top) - 2);
                  const color = colorOf(a.technicianId);
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpen(a.id)}
                      className={cn("absolute z-20 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left text-xs shadow-sm ring-1 ring-slate-200 transition hover:z-30 hover:shadow-md", inactive(a) ? "bg-slate-50 opacity-60" : "bg-white")}
                      style={{ top: top + 1, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, borderLeftColor: color }}
                    >
                      <div className={cn("truncate font-semibold text-slate-900", a.status === "cancelled" && "line-through")}>{fmtTime(startMs(a))} {a.customerName}</div>
                      {height > 34 && <div className="truncate text-slate-500">{a.plate ? `${a.plate} · ` : ""}{APPOINTMENT_TYPE_LABELS[a.type]}</div>}
                      {height > 50 && <div className="truncate text-slate-400">{APPOINTMENT_STATUS_LABELS[a.status]}</div>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {outside.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fuera del horario (7:00 a 18:00)</div>
          <div className="flex flex-wrap gap-2">
            {outside.map((a) => (
              <button key={a.id} onClick={() => onOpen(a.id)} className="rounded-lg border-l-4 bg-white px-2 py-1 text-left text-xs shadow-sm ring-1 ring-slate-200" style={{ borderLeftColor: colorOf(a.technicianId) }}>
                <span className="font-semibold">{fmtShortDay(startMs(a))} {fmtTime(startMs(a))}</span> · {a.customerName}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileList({
  days, byDay, today, colorOf, onOpen,
}: {
  days: string[];
  byDay: Map<string, Appointment[]>;
  today: string;
  colorOf: (id: string | null) => string;
  onOpen: (id: string) => void;
}) {
  const withItems = days.filter((d) => byDay.get(d)?.length);
  if (!withItems.length) return null;
  return (
    <div className="divide-y divide-slate-100">
      {withItems.map((d) => (
        <div key={d}>
          {days.length > 1 && (
            <div className={cn("bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide", d === today ? "text-brand-700" : "text-slate-500")}>
              {fmtLongDay(dayStartMs(d) + 12 * 3600000)}{d === today ? " · hoy" : ""}
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {byDay.get(d)!.map((a) => (
              <li key={a.id}>
                <button onClick={() => onOpen(a.id)} className={cn("flex w-full items-stretch gap-3 px-4 py-3 text-left hover:bg-slate-50", inactive(a) && "opacity-60")}>
                  <div className="w-14 shrink-0 pt-0.5 text-right">
                    <div className="tabular text-sm font-semibold text-slate-900">{fmtTime(startMs(a))}</div>
                    <div className="text-[11px] text-slate-400">{a.durationMin} min</div>
                  </div>
                  <span className="w-1 shrink-0 rounded-full" style={{ background: colorOf(a.technicianId) }} />
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate font-semibold text-slate-900", a.status === "cancelled" && "line-through")}>{a.customerName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {a.plate && <PlateTag plate={a.plate} className="text-[10px]" />}
                      <span>{APPOINTMENT_TYPE_LABELS[a.type]}</span>
                      {a.technicianName && <span>· {a.technicianName}</span>}
                    </div>
                  </div>
                  <Badge tone={STATUS_TONE[a.status]} className="self-start">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
