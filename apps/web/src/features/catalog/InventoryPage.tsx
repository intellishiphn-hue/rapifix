import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownUp, Boxes, Package } from "lucide-react";
import { MOVEMENT_LABELS, type Product } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useAllActiveProducts, useMovements } from "./api";
import { MovementDialog } from "./ProductDialogs";
import { StockBadge } from "./ProductsPage";

export function InventoryPage() {
  const { can, role } = useAuth();
  const seeMoves = can("inventory.manage") || role === "reception";
  const products = useAllActiveProducts();
  const moves = useMovements(undefined, 40, seeMoves);
  const [moving, setMoving] = useState<Product | null>(null);
  const low = useMemo(() => products.data.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock), [products.data]);
  const units = products.data.reduce((a, p) => a + Math.max(0, p.stock), 0);
  const stock = can("inventory.manage");

  return (
    <>
      <PageHeader title="Inventario" description="Existencias, alertas de stock mínimo y movimientos." actions={<Link to="/productos"><Button variant="secondary" icon={<Package className="h-4 w-4" />}>Productos</Button></Link>} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {[["Productos activos", products.data.length, <Boxes key="b" className="h-5 w-5" />, "bg-brand-50 text-brand-600"], ["Unidades en existencia", units, <Package key="p" className="h-5 w-5" />, "bg-sky-50 text-sky-600"], ["Bajo mínimo o agotados", low.length, <AlertTriangle key="a" className="h-5 w-5" />, "bg-amber-50 text-amber-600"]].map(([l, v, icon, tone]) => (
          <Card key={String(l)} className="flex items-center justify-between p-5">
            <div><div className="text-sm text-slate-500">{l}</div>{products.loading ? <Skeleton className="mt-2 h-8 w-14" /> : <div className="tabular text-3xl font-bold">{v as number}</div>}</div>
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Reponer" description="Productos en o por debajo de su existencia mínima" />
          {products.error ? <ErrorState message={products.error} /> : !low.length ? <p className="p-5 text-sm text-slate-500">Todo en orden.</p> : (
            <ul className="divide-y divide-slate-100">
              {low.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{p.name}</div><div className="text-xs text-slate-500">Mínimo {p.minStock} · {p.supplier || "sin proveedor"}</div></div>
                  <StockBadge p={p} />
                  {stock && <Button size="sm" variant="secondary" icon={<ArrowDownUp className="h-4 w-4" />} onClick={() => setMoving(p)}>Entrada</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {seeMoves && <Card>
          <CardHeader title="Últimos movimientos" />
          {moves.error ? <ErrorState message={moves.error} /> : moves.loading ? <div className="p-5"><Skeleton className="h-40" /></div> : !moves.data.length ? <p className="p-5 text-sm text-slate-500">Sin movimientos todavía.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {moves.data.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                  <b className={`tabular w-12 text-right ${m.type === "out" || m.qty < 0 ? "text-red-600" : "text-emerald-700"}`}>{m.type === "out" ? `-${m.qty}` : m.qty > 0 ? `+${m.qty}` : m.qty}</b>
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.productName}</div><div className="truncate text-xs text-slate-500">{MOVEMENT_LABELS[m.type]} · {m.reason || "—"} · {m.byName}</div></div>
                  <span className="shrink-0 text-xs text-slate-400">{formatDate(m.at, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>}
      </div>
      <MovementDialog product={moving} onClose={() => setMoving(null)} />
    </>
  );
}
