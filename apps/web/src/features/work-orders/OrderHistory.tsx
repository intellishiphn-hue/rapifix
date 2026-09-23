import { ArrowRight, Camera, ClipboardList, Eye, MessageSquare, StickyNote, UserCog, Wrench } from "lucide-react";
import type { OrderEvent, OrderEventType } from "@rapifix/shared";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { StatusBadge } from "./StatusBadge";

const ICONS: Record<OrderEventType, { icon: React.ReactNode; tone: string }> = {
  created: { icon: <ClipboardList className="h-3.5 w-3.5" />, tone: "bg-brand-600 text-white" },
  status_change: { icon: <ArrowRight className="h-3.5 w-3.5" />, tone: "bg-indigo-500 text-white" },
  note: { icon: <StickyNote className="h-3.5 w-3.5" />, tone: "bg-slate-200 text-slate-700" },
  customer_update: { icon: <MessageSquare className="h-3.5 w-3.5" />, tone: "bg-emerald-500 text-white" },
  photo: { icon: <Camera className="h-3.5 w-3.5" />, tone: "bg-sky-500 text-white" },
  assignment: { icon: <UserCog className="h-3.5 w-3.5" />, tone: "bg-amber-500 text-white" },
  section: { icon: <Wrench className="h-3.5 w-3.5" />, tone: "bg-cyan-600 text-white" },
};

export function EventTimeline({ events, loading, error, empty = "Sin movimientos" }: { events: OrderEvent[]; loading: boolean; error: string | null; empty?: string }) {
  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  if (!events.length) return <EmptyState icon={<ClipboardList className="h-7 w-7" />} title={empty} />;
  return (
    <ol className="relative space-y-5 p-5 before:absolute before:bottom-6 before:left-[31px] before:top-6 before:w-px before:bg-slate-200">
      {events.map((e) => {
        const meta = ICONS[e.type] ?? ICONS.note;
        return (
          <li key={e.id} className="relative flex gap-4">
            <span className={cn("z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white", meta.tone)}>{meta.icon}</span>
            <div className="min-w-0 flex-1 text-sm">
              {e.type === "status_change" && e.fromStatus && e.toStatus ? (
                <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={e.fromStatus} short /><ArrowRight className="h-3.5 w-3.5 text-slate-400" /><StatusBadge status={e.toStatus} short /></div>
              ) : null}
              <p className={cn("whitespace-pre-line text-slate-800", e.type === "status_change" && "mt-1 text-slate-600")}>
                {e.type === "status_change" ? e.text.replace(/^[^.]*→[^.]*(\.\s*)?/, "") : e.text}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{e.actorName}</span>·<span>{formatDate(e.at, true)}</span>
                {e.visibleToCustomer && <span className="inline-flex items-center gap-1 text-emerald-700"><Eye className="h-3 w-3" /> Visible al cliente</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
