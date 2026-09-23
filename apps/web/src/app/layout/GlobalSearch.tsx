import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Car, Loader2, Search, User } from "lucide-react";
import { col, formatPhone, searchToken, type Customer, type Vehicle } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDebounced } from "@/lib/firestore/hooks";
import { formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";

type Result = { type: "customer" | "vehicle"; id: string; title: string; subtitle: string; to: string };

/** Búsqueda global: cliente, teléfono, placa, VIN, marca o modelo. (Órdenes se suman en Fase 2) */
export function GlobalSearch() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(text, 250);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Atajo: "/" o Cmd+K enfoca la búsqueda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const token = searchToken(debounced);
    if (token.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getDocs(query(collection(db, col.customers(TENANT_ID)), where("searchKeywords", "array-contains", token), limit(6))),
      getDocs(query(collection(db, col.vehicles(TENANT_ID)), where("searchKeywords", "array-contains", token), limit(6))),
    ])
      .then(([cs, vs]) => {
        if (cancelled) return;
        const customers: Result[] = cs.docs.map((d) => {
          const c = d.data() as Customer;
          return { type: "customer", id: d.id, title: c.fullName, subtitle: [formatPhone(c.phone), c.email].filter(Boolean).join(" · "), to: `/clientes/${d.id}` };
        });
        const vehicles: Result[] = vs.docs.map((d) => {
          const v = d.data() as Vehicle;
          return { type: "vehicle", id: d.id, title: `${formatPlate(v.plate)} · ${v.make} ${v.model} ${v.year}`, subtitle: v.customer?.fullName ?? "", to: `/vehiculos/${d.id}` };
        });
        setResults([...vehicles, ...customers]);
        setActive(0);
      })
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const go = (r: Result) => {
    navigate(r.to);
    setOpen(false);
    setText("");
    inputRef.current?.blur();
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && results[active]) go(results[active]);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Buscar placa, cliente, teléfono, VIN..."
        className="h-10 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-9 pr-12 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-400 sm:block">
        ⌘K
      </kbd>
      {open && text.trim().length >= 2 && (
        <div className="animate-pop absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-pop)]">
          {loading && !results.length ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-500">Sin resultados para "{text}"</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left", i === active && "bg-brand-50")}
                  >
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", r.type === "vehicle" ? "bg-sky-100 text-sky-700" : "bg-brand-100 text-brand-700")}>
                      {r.type === "vehicle" ? <Car className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{r.title}</span>
                      <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
