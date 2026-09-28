import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, FileCheck2, Paperclip, Pencil, Repeat, X } from "lucide-react";
import {
  EXPENSE_UNIT_LABELS, formatMoney, hnDayKey, methodNeedsBank, payPendingExpenseSchema,
  type Expense, type ManualPaymentMethod,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Feedback";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { useSettings } from "@/features/settings/api";
import {
  adjustPendingExpense, currentMonth, dayKeyToMs, generateFixedCosts, isExpenseOverdue, MAX_RECEIPT_MB, payPendingExpense,
  uploadExpenseReceipt, useFixedCostsMeta, usePendingExpenses, voidExpense,
} from "./api";
import { MethodPicker } from "./parts";

// ---------- Generación automática del mes ----------
const requested = new Set<string>();

/**
 * Si el mes actual todavía no tiene sus gastos fijos generados, pide al servidor que los genere (una vez por sesión).
 * La función programada diaria hace lo mismo; esto solo cubre el primer día o si la función aún no corrió.
 */
export function useEnsureFixedCostsGenerated(enabled = true) {
  const meta = useFixedCostsMeta();
  const month = currentMonth();
  useEffect(() => {
    if (!enabled || meta.loading || meta.error) return;
    if (meta.data?.generated?.[month] || requested.has(month)) return;
    requested.add(month);
    generateFixedCosts({ month })
      .then((r) => r.created > 0 && toast.success(`Se agregaron ${r.created} gastos fijos por pagar de este mes`))
      .catch((err) => {
        requested.delete(month);
        console.warn("[Gastos fijos]", errorMessage(err));
      });
  }, [enabled, meta.loading, meta.error, meta.data, month]);
}

export const dueOf = (e: Expense) => e.dueDate ?? e.date;

// ---------- Tarjeta "Por pagar este mes" ----------
export function PendingExpensesCard() {
  const { data, loading, error } = usePendingExpenses();
  const [paying, setPaying] = useState<Expense | null>(null);
  const [adjusting, setAdjusting] = useState<Expense | null>(null);
  const [skipping, setSkipping] = useState<Expense | null>(null);
  const month = currentMonth();
  // Pendientes de este mes y atrasados de meses anteriores (los de meses futuros no se muestran aquí)
  const list = data.filter((e) => (e.period ?? hnDayKey(dueOf(e)?.toMillis?.() ?? Date.now()).slice(0, 7)) <= month);
  const total = list.reduce((a, e) => a + e.amount, 0);
  const overdue = list.filter(isExpenseOverdue);
  const overdueTotal = overdue.reduce((a, e) => a + e.amount, 0);

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-600" />Por pagar este mes</span>}
        description={list.length ? `${list.length} pendientes · ${formatMoney(total)}${overdue.length ? ` · ${overdue.length} vencidos (${formatMoney(overdueTotal)})` : ""}` : "Gastos fijos del mes que faltan por pagar."}
        action={<Link to="/gastos-fijos"><Button size="sm" variant="secondary" icon={<Repeat className="h-4 w-4" />}>Gastos fijos</Button></Link>}
      />
      {error ? (
        <p className="px-5 pb-4 text-sm text-red-600">{error}</p>
      ) : loading && !data.length ? (
        <div className="space-y-2 px-5 pb-4">{[0, 1].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !list.length ? (
        <div className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Nada pendiente. Configure alquiler, salarios y servicios en <Link to="/gastos-fijos" className="font-medium text-brand-700">Gastos fijos</Link> para que aparezcan aquí cada mes.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {list.map((e) => {
            const late = isExpenseOverdue(e);
            return (
              <li key={e.id} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", late && "bg-red-50/60")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{e.description}</span>
                    {late ? <Badge tone="red"><AlertTriangle className="h-3 w-3" />Vencido</Badge> : <Badge tone="amber">Pendiente</Badge>}
                    {e.adjusted && <Badge tone="gray">Monto ajustado</Badge>}
                  </div>
                  <div className={cn("text-xs", late ? "text-red-700" : "text-slate-500")}>
                    {[`Vence ${formatDate(dueOf(e))}`, e.category, e.unit && e.unit !== "general" ? EXPENSE_UNIT_LABELS[e.unit] : "", e.employeeName, e.supplierName].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className={cn("tabular w-28 font-semibold sm:text-right", late && "text-red-700")}>{formatMoney(e.amount)}</span>
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => setPaying(e)}>Marcar pagado</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setAdjusting(e)} aria-label="Cambiar monto" title="Cambiar monto de este mes" />
                    <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setSkipping(e)} aria-label="No aplica este mes" title="No aplica este mes" />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <PayPendingDialog expense={paying} onClose={() => setPaying(null)} />
      <AdjustPendingDialog expense={adjusting} onClose={() => setAdjusting(null)} />
      <SkipPendingDialog expense={skipping} onClose={() => setSkipping(null)} />
    </Card>
  );
}

// ---------- Marcar pagado ----------
function ExpenseReceiptUpload({ value, onChange }: { value: string | null; onChange: (p: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) return toast.error("El comprobante debe ser una foto o un PDF");
    if (file.size > MAX_RECEIPT_MB * 1024 * 1024) return toast.error(`El archivo supera ${MAX_RECEIPT_MB} MB`);
    setProgress(0);
    try {
      onChange(await uploadExpenseReceipt(file, setProgress));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
          <FileCheck2 className="h-4 w-4" /> Comprobante adjunto
          <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 hover:bg-emerald-100" aria-label="Quitar comprobante"><X className="h-3 w-3" /></button>
        </span>
      ) : (
        <button type="button" disabled={progress !== null} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-60">
          <Paperclip className="h-4 w-4" />
          {progress !== null ? `Subiendo ${progress}%` : `Adjuntar foto o PDF (máx. ${MAX_RECEIPT_MB} MB)`}
        </button>
      )}
    </div>
  );
}

export function PayPendingDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { settings } = useSettings();
  const [amount, setAmount] = useState(0);
  const [dateKey, setDateKey] = useState(hnDayKey(Date.now()));
  const [method, setMethod] = useState<ManualPaymentMethod>("transfer");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!expense) return;
    setAmount(expense.amount);
    setDateKey(hnDayKey(Date.now()));
    setMethod(expense.method ?? "transfer");
    setBank("");
    setReference("");
    setReceiptPath(null);
  }, [expense]);

  if (!expense) return null;
  const needsBank = methodNeedsBank(method);
  const banks = settings.bankAccounts ?? [];

  const save = async () => {
    const parsed = payPendingExpenseSchema.safeParse({
      expenseId: expense.id, amount, date: dayKeyToMs(dateKey), method, reference: reference.trim(),
      ...(needsBank && bank.trim() ? { bank: bank.trim() } : {}),
      ...(receiptPath ? { receiptPath } : {}),
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
    setSaving(true);
    try {
      await payPendingExpense(parsed.data);
      toast.success(`${expense.description}: pagado`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Marcar pagado" description={`${expense.description} · vence ${formatDate(dueOf(expense))}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Registrar pago</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monto pagado" required hint={amount !== expense.amount ? `Previsto: ${formatMoney(expense.amount)}` : undefined}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Fecha del pago" required><Input type="date" value={dateKey} max={hnDayKey(Date.now())} onChange={(e) => e.target.value && setDateKey(e.target.value)} /></Field>
        <Field label="Método de pago" className="sm:col-span-2"><MethodPicker value={method} onChange={setMethod} /></Field>
        {needsBank && (
          <Field label="Banco / cuenta" required hint="De dónde salió el dinero." className="sm:col-span-2">
            {banks.length ? (
              <Select value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Seleccione el banco…</option>
                {banks.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            ) : (
              <Input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} placeholder="Ej. BAC Credomatic" />
            )}
          </Field>
        )}
        <Field label="Referencia" hint="Número de transferencia, recibo o factura" className="sm:col-span-2"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
        <Field label="Comprobante" hint="Opcional" className="sm:col-span-2"><ExpenseReceiptUpload value={receiptPath} onChange={setReceiptPath} /></Field>
      </div>
    </Dialog>
  );
}

// ---------- Cambiar monto de este mes ----------
export function AdjustPendingDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const [amount, setAmount] = useState(0);
  const [dateKey, setDateKey] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!expense) return;
    setAmount(expense.amount);
    setDateKey(hnDayKey(dueOf(expense)?.toMillis?.() ?? Date.now()));
  }, [expense]);
  if (!expense) return null;
  const originalKey = hnDayKey(dueOf(expense)?.toMillis?.() ?? Date.now());
  const save = async () => {
    if (amount <= 0) return toast.error("El monto debe ser mayor a 0");
    setSaving(true);
    try {
      await adjustPendingExpense({ expenseId: expense.id, amount, ...(dateKey && dateKey !== originalKey ? { dueDate: dayKeyToMs(dateKey) } : {}) });
      toast.success("Monto de este mes actualizado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="Cambiar monto de este mes" description={expense.description}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <div className="space-y-4">
        <Field label="Monto de este mes" required hint="Solo cambia este mes. Para cambiar todos los meses, edite el gasto fijo."><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Fecha de vencimiento"><Input type="date" value={dateKey} onChange={(e) => e.target.value && setDateKey(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------- No aplica este mes ----------
export function SkipPendingDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(""), [expense]);
  if (!expense) return null;
  const save = async () => {
    setSaving(true);
    try {
      await voidExpense({ expenseId: expense.id, reason: reason.trim() });
      toast.success("Marcado como no aplica este mes");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="No aplica este mes" description={`${expense.description} · ${formatMoney(expense.amount)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => void save()} loading={saving} disabled={reason.trim().length < 3}>Confirmar</Button></>}>
      <Field label="Motivo" required hint="Queda anulado solo este mes. El gasto fijo sigue activo para los próximos meses.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Ej. Este mes no hubo recibo de agua" />
      </Field>
    </Dialog>
  );
}
