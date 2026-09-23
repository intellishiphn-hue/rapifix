import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Pencil, Plus, Search, Truck } from "lucide-react";
import { formatMoney, type Supplier } from "@rapifix/shared";
import { useDebounced } from "@/lib/firestore/hooks";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useSuppliers } from "./api";
import { StatCard, SupplierFormDialog } from "./parts";

export function SuppliersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const debounced = useDebounced(search, 300);
  const { data, loading, error } = useSuppliers(debounced, inactive);
  const totalDue = data.reduce((a, s) => a + Math.max(0, s.balanceDue ?? 0), 0);
  const withDebt = data.filter((s) => (s.balanceDue ?? 0) > 0).length;

  return (
    <>
      <PageHeader title="Proveedores" description="Quién le vende al taller, sus datos de contacto y cuánto se les debe." actions={<>
        <Button variant="secondary" onClick={() => navigate("/compras")}>Ver compras</Button>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo proveedor</Button>
      </>} />
      {!debounced && data.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Por pagar a proveedores" value={formatMoney(totalDue)} tone={totalDue > 0 ? "amber" : undefined} />
          <StatCard label="Proveedores con saldo" value={withDebt} hint={`de ${data.length} ${inactive ? "en total" : "activos"}`} />
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, contacto, RTN o teléfono..." className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Mostrar inactivos</label>
        </div>
        {error ? <ErrorState message={error} /> : loading && !data.length ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<Truck className="h-7 w-7" />} title={debounced ? "Sin resultados" : "Todavía no hay proveedores"} description="Registre a quienes le venden repuestos, aceites e insumos para llevar sus compras y cuentas por pagar." action={!debounced && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo proveedor</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-3 px-5 py-3", !s.active && "opacity-60")}>
                <Link to={`/proveedores/${s.id}`} className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-slate-900">{s.name}</span>
                      {!s.active && <Badge>Inactivo</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">{[s.contactName, s.phone, s.categories, s.creditDays ? `Crédito ${s.creditDays} días` : "Contado"].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="sm:w-40 sm:text-right">
                    {(s.balanceDue ?? 0) > 0 ? (
                      <>
                        <div className="text-[11px] uppercase tracking-wide text-slate-400 sm:hidden">Por pagar</div>
                        <span className="tabular font-bold text-amber-700">{formatMoney(s.balanceDue)}</span>
                      </>
                    ) : <span className="text-xs text-slate-400">Sin saldo</span>}
                  </div>
                </Link>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(s)} aria-label="Editar" />
                <Link to={`/proveedores/${s.id}`} className="hidden text-slate-400 sm:block" aria-label="Ver detalle"><ChevronRight className="h-5 w-5" /></Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SupplierFormDialog open={editing !== undefined} supplier={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}
