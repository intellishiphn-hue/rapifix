import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileCheck2, Paperclip, Printer, X } from "lucide-react";
import { formatMoney, methodNeedsBank, type ManualPaymentMethod, type ReferralCommission, type Referrer } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MethodPicker } from "@/features/finance/parts";
import { uploadExpenseReceipt } from "@/features/finance/api";
import { useSettings } from "@/features/settings/api";
import { payCommissions, voidCommission } from "./api";

/** Pagar comisiones pendientes de un referido: queda el comprobante COM y un gasto "Comisiones". */
export function PayCommissionsDialog({ referrer, pending, onClose }: { referrer: Pick<Referrer, "id" | "name" | "paymentMethod">; pending: ReferralCommission[]; onClose: () => void }) {
  const { settings } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pending.map((c) => c.id)));
  const [method, setMethod] = useState<ManualPaymentMethod>(() => (/efectivo/i.test(referrer.paymentMethod ?? "") ? "cash" : "transfer"));
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ payoutId: string; code: string; amount: number; expenseCode: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => setSelected(new Set(pending.map((c) => c.id))), [pending]);

  const chosen = useMemo(() => pending.filter((c) => selected.has(c.id)), [pending, selected]);
  const total = chosen.reduce((a, c) => a + c.amount, 0);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setProgress(0);
    try {
      setReceipt(await uploadExpenseReceipt(f, setProgress));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
      if (file.current) file.current.value = "";
    }
  };

  const save = async () => {
    if (!chosen.length) return void toast.error("Seleccione al menos una comisión");
    if (methodNeedsBank(method) && !bank.trim()) return void toast.error("Indique de qué banco o cuenta salió el dinero");
    setSaving(true);
    try {
      const r = await payCommissions({
        referrerId: referrer.id, commissionIds: chosen.map((c) => c.id), method, reference: reference.trim(),
        ...(method !== "cash" && bank.trim() ? { bank: bank.trim() } : {}),
        ...(receipt ? { receiptPath: receipt } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(`Pago ${r.code} por ${formatMoney(r.amount)} registrado${r.expenseCode ? ` (gasto ${r.expenseCode})` : ""}`);
      setDone(r);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Dialog open onClose={onClose} size="sm" title="Comisiones pagadas" description={`${referrer.name} · ${formatMoney(done.amount)}`} footer={<Button onClick={onClose}>Listo</Button>}>
        <div className="space-y-3 text-sm text-slate-600">
          <p>Se registró el pago <b className="text-slate-900">{done.code}</b>{done.expenseCode ? <> y el gasto <b className="text-slate-900">{done.expenseCode}</b> en la categoría Comisiones, que Finanzas ya resta de la utilidad.</> : "."}</p>
          <a href={`/imprimir/comision/${done.payoutId}`} target="_blank" rel="noreferrer"><Button variant="secondary" className="w-full" icon={<Printer className="h-4 w-4" />}>Imprimir comprobante para {referrer.name.split(" ")[0]}</Button></a>
        </div>
      </Dialog>
    );
  }

  const banks = settings.bankAccounts ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Pagar comisiones a ${referrer.name}`}
      description={referrer.paymentMethod ? `Cómo se le paga: ${referrer.paymentMethod}` : "Seleccione las comisiones que va a pagar."}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={!chosen.length}>Pagar {formatMoney(total)}</Button></>}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
            <label className="flex items-center gap-2"><input type="checkbox" checked={selected.size === pending.length} onChange={(e) => setSelected(new Set(e.target.checked ? pending.map((c) => c.id) : []))} /> {chosen.length} de {pending.length} seleccionadas</label>
            <span className="tabular text-slate-900">{formatMoney(total)}</span>
          </div>
          <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto">
            {pending.map((c) => (
              <li key={c.id}>
                <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5", selected.has(c.id) && "bg-brand-50/40")}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{c.orderCode} <span className="font-normal text-slate-500">· {c.companyName || c.customerName}</span></div>
                    <div className="text-xs text-slate-500">Cobrada {formatDate(c.earnedAt)} · utilidad {formatMoney(c.profit)} × {c.pct}%{c.missingCostLines ? " · faltan costos" : ""}</div>
                  </div>
                  <span className="tabular text-sm font-semibold text-slate-900">{formatMoney(c.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        {chosen.some((c) => c.missingCostLines > 0) && (
          <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Algunas órdenes tienen repuestos sin costo registrado: la utilidad (y la comisión) puede salir más alta de lo real.</div>
        )}
        <Field label="Método"><MethodPicker value={method} onChange={setMethod} /></Field>
        {method !== "cash" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banco / cuenta de donde salió" required={methodNeedsBank(method)}>
              {banks.length ? (
                <Select value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option value="">Seleccione…</option>
                  {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              ) : <Input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} />}
            </Field>
            <Field label="Referencia"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
          </div>
        )}
        <Field label="Comprobante (opcional)" hint="Foto o PDF de la transferencia o del recibo firmado.">
          <div className="flex items-center gap-2">
            <input ref={file} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
            {receipt ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"><FileCheck2 className="h-4 w-4" /> Comprobante adjunto<button type="button" onClick={() => setReceipt(null)} className="rounded p-0.5 hover:bg-emerald-100" aria-label="Quitar comprobante"><X className="h-3 w-3" /></button></span>
            ) : (
              <button type="button" disabled={progress !== null} onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-60"><Paperclip className="h-4 w-4" />{progress !== null ? `Subiendo ${progress}%` : "Subir comprobante"}</button>
            )}
          </div>
        </Field>
        <Field label="Nota (opcional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} /></Field>
        <p className="text-xs text-slate-500">Se registra un gasto en la categoría <b>Comisiones</b> por el total, para que Finanzas lo reste de la utilidad.</p>
      </div>
    </Dialog>
  );
}

/** Anular una comisión pendiente o marcar como revisada una pagada con aviso (solo administración). */
export function VoidCommissionDialog({ commission, mode, onClose }: { commission: ReferralCommission; mode: "void" | "reviewed"; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await voidCommission({ commissionId: commission.id, action: mode, reason: reason.trim() });
      toast.success(mode === "void" ? "Comisión anulada" : "Aviso revisado");
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
      title={mode === "void" ? `Anular comisión de ${commission.orderCode}` : `Revisar aviso de ${commission.orderCode}`}
      description={`${commission.referrerName} · ${formatMoney(commission.amount)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant={mode === "void" ? "danger" : "primary"} onClick={() => void save()} loading={saving} disabled={reason.trim().length < 3}>{mode === "void" ? "Anular" : "Marcar revisada"}</Button></>}
    >
      <div className="space-y-3">
        {mode === "reviewed" && commission.reviewNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{commission.reviewNote}</p>}
        <Field label={mode === "void" ? "Motivo" : "Qué se hizo"} required hint={mode === "void" ? "La comisión no se vuelve a crear para esta orden." : "Ej. se descontó en el siguiente pago."}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}
