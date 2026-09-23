import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

/** Campo de dinero en lempiras que guarda centavos. */
export function MoneyInput({ value, onChange, className, disabled, placeholder }: { value: number; onChange: (cents: number) => void; className?: string; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : "");
  useEffect(() => {
    const current = Math.round(Number(text.replace(/,/g, "")) * 100) || 0;
    if (current !== value) setText(value ? (value / 100).toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">L</span>
      <Input
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, "");
          setText(t);
          const n = Number(t.replace(/,/g, ""));
          onChange(Number.isFinite(n) ? Math.round(n * 100) : 0);
        }}
        onBlur={() => setText(value ? (value / 100).toFixed(2) : "")}
        className="tabular pl-6 text-right"
      />
    </div>
  );
}
