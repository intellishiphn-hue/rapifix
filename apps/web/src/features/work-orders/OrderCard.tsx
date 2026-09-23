import { Link } from "react-router-dom";
import { Camera, Clock, User, Wrench } from "lucide-react";
import { PRIORITY_LABELS, type WorkOrder } from "@rapifix/shared";
import { formatRelative, toDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { StatusBadge } from "./StatusBadge";

export function daysInShop(order: WorkOrder): number {
  const start = toDate(order.createdAt);
  if (!start) return 0;
  const end = toDate(order.deliveredAt) ?? new Date();
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
}

export function OrderCard({ order, draggable, onDragStart, action }: { order: WorkOrder; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; action?: React.ReactNode }) {
  const days = daysInShop(order);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        "group rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-card)] transition hover:border-brand-300",
        draggable && "cursor-grab active:cursor-grabbing",
        order.priority === "urgent" && "border-l-4 border-l-red-500",
        order.priority === "high" && "border-l-4 border-l-amber-400",
      )}
    >
      <Link to={`/ordenes/${order.id}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-brand-700">{order.code}</span>
          <PlateTag plate={order.vehicle.plate} className="text-[10px]" />
        </div>
        <div className="mt-1.5 truncate text-sm font-semibold text-slate-900">
          {order.vehicle.make} {order.vehicle.model} <span className="font-normal text-slate-500">{order.vehicle.year}</span>
        </div>
        <div className="truncate text-xs text-slate-500">{order.customer.fullName}</div>
        <p className="mt-2 line-clamp-2 text-xs text-slate-600">{order.reason}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <StatusBadge status={order.status} short className="text-[10.5px]" />
          <span className={cn("inline-flex items-center gap-1", days >= 5 && order.isOpen && "font-semibold text-red-600")} title="Días en taller">
            <Clock className="h-3 w-3" /> {days === 0 ? "Hoy" : `${days} d`}
          </span>
          {order.technicians?.length > 0 ? (
            <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3" />{order.technicians.map((t) => t.name.split(" ")[0]).join(", ")}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700"><User className="h-3 w-3" />Sin técnico</span>
          )}
          {order.photoCount > 0 && <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{order.photoCount}</span>}
          {order.priority !== "normal" && <span className="font-semibold text-red-600">{PRIORITY_LABELS[order.priority]}</span>}
        </div>
        <div className="mt-1 text-[10.5px] text-slate-400">Actualizado {formatRelative(order.statusChangedAt)}</div>
      </Link>
      {action && <div className="mt-2 border-t border-slate-100 pt-2">{action}</div>}
    </div>
  );
}
