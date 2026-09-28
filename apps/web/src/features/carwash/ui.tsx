import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  membershipCanUse, membershipWindow, VEHICLE_SIZE_HINTS, VEHICLE_SIZE_LABELS, VEHICLE_SIZES,
  type CarwashMembership, type MembershipStatus, type Permission, type VehicleSize, type WashStatus,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { toDate } from "@/lib/format";

/** Pestañas de la sección Carwash (solo las que el rol puede ver). */
export function CarwashTabs() {
  const { can } = useAuth();
  const tabs: Array<{ to: string; label: string; permission: Permission; end?: boolean }> = [
    { to: "/carwash", label: "Cola", permission: "carwash.read", end: true },
    { to: "/carwash/historial", label: "Historial", permission: "carwash.charge" },
    { to: "/carwash/membresias", label: "Membresías", permission: "carwash.charge" },
    { to: "/carwash/menu", label: "Menú", permission: "carwash.manage" },
    { to: "/carwash/planes", label: "Planes", permission: "carwash.manage" },
    { to: "/carwash/reportes", label: "Reportes", permission: "carwash.reports" },
    { to: "/carwash/config", label: "Configuración", permission: "carwash.manage" },
  ];
  const visible = tabs.filter((t) => can(t.permission));
  if (visible.length < 2) return null;
  return (
    <div className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-1 print:hidden">
      {visible.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive ? "text-brand-700 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600" : "text-slate-500 hover:text-slate-800",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

/** Hora actual que se actualiza cada "ms" (para los contadores de minutos de la cola). */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const msOf = (v: Parameters<typeof toDate>[0]) => toDate(v)?.getTime() ?? 0;

/** "12 min", "1 h 05 min" */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

export const STATUS_STYLE: Record<WashStatus, { dot: string; head: string; tone: "gray" | "blue" | "green" | "amber" | "red" }> = {
  waiting: { dot: "bg-amber-500", head: "bg-amber-50 text-amber-800", tone: "amber" },
  washing: { dot: "bg-sky-500", head: "bg-sky-50 text-sky-800", tone: "blue" },
  ready: { dot: "bg-emerald-500", head: "bg-emerald-50 text-emerald-800", tone: "green" },
  delivered: { dot: "bg-slate-400", head: "bg-slate-100 text-slate-700", tone: "gray" },
  cancelled: { dot: "bg-red-500", head: "bg-red-50 text-red-700", tone: "red" },
};

/** Botones grandes para elegir el tamaño del vehículo. */
export function SizePicker({ value, onChange }: { value: VehicleSize | null; onChange: (s: VehicleSize) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {VEHICLE_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "rounded-xl border-2 px-3 py-2.5 text-left transition-colors",
            value === s ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300",
          )}
        >
          <span className={cn("block text-sm font-semibold", value === s ? "text-brand-700" : "text-slate-800")}>{VEHICLE_SIZE_LABELS[s]}</span>
          <span className="block text-[11px] leading-tight text-slate-500">{VEHICLE_SIZE_HINTS[s]}</span>
        </button>
      ))}
    </div>
  );
}

/** Estado real de una membresía a la fecha (vencida si ya pasó la fecha pagada aunque el servidor no la haya marcado). */
export function membershipNow(m: CarwashMembership, now = Date.now()) {
  const w = membershipWindow(
    { status: m.status, periodStart: msOf(m.periodStart), periodEnd: msOf(m.periodEnd), paidUntil: msOf(m.paidUntil), usedInPeriod: m.usedInPeriod ?? 0 },
    now,
  );
  const status: MembershipStatus = m.status === "cancelled" ? "cancelled" : w.active ? "active" : "expired";
  const paidUntil = msOf(m.paidUntil);
  const daysLeft = Math.ceil((paidUntil - now) / 86400000);
  return { ...w, status, paidUntil, daysLeft, canUse: membershipCanUse(m.plan?.washesPerMonth ?? null, w.usedInPeriod) };
}

export const MEMBERSHIP_TONE: Record<MembershipStatus, "green" | "amber" | "gray"> = { active: "green", expired: "amber", cancelled: "gray" };

const timeFmt = new Intl.DateTimeFormat("es-HN", { hour: "numeric", minute: "2-digit", timeZone: "America/Tegucigalpa" });
/** "3:45 p. m." (hora de Honduras) */
export const formatTime = (v: Parameters<typeof toDate>[0]) => {
  const d = toDate(v);
  return d ? timeFmt.format(d) : "";
};
