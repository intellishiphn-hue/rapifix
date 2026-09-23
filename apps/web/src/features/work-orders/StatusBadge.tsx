import { STATUS_META, type StatusColor, type WorkOrderStatus } from "@rapifix/shared";
import { cn } from "@/lib/cn";

export const STATUS_CLASSES: Record<StatusColor, { badge: string; dot: string; bar: string }> = {
  slate: { badge: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400", bar: "bg-slate-400" },
  sky: { badge: "bg-sky-50 text-sky-700 ring-sky-100", dot: "bg-sky-500", bar: "bg-sky-500" },
  indigo: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-100", dot: "bg-indigo-500", bar: "bg-indigo-500" },
  violet: { badge: "bg-violet-50 text-violet-700 ring-violet-100", dot: "bg-violet-500", bar: "bg-violet-500" },
  amber: { badge: "bg-amber-50 text-amber-800 ring-amber-100", dot: "bg-amber-500", bar: "bg-amber-500" },
  teal: { badge: "bg-teal-50 text-teal-700 ring-teal-100", dot: "bg-teal-500", bar: "bg-teal-500" },
  blue: { badge: "bg-brand-50 text-brand-700 ring-brand-100", dot: "bg-brand-600", bar: "bg-brand-600" },
  orange: { badge: "bg-orange-50 text-orange-700 ring-orange-100", dot: "bg-orange-500", bar: "bg-orange-500" },
  cyan: { badge: "bg-cyan-50 text-cyan-700 ring-cyan-100", dot: "bg-cyan-500", bar: "bg-cyan-500" },
  green: { badge: "bg-green-50 text-green-700 ring-green-100", dot: "bg-green-500", bar: "bg-green-500" },
  emerald: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-100", dot: "bg-emerald-600", bar: "bg-emerald-600" },
  red: { badge: "bg-red-50 text-red-700 ring-red-100", dot: "bg-red-500", bar: "bg-red-500" },
};

export function StatusBadge({ status, className, short }: { status: WorkOrderStatus; className?: string; short?: boolean }) {
  const meta = STATUS_META[status];
  const c = STATUS_CLASSES[meta.color];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", c.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {short ? meta.short : meta.label}
    </span>
  );
}
