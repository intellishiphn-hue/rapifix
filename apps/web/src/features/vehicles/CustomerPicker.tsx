import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { formatPhone, type Customer } from "@rapifix/shared";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { searchCustomers } from "@/features/customers/api";
import { Avatar } from "@/components/common/Avatar";

/** Selector de cliente con búsqueda (nombre, teléfono, identidad). */
export function CustomerPicker({
  value,
  onChange,
  invalid,
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Customer[]>([]);
  const debounced = useDebounced(text, 250);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    searchCustomers(debounced)
      .then((r) => !cancelled && setResults(r.filter((c) => c.status === "active")))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2">
        <Avatar name={value.fullName} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{value.fullName}</div>
          <div className="text-xs text-slate-500">{formatPhone(value.phone)}</div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Cambiar cliente">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Buscar cliente por nombre o teléfono..."
        className={cn(
          "h-10 w-full rounded-[10px] border bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100",
          invalid ? "border-red-400" : "border-slate-200",
        )}
      />
      {open && (
        <div className="absolute left-0 right-0 top-11 z-10 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-[var(--shadow-pop)]">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</div>
          ) : !results.length ? (
            <div className="px-3 py-3 text-sm text-slate-500">Sin resultados. Cree el cliente primero.</div>
          ) : (
            results.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setText("");
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50"
              >
                <Avatar name={c.fullName} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.fullName}</div>
                  <div className="text-xs text-slate-500">{formatPhone(c.phone)}</div>
                </div>
                <Check className="h-4 w-4 text-transparent" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
