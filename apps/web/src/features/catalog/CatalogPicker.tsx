import { useEffect, useState } from "react";
import { Loader2, Package, Plus, Search, Wrench } from "lucide-react";
import { formatMoney, type Product, type Service } from "@rapifix/shared";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import { searchCatalog } from "./api";

export type CatalogPick = { kind: "product"; item: Product } | { kind: "service"; item: Service };

/** Buscador de productos y servicios del catálogo. */
export function CatalogPicker({ open, onClose, onPick, only, onCreateNew }: { open: boolean; onClose: () => void; onPick: (p: CatalogPick) => void; only?: "product" | "service"; /** Muestra "Crear producto nuevo" con el texto buscado */ onCreateNew?: (text: string) => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<{ products: Product[]; services: Service[] }>({ products: [], services: [] });
  const debounced = useDebounced(text, 250);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    searchCatalog(debounced)
      .then((r) => !cancelled && setRes(r))
      .catch(() => !cancelled && setRes({ products: [], services: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const products = only === "service" ? [] : res.products;
  const services = only === "product" ? [] : res.services;

  return (
    <Dialog open={open} onClose={onClose} title="Agregar del catálogo" description="Busque por nombre, código, marca o categoría.">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej. filtro de aceite, pastillas, alineado..." className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
      </div>
      <div className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto">
        {loading && <div className="flex items-center gap-2 p-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</div>}
        {onCreateNew && (
          <button onClick={() => { onCreateNew(text.trim()); onClose(); }} className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-3 text-left hover:border-brand-400">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"><Plus className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-brand-800">Crear producto nuevo{text.trim() ? `: "${text.trim()}"` : ""}</span>
              <span className="block text-xs text-slate-500">Se agrega al inventario y a esta compra de una vez</span>
            </span>
          </button>
        )}
        {!loading && !products.length && !services.length && <p className="p-3 text-sm text-slate-500">{onCreateNew ? "Sin resultados. Créelo con el botón de arriba." : "Sin resultados. Puede crear el producto o servicio en su módulo."}</p>}
        {products.map((p) => (
          <button key={p.id} onClick={() => { onPick({ kind: "product", item: p }); onClose(); }} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50/40">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Package className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="block text-xs text-slate-500">{[p.sku, p.brand, p.category].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="text-right text-sm">
              <span className="tabular block font-semibold">{formatMoney(p.price)}</span>
              <span className={cn("block text-xs", p.stock <= 0 ? "text-red-600" : p.stock <= p.minStock ? "text-amber-700" : "text-slate-500")}>Existencia: {p.stock}</span>
            </span>
          </button>
        ))}
        {services.map((s) => (
          <button key={s.id} onClick={() => { onPick({ kind: "service", item: s }); onClose(); }} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50/40">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><Wrench className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{s.name}</span>
              <span className="block text-xs text-slate-500">{[s.code, s.category, s.estimatedHours ? `${s.estimatedHours} h` : ""].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="tabular text-sm font-semibold">{formatMoney(s.price)}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
