import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, History } from "lucide-react";
import { toast } from "sonner";
import { allowedTransitions, KANBAN_COLUMNS, STATUS_META, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { OrderCard } from "./OrderCard";
import { MoveMenu } from "./MoveMenu";
import { useStatusChange } from "./useStatusChange";

const COLUMN_ACCENT: Record<string, string> = {
  received: "bg-slate-400", diagnosis: "bg-indigo-500", approval: "bg-amber-500", repair: "bg-brand-600",
  qc: "bg-cyan-500", ready: "bg-green-500", delivered: "bg-emerald-600",
};

/**
 * `delivered`: solo las entregadas en las últimas 24 horas (useBoardDelivered); las demás están en el historial.
 * `monthCount`: entregadas en lo que va del mes, para el enlace al historial (opcional).
 */
export function KanbanBoard({ open, delivered, monthCount }: { open: WorkOrder[]; delivered: WorkOrder[]; monthCount?: number | null }) {
  const { role } = useAuth();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const status = useStatusChange();

  const all = useMemo(() => [...open, ...delivered], [open, delivered]);

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
                <span className={cn("h-2 w-2 shrink-0 rounded-full", COLUMN_ACCENT[col.key])} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{col.label}</div>
                  {col.key === "delivered" && <div className="text-[11px] leading-tight text-slate-500">Últimas 24 horas</div>}
                </div>
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
                {!col.orders.length && (
                  <div className="rounded-xl border-2 border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    {col.key === "delivered" ? "Sin entregas en las últimas 24 horas" : "Sin órdenes"}
                  </div>
                )}
              </div>
              {col.key === "delivered" && (
                <Link
                  to="/ordenes/historial"
                  className="mt-2 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-slate-200 transition hover:bg-brand-50 hover:ring-brand-200"
                >
                  <History className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 leading-tight">
                    Ver historial de entregadas
                    {typeof monthCount === "number" && <span className="block font-normal text-slate-500">{monthCount} este mes</span>}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      {status.element}
    </>
  );
}
