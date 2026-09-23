import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-brand-50 text-brand-700 ring-brand-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  amber: "bg-amber-50 text-amber-800 ring-amber-100",
  red: "bg-red-50 text-red-700 ring-red-100",
  dark: "bg-ink-900 text-white ring-ink-900",
} as const;

export function Badge({ tone = "gray", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}
