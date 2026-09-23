import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Car, ChevronRight, Phone, Plus, Search, Users } from "lucide-react";
import { formatPhone } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { useDebounced } from "@/lib/firestore/hooks";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Avatar } from "@/components/common/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useCustomers, type StatusFilter } from "./api";
import { CustomerFormDialog } from "./CustomerFormDialog";

const PAGE = 25;

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [pageSize, setPageSize] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search, 300);
  const { data, loading, error, hasMore } = useCustomers({ search: debounced, status, pageSize });
  const canWrite = can("customers.write");

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Personas y empresas que traen sus vehículos a RAPIFIX."
        actions={canWrite && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo cliente</Button>}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPageSize(PAGE); }} placeholder="Buscar por nombre, teléfono, identidad, correo..." className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="sm:w-44">
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </Select>
        </div>

        {error ? (
          <ErrorState message={error} />
        ) : loading && !data.length ? (
          <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !data.length ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={debounced ? "Sin resultados" : "Todavía no hay clientes"}
            description={debounced ? "Pruebe con otro nombre, teléfono o identidad." : "Registre su primer cliente para empezar."}
            action={!debounced && canWrite && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo cliente</Button>}
          />
        ) : (
          <>
            {/* Tabla en escritorio */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Cliente</th>
                    <th className="px-5 py-3">Contacto</th>
                    <th className="px-5 py-3">Ciudad</th>
                    <th className="px-5 py-3 text-center">Vehículos</th>
                    <th className="px-5 py-3">Registro</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/clientes/${c.id}`)} className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.fullName} />
                          <div>
                            <div className="font-semibold text-slate-900">{c.fullName}</div>
                            {c.status === "inactive" && <Badge tone="gray">Inactivo</Badge>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="tabular text-slate-800">{formatPhone(c.phone)}</div>
                        <div className="text-xs text-slate-500">{c.email}</div>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{c.city}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          <Car className="h-3 w-3" /> {c.vehicleCount ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(c.createdAt)}</td>
                      <td className="px-5 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Tarjetas en celular */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.map((c) => (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                    <Avatar name={c.fullName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{c.fullName}</div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{formatPhone(c.phone)}</span>
                        <span className="inline-flex items-center gap-1"><Car className="h-3 w-3" />{c.vehicleCount ?? 0}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="ghost" loading={loading} onClick={() => setPageSize((p) => p + PAGE)}>Cargar más</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <CustomerFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/clientes/${id}`)} />
    </>
  );
}
