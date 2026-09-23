import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { Car, Loader2, Search, X } from "lucide-react";
import { col, searchToken, type Vehicle } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDebounced } from "@/lib/firestore/hooks";
import { formatKm } from "@/lib/format";
import { PlateTag } from "@/features/vehicles/VehicleCard";

export function VehiclePicker({ value, onChange }: { value: Vehicle | null; onChange: (v: Vehicle | null) => void }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(text, 250);

  useEffect(() => {
    if (value) return;
    const token = searchToken(debounced);
    let cancelled = false;
    setLoading(true);
    const base = collection(db, col.vehicles(TENANT_ID));
    const q = token.length >= 2
      ? query(base, where("searchKeywords", "array-contains", token), limit(8))
      : query(base, where("archived", "==", false), orderBy("createdAt", "desc"), limit(6));
    getDocs(q)
      .then((s) => !cancelled && setResults(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle).filter((v) => !v.archived)))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, value]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-brand-500 bg-brand-50/50 p-3">
        <div className="flex h-12 w-14 items-center justify-center overflow-hidden rounded-lg bg-white text-slate-400">
          {value.coverPhotoUrl ? <img src={value.coverPhotoUrl} alt="" className="h-full w-full object-cover" /> : <Car className="h-6 w-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-semibold">{value.make} {value.model} {value.year} <PlateTag plate={value.plate} /></div>
          <div className="text-sm text-slate-600">{value.customer?.fullName} · {formatKm(value.mileage)}</div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white" aria-label="Cambiar vehículo">
          <X className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          placeholder="Escriba la placa, el dueño o el modelo..."
          className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
        />
      </div>
      <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</div>
        ) : !results.length ? (
          <div className="p-3 text-sm text-slate-500">No se encontró el vehículo. Regístrelo con los botones de abajo.</div>
        ) : (
          results.map((v) => (
            <button key={v.id} type="button" onClick={() => onChange(v)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-brand-400 hover:bg-brand-50/40">
              <PlateTag plate={v.plate} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{v.make} {v.model} {v.year}</div>
                <div className="truncate text-xs text-slate-500">{v.customer?.fullName}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
