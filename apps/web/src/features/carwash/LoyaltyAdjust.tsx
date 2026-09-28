import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, SlidersHorizontal } from "lucide-react";
import { adjustLoyaltyStamps as previewAdjust, type CarwashLoyalty } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { adjustLoyaltyStamps } from "./api";
import { Stamps } from "./RegisterWashDialog";

/** Solo administración y gerencia ajustan sellos. */
export function useCanAdjustStamps() {
  const { can } = useAuth();
  return can("carwash.manage");
}

/** Botón "Ajustar sellos" (solo admin/gerencia) que abre el diálogo. */
export function AdjustStampsButton({ loyalty, every, size = "sm" }: { loyalty: CarwashLoyalty | null; every: number; size?: "sm" | "md" }) {
  const allowed = useCanAdjustStamps();
  const [open, setOpen] = useState(false);
  if (!allowed || !loyalty || !(every > 0)) return null;
  return (
    <>
      <Button size={size} variant="secondary" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setOpen(true)}>Ajustar sellos</Button>
      {open && <AdjustStampsDialog loyalty={loyalty} every={every} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AdjustStampsDialog({ loyalty, every, onClose }: { loyalty: CarwashLoyalty; every: number; onClose: () => void }) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDelta(1);
    setReason("");
  }, [loyalty.id]);
  const count = loyalty.count ?? 0;
  const preview = previewAdjust({ count, rewardsAvailable: loyalty.rewardsAvailable ?? 0 }, delta, every);
  const history = [...(loyalty.adjustments ?? [])].sort((a, b) => b.at - a.at).slice(0, 5);

  const save = async () => {
    if (!delta) return toast.error("Indique cuántos sellos sumar o quitar");
    if (reason.trim().length < 3) return toast.error("Indique el motivo");
    setSaving(true);
    try {
      const r = await adjustLoyaltyStamps({ plate: loyalty.id, delta, reason: reason.trim() });
      toast.success(`Tarjeta ${formatPlate(loyalty.id)}: ${r.count} de ${every} sellos${r.rewardsEarned ? `. Ganó ${r.rewardsEarned === 1 ? "un lavado gratis" : `${r.rewardsEarned} lavados gratis`}` : ""}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Ajustar sellos"
      description={`Placa ${formatPlate(loyalty.id)}${loyalty.customerName ? ` · ${loyalty.customerName}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()} loading={saving}>Guardar ajuste</Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="mb-1.5 font-medium text-slate-700">Ahora: {count} de {every}{loyalty.rewardsAvailable ? ` · ${loyalty.rewardsAvailable} premio(s) disponible(s)` : ""}</div>
          <Stamps count={count} every={every} />
        </div>
        <Field label="Sellos a sumar (o quitar)" hint="Use números negativos para quitar. Nunca baja de 0 ni quita premios ya ganados.">
          <div className="flex items-center gap-2">
            <Button variant="secondary" aria-label="Quitar uno" onClick={() => setDelta((d) => Math.max(-100, d - 1 === 0 ? -1 : d - 1))} icon={<Minus className="h-4 w-4" />} />
            <Input
              type="number"
              inputMode="numeric"
              value={delta}
              onChange={(e) => setDelta(Math.max(-100, Math.min(100, Math.trunc(Number(e.target.value) || 0))))}
              className="w-24 text-center"
            />
            <Button variant="secondary" aria-label="Sumar uno" onClick={() => setDelta((d) => Math.min(100, d + 1 === 0 ? 1 : d + 1))} icon={<Plus className="h-4 w-4" />} />
          </div>
        </Field>
        {delta !== 0 && (
          <p className="rounded-lg bg-brand-50 p-2.5 text-brand-800">
            Quedará en {preview.count} de {every}
            {preview.rewardsEarned > 0 ? ` y gana ${preview.rewardsEarned === 1 ? "un lavado gratis" : `${preview.rewardsEarned} lavados gratis`}` : ""}.
          </p>
        )}
        <Field label="Motivo" required hint="Ej.: promoción de inauguración, corrección de un sello no contado.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} />
        </Field>
        {history.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ajustes anteriores</div>
            <ul className="space-y-1 text-xs text-slate-600">
              {history.map((h, i) => (
                <li key={i}>
                  <b className={h.delta > 0 ? "text-emerald-700" : "text-red-600"}>{h.delta > 0 ? `+${h.delta}` : h.delta}</b> · {h.reason} · {h.byName} · {formatDate(new Date(h.at), true)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
