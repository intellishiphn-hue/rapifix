import { useEffect, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Car, Loader2, Search, User } from "lucide-react";
import { col, formatPhone, searchToken, type Customer, type Vehicle } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDebounced } from "@/lib/firestore/hooks";
import { PlateTag } from "@/features/vehicles/VehicleCard";

export type SearchPick = { kind: "vehicle"; vehicle: Vehicle } | { kind: "customer"; customer: Customer };

/** Busca vehículos (placa, modelo, dueño) y clientes (nombre, teléfono) por searchKeywords. */
export function ClientSearch({ onPick, vehiclesOnly, autoFocus }: { onPick: (p: SearchPick) => void; vehiclesOnly?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const debounced = useDebounced(text, 250);
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    const token = searchToken(debounced);
    if (token.length < 2) {
      setVehicles([]);
      setCustomers([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getDocs(query(collection(db, col.vehicles(TENANT_ID)), where("searchKeywords", "array-contains", token), limit(8))),
      vehiclesOnly ? null : getDocs(query(collection(db, col.customers(TENANT_ID)), where("searchKeywords", "array-contains", token), limit(6))).catch(() => null),
    ])
      .then(([vs, cs]) => {
        if (cancelled) return;
        setVehicles(vs.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle).filter((v) => !v.archived));
        setCustomers((cs?.docs ?? []).map((d) => ({ id: d.id, ...d.data() }) as Customer));
      })
      .catch(() => {
        if (!cancelled) {
          setVehicles([]);
          setCustomers([]);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, vehiclesOnly]);

  const searching = searchToken(debounced).length >= 2;

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          placeholder={vehiclesOnly ? "Placa, modelo o dueño..." : "Placa, nombre del cliente o teléfono..."}
          className="h-10 w-full rounded-[10px] border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
        />
      </div>
      {searching && (
        <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 p-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</div>
          ) : !vehicles.length && !customers.length ? (
            <div className="p-2 text-sm text-slate-500">Sin resultados.</div>
          ) : (
            <>
              {vehicles.map((v) => (
                <button key={v.id} type="button" onClick={() => onPick({ kind: "vehicle", vehicle: v })} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-brand-400 hover:bg-brand-50/40">
                  <Car className="h-4 w-4 shrink-0 text-slate-400" />
                  <PlateTag plate={v.plate} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{v.make} {v.model} {v.year}</span>
                    <span className="block truncate text-xs text-slate-500">{v.customer?.fullName}</span>
                  </span>
                </button>
              ))}
              {customers.map((c) => (
                <button key={c.id} type="button" onClick={() => onPick({ kind: "customer", customer: c })} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left hover:border-brand-400 hover:bg-brand-50/40">
                  <User className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.fullName}</span>
                    <span className="block truncate text-xs text-slate-500">{formatPhone(c.whatsapp || c.phone)}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
