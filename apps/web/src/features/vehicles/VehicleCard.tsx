import { Link } from "react-router-dom";
import { Car, Gauge } from "lucide-react";
import type { Vehicle } from "@rapifix/shared";
import { formatKm, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";

export function PlateTag({ plate, className }: { plate: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border-2 border-slate-800 bg-white px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-slate-900", className)}>
      {formatPlate(plate)}
    </span>
  );
}

export function VehicleCard({ vehicle, showOwner = true }: { vehicle: Vehicle; showOwner?: boolean }) {
  return (
    <Link to={`/vehiculos/${vehicle.id}`} className="group flex gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-[var(--shadow-card)]">
      <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
        {vehicle.coverPhotoUrl ? <img src={vehicle.coverPhotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Car className="h-7 w-7" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate font-semibold text-slate-900 group-hover:text-brand-700">
            {vehicle.make} {vehicle.model} <span className="font-normal text-slate-500">{vehicle.year}</span>
          </div>
          <PlateTag plate={vehicle.plate} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />{formatKm(vehicle.mileage)}</span>
          {vehicle.color && <span>{vehicle.color}</span>}
          {showOwner && <span className="truncate">{vehicle.customer?.fullName}</span>}
        </div>
      </div>
    </Link>
  );
}
