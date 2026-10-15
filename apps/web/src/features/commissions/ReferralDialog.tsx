import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HandHeart, Pencil, Plus, Trash2 } from "lucide-react";
import { DEFAULT_COMMISSION_PCT, hnDayKey, isReferralActive, referralLabel, type Referral } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Link } from "react-router-dom";
import { setReferral } from "@/features/companies/api";
import { useReferrers } from "./api";
import { ReferrerFormDialog } from "./ReferrerFormDialog";

/** Quién gana comisión por esta empresa o cliente. Editar solo administración o gerencia. */
export function ReferralDialog({ open, onClose, target, targetId, targetName, current }: {
  open: boolean;
  onClose: () => void;
  target: "company" | "customer";
  targetId: string;
  targetName: string;
  current: Referral | null | undefined;
}) {
  const referrers = useReferrers(open);
  const [referrerId, setReferrerId] = useState("");
  const [pct, setPct] = useState(String(DEFAULT_COMMISSION_PCT));
  const [start, setStart] = useState(hnDayKey(Date.now()));
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReferrerId(current?.referrerId ?? "");
    setPct(String(current?.pct ?? DEFAULT_COMMISSION_PCT));
    setStart(current?.startDate ?? hnDayKey(Date.now()));
    setEnd(current?.endDate ?? "");
  }, [open, current]);

  const active = useMemo(() => referrers.data.filter((r) => r.active || r.id === referrerId), [referrers.data, referrerId]);

  const save = async (remove = false) => {
    const n = Number(pct);
    if (!remove) {
      if (!referrerId) return void toast.error("Seleccione quién refirió");
      if (!(n >= 0.1 && n <= 50)) return void toast.error("El porcentaje debe ser entre 0.1% y 50%");
      if (end && end < start) return void toast.error("La fecha de fin no puede ser antes del inicio");
    }
    setSaving(true);
    try {
      await setReferral({
        target, targetId,
        referral: remove ? null : { referrerId, pct: n, basis: "profit", startDate: start, endDate: end || null },
      });
      toast.success(remove ? "Comisión quitada" : "Comisión guardada");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !creating}
        onClose={onClose}
        size="sm"
        title="Comisión por referido"
        description={`Quién gana comisión por ${targetName}.`}
        footer={
          <>
            {current && <Button variant="ghost" className="text-red-600 sm:mr-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => void save(true)} disabled={saving}>Quitar</Button>}
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => void save()} loading={saving}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Referido por" required>
            <div className="flex gap-2">
              <Select
                value={referrerId}
                onChange={(e) => {
                  setReferrerId(e.target.value);
                  const r = referrers.data.find((x) => x.id === e.target.value);
                  if (r && !current) setPct(String(r.defaultPct ?? DEFAULT_COMMISSION_PCT));
                }}
              >
                <option value="">{referrers.loading ? "Cargando…" : "Seleccione…"}</option>
                {active.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} aria-label="Nuevo referido" title="Nuevo referido" />
            </div>
          </Field>
          <Field label="Comisión (% de la utilidad)" hint="Se calcula sobre la utilidad de cada orden (ingreso sin ISV menos costo), al quedar pagada completa.">
            <Input type="number" min={0.1} max={50} step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde"><Input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
            <Field label="Hasta" hint="Vacío = indefinido"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <p className="text-xs text-slate-500">Aplica a órdenes del taller. Las ventas del carwash y del punto de venta no generan comisión.</p>
        </div>
      </Dialog>
      <ReferrerFormDialog open={creating} onClose={(id) => { setCreating(false); if (id) setReferrerId(id); }} />
    </>
  );
}

/** Tarjeta "Referido por" para la ficha de la empresa o del cliente. */
export function ReferralCard({ target, targetId, targetName, referral }: { target: "company" | "customer"; targetId: string; targetName: string; referral: Referral | null | undefined }) {
  const { role } = useAuth();
  const canEdit = role === "admin" || role === "manager";
  const [open, setOpen] = useState(false);
  if (!referral && !canEdit) return null;
  const vigente = referral ? isReferralActive(referral, Date.now()) : false;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><HandHeart className="h-4 w-4 text-brand-600" /> Referido por</span>}
        action={canEdit && <Button size="sm" variant="ghost" icon={referral ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>{referral ? "Cambiar" : "Asignar"}</Button>}
      />
      <div className="px-5 py-4 text-sm">
        {referral ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? <Link to={`/referidos/${referral.referrerId}`} className="font-semibold text-slate-900 hover:text-brand-700">{referral.referrerName}</Link> : <span className="font-semibold text-slate-900">{referral.referrerName}</span>}
              <Badge tone={vigente ? "green" : "gray"}>{vigente ? "Vigente" : "No vigente"}</Badge>
            </div>
            <div className="mt-1 text-slate-600">{referralLabel(referral)}</div>
            <div className="mt-0.5 text-xs text-slate-500">Desde {referral.startDate.split("-").reverse().join("/")}</div>
          </>
        ) : (
          <p className="text-slate-500">Nadie gana comisión por {target === "company" ? "esta empresa" : "este cliente"}.</p>
        )}
      </div>
      {canEdit && <ReferralDialog open={open} onClose={() => setOpen(false)} target={target} targetId={targetId} targetName={targetName} current={referral} />}
    </Card>
  );
}
