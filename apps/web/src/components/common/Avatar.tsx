import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";

const palette = ["bg-brand-100 text-brand-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700", "bg-rose-100 text-rose-700"];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return (
    <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", palette[idx], className)}>
      {initials(name) || "?"}
    </span>
  );
}
