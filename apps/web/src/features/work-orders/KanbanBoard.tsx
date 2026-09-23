import { useMemo, useState } from "react";
import { toast } from "sonner";
import { allowedTransitions, KANBAN_COLUMNS, STATUS_META, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { toDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { OrderCard } from "./OrderCard";
import { MoveMenu } from "./MoveMenu";
import { useStatusChange } from "./useStatusChange";

const COLUMN_ACCENT: Record<string, string> = {
  received: "bg-slate-400", diagnosis: "bg-indigo-500", approval: "bg-amber-500", repair: "bg-brand-600",
  qc: "bg-cyan-500", ready: "bg-green-500", delivered: "bg-emerald-600",
};

export function KanbanBoard({ open, delivered }: { open: WorkOrder[]; delivered: WorkOrder[] }) {
  const { role } = useAuth();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const status = useStatusChange();

  const all = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = delivered.filter((o) => (toDate(o.deliveredAt)?.getTime() ?? 0) >= weekAgo);
    return [...open, ...recent];
  }, [open, delivered]);

  const byColumn = useMemo(
    () => KANBAN_COLUMNS.map((c) => ({ ...c, orders: all.filter((o) => (c.statuses as readonly string[]).includes(o.status)) })),
    [all],
  );

  const drop = (colKey: string) => {
    setOverCol(null);
    const order = all.find((o) => o.id === dragId);
    setDragId(null);
    if (!order) return;
    const col = KANBAN_COLUMNS.find((c) => c.key === colKey)!;
    if ((col.statuses as readonly string[]).includes(order.status)) return;
    const options = allowedTransitions(role, order.status).filter((s) => (col.statuses as readonly string[]).includes(s));
    if (!options.length) {
      toast.error(`No se puede mover de "${STATUS_META[order.status].label}" a "${col.label}".`);
      return;
    }
    // Una columna puede agrupar varios estados: se usa el primero permitido (se ajusta luego con un toque)
    void status.change(order, options[0]!);
  };

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-3">
          {byColumn.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={() => drop(col.key)}
              className={cn(
                "flex w-[272px] shrink-0 flex-col rounded-2xl bg-slate-100/80 p-2 transition-colors",
                overCol === col.key && "bg-brand-50 ring-2 ring-brand-300",
              )}
            >
              <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                <span className={cn("h-2 w-2 rounded-full", COLUMN_ACCENT[col.key])} />
                <span className="text-sm font-semibold text-slate-800">{col.label}</span>
                <span className="ml-auto rounded-full bg-white px-2 text-xs font-semibold text-slate-600">{col.orders.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2">
                {col.orders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    draggable={allowedTransitions(role, o.status).length > 0}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(o.id);
                    }}
                    action={<MoveMenu order={o} onPick={(to) => void status.change(o, to)} />}
                  />
                ))}
                {!col.orders.length && <div className="rounded-xl border-2 border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">Sin órdenes</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {status.element}
    </>
  );
}
