import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { useDebounced } from "@/lib/firestore/hooks";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useVehicles, type VehicleFilter } from "./api";
import { VehicleCard } from "./VehicleCard";
import { VehicleFormDialog } from "./VehicleFormDialog";

const PAGE = 24;

export function VehiclesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VehicleFilter>("active");
  const [pageSize, setPageSize] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search, 300);
  const { data, loading, error, hasMore } = useVehicles({ search: debounced, filter, pageSize });
  const canWrite = can("vehicles.write");

  return (
    <>
      <PageHeader
        title="Vehículos"
        description="Todos los vehículos registrados con su propietario e historial."
        actions={canWrite && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo vehículo</Button>}
      />
      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPageSize(PAGE); }} placeholder="Buscar por placa, marca, modelo, VIN o propietario..." className="pl-9" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as VehicleFilter)} className="sm:w-44">
          <option value="active">Activos</option>
          <option value="archived">Archivados</option>
        </Select>
      </Card>

      {error ? (
        <ErrorState message={error} />
      ) : loading && !data.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[90px]" />)}</div>
      ) : !data.length ? (
        <Card>
          <EmptyState
            icon={<Car className="h-7 w-7" />}
            title={debounced ? "Sin resultados" : "Todavía no hay vehículos"}
            description={debounced ? "Pruebe con otra placa o modelo." : "Registre el primer vehículo de un cliente."}
            action={!debounced && canWrite && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo vehículo</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((v) => <VehicleCard key={v.id} vehicle={v} />)}
          </div>
          {hasMore && (
            <div className="mt-4 text-center">
              <Button variant="secondary" loading={loading} onClick={() => setPageSize((p) => p + PAGE)}>Cargar más</Button>
            </div>
          )}
        </>
      )}

      <VehicleFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/vehiculos/${id}`)} />
    </>
  );
}
