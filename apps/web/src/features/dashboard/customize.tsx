import { useMemo, useState, type ReactNode } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, RotateCcw } from "lucide-react";
import { db } from "@/lib/firebase";
import { useDocData } from "@/lib/firestore/hooks";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";

export interface DashSection {
  id: string;
  label: string;
  /** si el rol puede ver esta sección */
  show: boolean;
  node: ReactNode;
}

interface Prefs { order: string[]; hidden: string[] }

/** Orden y secciones ocultas del Dashboard, por usuario (se guarda en userPrefs/{uid}, en todos sus equipos). */
export function useDashboardPrefs(uid: string | undefined) {
  const { data } = useDocData<{ id: string; dashboard?: Prefs }>(uid ? doc(db, "userPrefs", uid) : null, `userPrefs-${uid}`);
  const prefs: Prefs = { order: data?.dashboard?.order ?? [], hidden: data?.dashboard?.hidden ?? [] };
  const save = async (next: Prefs) => {
    if (!uid) return;
    try {
      await setDoc(doc(db, "userPrefs", uid), { dashboard: { order: next.order.slice(0, 40), hidden: next.hidden.slice(0, 40) }, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return { prefs, save };
}

export function arrange(sections: DashSection[], prefs: Prefs): DashSection[] {
  const available = sections.filter((s) => s.show);
  const pos = new Map(prefs.order.map((id, i) => [id, i]));
  const defaultPos = new Map(available.map((s, i) => [s.id, i]));
  // Las secciones nuevas (que no están en el orden guardado) quedan en su lugar de fábrica
  return [...available].sort((a, b) => (pos.get(a.id) ?? 1000 + defaultPos.get(a.id)!) - (pos.get(b.id) ?? 1000 + defaultPos.get(b.id)!));
}

/** Panel para subir, bajar, ocultar o mostrar las secciones del Dashboard. */
export function DashboardCustomizer({ sections, prefs, onSave, onDone }: { sections: DashSection[]; prefs: Prefs; onSave: (p: Prefs) => Promise<void>; onDone: () => void }) {
  const ordered = useMemo(() => arrange(sections, prefs), [sections, prefs]);
  const [list, setList] = useState(ordered.map((s) => s.id));
  const [hidden, setHidden] = useState<string[]>(prefs.hidden);
  const byId = new Map(sections.map((s) => [s.id, s]));

  const persist = (nextList: string[], nextHidden: string[]) => {
    setList(nextList);
    setHidden(nextHidden);
    void onSave({ order: nextList, hidden: nextHidden });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    persist(next, hidden);
  };
  const toggle = (id: string) => persist(list, hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  const reset = () => persist(sections.filter((s) => s.show).map((s) => s.id), []);

  return (
    <Card className="border-brand-200 ring-2 ring-brand-100">
      <CardHeader
        title="Personalizar el Dashboard"
        description="Suba lo más importante para usted y oculte lo que no usa. Se guarda en su usuario."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>Restablecer</Button>
            <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={onDone}>Listo</Button>
          </div>
        }
      />
      <ul className="divide-y divide-slate-100">
        {list.map((id, i) => {
          const s = byId.get(id);
          if (!s) return null;
          const off = hidden.includes(id);
          return (
            <li key={id} className={cn("flex items-center gap-2 px-5 py-2.5", off && "bg-slate-50")}>
              <span className="tabular w-6 text-xs text-slate-400">{i + 1}</span>
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", off ? "text-slate-400 line-through" : "text-slate-800")}>{s.label}</span>
              <Button size="sm" variant="ghost" icon={<ArrowUp className="h-4 w-4" />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir" title="Subir" />
              <Button size="sm" variant="ghost" icon={<ArrowDown className="h-4 w-4" />} disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Bajar" title="Bajar" />
              <Button size="sm" variant={off ? "secondary" : "ghost"} icon={off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => toggle(id)}>
                {off ? "Oculta" : "Visible"}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
