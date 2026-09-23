import { Check, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { useStaffDirectory } from "./api";

export function TechnicianSelect({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { technicians, loading } = useStaffDirectory();
  if (loading) return <div className="text-sm text-slate-400">Cargando técnicos...</div>;
  if (!technicians.length) {
    return <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No hay usuarios con rol Técnico. Créelos en Usuarios y permisos.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {technicians.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
              on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
            )}
          >
            {on ? <Check className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5 text-slate-400" />}
            {t.displayName}
          </button>
        );
      })}
    </div>
  );
}
