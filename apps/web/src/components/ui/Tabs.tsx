import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: T; label: string; icon?: ReactNode; count?: number; disabled?: boolean }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          disabled={t.disabled}
          onClick={() => onChange(t.value)}
          className={cn(
            "relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === t.value ? "text-brand-700" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && (
            <span className={cn("rounded-full px-1.5 text-xs", value === t.value ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600")}>{t.count}</span>
          )}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
        </button>
      ))}
    </div>
  );
}
