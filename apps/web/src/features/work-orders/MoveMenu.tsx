import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { allowedTransitions, STATUS_META, type WorkOrder, type WorkOrderStatus } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";

/** Botón para mover la orden (útil en celular donde no hay arrastrar y soltar). */
export function MoveMenu({ order, onPick, className }: { order: WorkOrder; onPick: (s: WorkOrderStatus) => void; className?: string }) {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const options = allowedTransitions(role, order.status);
  if (!options.length) return null;
  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
      >
        Mover a <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="animate-pop absolute left-0 right-0 z-20 mt-1 rounded-xl border border-slate-200 bg-white p-1 shadow-[var(--shadow-pop)]">
          {options.map((s) => (
            <button
              key={s}
              onMouseDown={() => onPick(s)}
              className={cn("block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50", s === "CANCELLED" && "text-red-600")}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
