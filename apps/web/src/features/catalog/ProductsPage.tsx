import { useState } from "react";
import { ArrowDownUp, Package, Pencil, Plus, Search } from "lucide-react";
import { formatMoney, type Product } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useProducts } from "./api";
import { MovementDialog, ProductFormDialog } from "./ProductDialogs";

export function StockBadge({ p }: { p: Product }) {
  if (p.stock <= 0) return <Badge tone="red">Agotado</Badge>;
  if (p.stock <= p.minStock) return <Badge tone="amber">Bajo: {p.stock}</Badge>;
  return <Badge tone="green">{p.stock} {p.unit}</Badge>;
}

export function ProductsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [moving, setMoving] = useState<Product | null>(null);
  const debounced = useDebounced(search, 300);
  const { data, loading, error, hasMore } = useProducts({ search: debounced, showInactive: inactive, pageSize });
  const manage = can("catalog.manage");
  const stock = can("inventory.manage");

  return (
    <>
      <PageHeader title="Productos y repuestos" description="Catálogo con precios y existencias. Se usan en cotizaciones y en el punto de venta." actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo producto</Button>} />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, código, marca, categoría..." className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Mostrar inactivos</label>
        </div>
        {error ? <ErrorState message={error} /> : loading && !data.length ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<Package className="h-7 w-7" />} title={debounced ? "Sin resultados" : "Todavía no hay productos"} description="Registre repuestos, aceites, filtros y todo lo que vende o usa el taller." action={!debounced && manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo producto</Button>} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.map((p) => (
                <li key={p.id} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", !p.active && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-500">{[p.sku, p.brand, p.category, p.location && `📍 ${p.location}`].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StockBadge p={p} />
                    <span className="tabular w-28 text-right font-semibold">{formatMoney(p.price)}</span>
                    {stock && <Button size="sm" variant="secondary" icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setMoving(p)}>Movimiento</Button>}
                    {manage && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(p)} aria-label="Editar" />}
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && <div className="border-t border-slate-100 p-3 text-center"><Button variant="ghost" onClick={() => setPageSize((n) => n + 50)}>Cargar más</Button></div>}
          </>
        )}
      </Card>
      <ProductFormDialog open={editing !== undefined} onClose={() => setEditing(undefined)} product={editing} />
      <MovementDialog product={moving} onClose={() => setMoving(null)} />
    </>
  );
}
