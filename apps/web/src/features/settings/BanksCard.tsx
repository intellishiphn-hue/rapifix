import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { settingsRef, useSettings } from "./api";

function ListEditor({ label, hint, items, onChange, placeholder }: { label: string; hint: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, 60);
    if (!v || items.some((i) => i.toLowerCase() === v.toLowerCase())) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-xs font-medium text-slate-700">
            {i}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== i))} className="rounded-full p-0.5 hover:bg-slate-200" aria-label={`Quitar ${i}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!items.length && <span className="text-xs text-slate-400">Ninguno</span>}
      </div>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} maxLength={60} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={add}>Agregar</Button>
      </div>
    </div>
  );
}

/** Bancos/cuentas donde entran transferencias y depósitos, y terminales POS de tarjeta. */
export function BanksCard() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [banks, setBanks] = useState<string[]>([]);
  const [terminals, setTerminals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const key = JSON.stringify([settings.bankAccounts, settings.cardTerminals]);
  useEffect(() => {
    setBanks(settings.bankAccounts ?? []);
    setTerminals(settings.cardTerminals ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const dirty = JSON.stringify([banks, terminals]) !== key;

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(settingsRef(), { bankAccounts: banks, cardTerminals: terminals, updatedAt: serverTimestamp(), updatedBy: user.uid }, { merge: true });
      toast.success("Bancos y terminales guardados");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Bancos y terminales" description="Aparecen al registrar pagos por transferencia, depósito o tarjeta, y en Finanzas para cuadrar con el banco." />
      <div className="space-y-5 p-5">
        <ListEditor label="Cuentas bancarias" hint="Puede poner el banco o la cuenta, ej. 'BAC ahorro 1234'." items={banks} onChange={setBanks} placeholder="Ej. BAC Credomatic" />
        <ListEditor label="Terminales de tarjeta (POS)" hint="Con qué terminal se pasó la tarjeta." items={terminals} onChange={setTerminals} placeholder="Ej. ROKI" />
        <Button className="w-full" onClick={() => void save()} loading={saving} disabled={!dirty}>Guardar bancos y terminales</Button>
      </div>
    </Card>
  );
}
