import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileCheck2, MessageCircle, Paperclip, Printer, X } from "lucide-react";
import { formatMoney, methodNeedsBank, whatsappLink, type ManualPaymentMethod, type TechEarning, type TechPayout } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MethodPicker } from "@/features/finance/parts";
import { uploadExpenseReceipt } from "@/features/finance/api";
import { useSettings } from "@/features/settings/api";
import { payTechEarnings, reviewTechEarning } from "./api";
import { earningLineText } from "./format";

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Mensaje de WhatsApp para el empleado con lo que se le pagó. */
export function payoutMessage(p: Pick<TechPayout, "code" | "employeeName" | "amount" | "orderCodes">, workshop: string) {
  return `Hola ${firstName(p.employeeName)}, te registramos el pago ${p.code} por ${formatMoney(p.amount)} de tus trabajos en ${workshop}: órdenes ${p.orderCodes.join(", ")}. Gracias por tu trabajo.`;
}

/** Mensaje de WhatsApp con el resumen de lo pendiente y lo pagado en el período. */
export function summaryMessage(name: string, workshop: string, periodLabel: string, pending: TechEarning[], paidInPeriod: number) {
  const total = pending.reduce((a, e) => a + e.total, 0);
  const lines = pending.slice(0, 15).map((e) => `- ${e.orderCode} (${e.plate || e.vehicleLabel}): ${formatMoney(e.total)}`);
  return [
    `Hola ${firstName(name)}, este es el resumen de tus trabajos en ${workshop}.`,
    pending.length ? `Pendiente por pagarte: ${formatMoney(total)} (${pending.length} ${pending.length === 1 ? "orden" : "órdenes"})` : "No tienes trabajos pendientes de pago.",
    ...lines,
    pending.length > 15 ? `y ${pending.length - 15} más.` : "",
    paidInPeriod > 0 ? `Pagado en ${periodLabel.toLowerCase()}: ${formatMoney(paidInPeriod)}.` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Registrar el pago de trabajos pendientes de un empleado: queda el comprobante PT y un gasto
 * "Pago a técnicos" (que Finanzas no vuelve a restar: ya está en el costo de cada orden).
 */
export function PayTechDialog({ employee, pending, preselect, phone, onClose }: {
  employee: { id: string; name: string };
  pending: TechEarning[];
  /** ids marcados al abrir (por defecto los del período) */
  preselect?: string[];
  phone?: string;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect?.length ? preselect : pending.map((e) => e.id)));
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ payoutId: string; code: string; amount: number; expenseCode: string; orderCodes: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => pending.filter((e) => selected.has(e.id)), [pending, selected]);
  const total = chosen.reduce((a, e) => a + e.total, 0);
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
    if (!chosen.length) return void toast.error("Seleccione al menos un trabajo");
    if (methodNeedsBank(method) && !bank.trim()) return void toast.error("Indique de qué banco o cuenta salió el dinero");
    setSaving(true);
    try {
      const r = await payTechEarnings({
        employeeId: employee.id, earningIds: chosen.map((e) => e.id), method, reference: reference.trim(),
        ...(method !== "cash" && bank.trim() ? { bank: bank.trim() } : {}),
        ...(receipt ? { receiptPath: receipt } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success(`Pago ${r.code} por ${formatMoney(r.amount)} registrado${r.expenseCode ? ` (gasto ${r.expenseCode})` : ""}`);
      setDone({ ...r, orderCodes: chosen.map((e) => e.orderCode) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    const msg = payoutMessage({ code: done.code, employeeName: employee.name, amount: done.amount, orderCodes: done.orderCodes }, settings.name);
    return (
      <Dialog open onClose={onClose} size="sm" title="Pago registrado" description={`${employee.name} · ${formatMoney(done.amount)}`} footer={<Button onClick={onClose}>Listo</Button>}>
        <div className="space-y-3 text-sm text-slate-600">
          <p>Se registró el pago <b className="text-slate-900">{done.code}</b>{done.expenseCode ? <> y el gasto <b className="text-slate-900">{done.expenseCode}</b> (Pago a técnicos). Finanzas no lo resta otra vez: ya está en el costo de cada orden.</> : "."}</p>
          <a href={`/imprimir/pago-tecnico/${done.payoutId}`} target="_blank" rel="noreferrer"><Button variant="secondary" className="w-full" icon={<Printer className="h-4 w-4" />}>Imprimir comprobante</Button></a>
          {phone && <a href={whatsappLink(phone, msg)} target="_blank" rel="noreferrer"><Button variant="secondary" className="mt-2 w-full" icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}>Avisar a {firstName(employee.name)} por WhatsApp</Button></a>}
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
      title={`Registrar pago a ${employee.name}`}
      description="Seleccione los trabajos que le está pagando."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={!chosen.length}>Pagar {formatMoney(total)}</Button></>}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
            <label className="flex items-center gap-2"><input type="checkbox" checked={selected.size === pending.length} onChange={(e) => setSelected(new Set(e.target.checked ? pending.map((x) => x.id) : []))} /> {chosen.length} de {pending.length} seleccionados</label>
            <span className="tabular text-slate-900">{formatMoney(total)}</span>
          </div>
          <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto">
            {pending.map((e) => (
              <li key={e.id}>
                <label className={cn("flex cursor-pointer items-start gap-3 px-4 py-2.5", selected.has(e.id) && "bg-brand-50/40")}>
                  <input type="checkbox" className="mt-1" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{e.orderCode} <span className="font-normal text-slate-500">· {e.customerName} · {e.plate}</span></div>
                    <div className="text-xs text-slate-500">Cobrada {formatDate(e.earnedAt)} · {e.lines.map(earningLineText).join(" · ")}</div>
                  </div>
                  <span className="tabular text-sm font-semibold text-slate-900">{formatMoney(e.total)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
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
        <p className="text-xs text-slate-500">Se registra un gasto <b>Pago a técnicos</b> con la fecha de hoy. Es salida de caja, pero no se resta otra vez de la utilidad: el pago ya está como costo de cada orden.</p>
      </div>
    </Dialog>
  );
}

/** Marcar como revisado el aviso de un trabajo ya pagado cuya orden cambió. */
export function ReviewEarningDialog({ earning, onClose }: { earning: TechEarning; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await reviewTechEarning({ earningId: earning.id, note: note.trim() });
      toast.success("Aviso revisado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open onClose={onClose} size="sm" title={`Revisar aviso de ${earning.orderCode}`} description={`${earning.employeeName} · ${formatMoney(earning.total)} pagado`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving} disabled={note.trim().length < 3}>Marcar revisado</Button></>}
    >
      <div className="space-y-3">
        {earning.reviewNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{earning.reviewNote}</p>}
        <Field label="Qué se hizo" required hint="Ej. se le descontó en el siguiente pago."><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} /></Field>
      </div>
    </Dialog>
  );
}
