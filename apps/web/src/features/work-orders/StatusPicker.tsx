import { Loader2 } from "lucide-react";
import { allowedTransitions, STATUS_META, WORK_ORDER_STATUSES, type WorkOrder, type WorkOrderStatus } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { STATUS_CLASSES } from "./StatusBadge";

/** Fila de estados: se toca el que corresponde y queda guardado. */
export function StatusPicker({ order, onPick, busy }: { order: WorkOrder; onPick: (s: WorkOrderStatus) => void; busy?: boolean }) {
  const { role } = useAuth();
  const allowed = new Set(allowedTransitions(role, order.status));
  const visible = WORK_ORDER_STATUSES.filter((s) => s === order.status || allowed.has(s));
  if (visible.length <= 1) return null;

  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {visible.map((s) => {
        const current = s === order.status;
        const c = STATUS_CLASSES[STATUS_META[s].color];
        return (
          <button
            key={s}
            type="button"
            disabled={current || busy}
            onClick={() => onPick(s)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset transition",
              current ? cn(c.badge, "ring-2") : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300 disabled:opacity-60",
              s === "CANCELLED" && !current && "text-red-600",
            )}
          >
            {current && busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={cn("h-2 w-2 rounded-full", c.dot)} />}
            {STATUS_META[s].label}
          </button>
        );
      })}
    </div>
  );
}
