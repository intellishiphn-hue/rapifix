import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ban, FileText, Image as ImageIcon, Paperclip, Pencil, Plus, Receipt, X } from "lucide-react";
import {
  EXPENSE_CATEGORIES, formatMoney, hnDayKey, PAYMENT_METHOD_LABELS, saveExpenseSchema,
  type Expense, type ManualPaymentMethod,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Badge";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { currentMonth, dayKeyToMs, MAX_RECEIPT_MB, monthLabel, openReceipt, saveExpense, uploadExpenseReceipt, useActiveSuppliers, useExpenses, voidExpense } from "./api";
import { MethodPicker, MonthSwitcher, StatCard } from "./parts";

export function ExpensesPage() {
  const [month, setMonth] = useState(currentMonth());
  const [category, setCategory] = useState("");
  const { data, loading, error } = useExpenses(month);
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [voiding, setVoiding] = useState<Expense | null>(null);

  const valid = data.filter((e) => e.status !== "voided");
  const total = valid.reduce((a, e) => a + e.amount, 0);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    valid.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [valid]);
  const shown = category ? data.filter((e) => e.category === category) : data;
  const shownTotal = shown.filter((e) => e.status !== "voided").reduce((a, e) => a + e.amount, 0);
  const top = byCategory[0]?.[1] ?? 0;

  return (
    <>
      <PageHeader title="Gastos" description="Gastos del taller por mes: alquiler, servicios, salarios, insumos y más." actions={<>
        <MonthSwitcher month={month} onChange={setMonth} />
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo gasto</Button>
      </>} />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="order-2 space-y-5 lg:order-1">
          <Card>
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-64">
                <option value="">Todas las categorías</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              {category && <div className="text-sm text-slate-600">{category}: <b className="tabular text-slate-900">{formatMoney(shownTotal)}</b></div>}
            </div>
            {error ? <ErrorState message={error} /> : loading && !data.length ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !shown.length ? (
              <EmptyState icon={<Receipt className="h-7 w-7" />} title={category ? "Sin gastos en esta categoría" : `Sin gastos en ${monthLabel(month).toLowerCase()}`} description="Registre cada gasto con su comprobante para saber cuánto cuesta operar el taller." action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo gasto</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((e) => {
                  const voided = e.status === "voided";
                  return (
                    <li key={e.id} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", voided && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("font-semibold text-slate-900", voided && "line-through")}>{e.description}</span>
                          {voided && <Badge tone="gray">Anulado</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {[e.code, formatDate(e.date), e.category, PAYMENT_METHOD_LABELS[e.method], e.reference, e.supplierName].filter(Boolean).join(" · ")}
                        </div>
                        {voided && e.voidReason && <div className="text-xs text-slate-500">Motivo: {e.voidReason}</div>}
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <span className={cn("tabular w-28 font-semibold sm:text-right", voided && "line-through")}>{formatMoney(e.amount)}</span>
                        <div className="flex gap-1">
                          {e.receiptPath && (
                            <Button size="sm" variant="ghost" icon={e.receiptType === "application/pdf" ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                              onClick={() => openReceipt(e.receiptPath!).catch((err) => toast.error(errorMessage(err)))} aria-label="Ver comprobante" title="Ver comprobante" />
                          )}
                          {!voided && <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(e)} aria-label="Editar" title="Editar" />}
                          {!voided && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(e)} aria-label="Anular" title="Anular" />}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <StatCard label={`Gastos de ${monthLabel(month).toLowerCase()}`} value={formatMoney(total)} hint={`${valid.length} gastos${data.length > valid.length ? ` · ${data.length - valid.length} anulados` : ""}`} />
          {byCategory.length > 0 && (
            <Card>
              <CardHeader title="Por categoría" />
              <ul className="space-y-3 p-5">
                {byCategory.map(([c, amt]) => (
                  <li key={c}>
                    <button onClick={() => setCategory(category === c ? "" : c)} className="w-full text-left">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className={cn("truncate", category === c ? "font-semibold text-brand-700" : "text-slate-700")}>{c}</span>
                        <span className="tabular shrink-0 font-medium">{formatMoney(amt)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn("h-full rounded-full", category === c ? "bg-brand-600" : "bg-brand-400")} style={{ width: `${top ? Math.max(3, (amt / top) * 100) : 0}%` }} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{total ? Math.round((amt / total) * 100) : 0}% del mes</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <ExpenseFormDialog open={editing !== undefined} expense={editing ?? null} onClose={() => setEditing(undefined)} />
      <VoidExpenseDialog expense={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}

function ExpenseFormDialog({ open, expense, onClose }: { open: boolean; expense: Expense | null; onClose: () => void }) {
  const suppliers = useActiveSuppliers();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [dateKey, setDateKey] = useState(hnDayKey(Date.now()));
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [keepReceipt, setKeepReceipt] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(expense?.category ?? "");
    setDescription(expense?.description ?? "");
    setAmount(expense?.amount ?? 0);
    setDateKey(expense?.date?.toMillis ? hnDayKey(expense.date.toMillis()) : hnDayKey(Date.now()));
    setMethod(expense?.method ?? "cash");
    setReference(expense?.reference ?? "");
    setSupplierId(expense?.supplierId ?? "");
    setFile(null);
    setKeepReceipt(true);
    setProgress(null);
  }, [open, expense]);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.type.startsWith("image/")) {
      toast.error("El comprobante debe ser una foto o un PDF");
      return;
    }
    if (f.size > MAX_RECEIPT_MB * 1024 * 1024) {
      toast.error(`El archivo supera ${MAX_RECEIPT_MB} MB`);
      return;
    }
    setFile(f);
  };

  const save = async () => {
    const base = {
      ...(expense ? { expenseId: expense.id } : {}),
      category, description: description.trim(), amount, date: dayKeyToMs(dateKey), method, reference: reference.trim(),
      ...(supplierId ? { supplierId } : {}),
    };
    const check = saveExpenseSchema.safeParse(base);
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      let receiptPath: string | null = expense?.receiptPath && keepReceipt ? expense.receiptPath : null;
      if (file) {
        setProgress(0);
        receiptPath = await uploadExpenseReceipt(file, setProgress);
      }
      const parsed = saveExpenseSchema.parse({ ...base, ...(receiptPath ? { receiptPath } : {}) });
      const r = await saveExpense(parsed);
      toast.success(expense ? `Gasto ${r.code} actualizado` : `Gasto ${r.code} registrado`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const hasExisting = !!expense?.receiptPath && keepReceipt && !file;

  return (
    <Dialog open={open} onClose={onClose} title={expense ? `Editar gasto ${expense.code}` : "Nuevo gasto"} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>{progress !== null ? `Subiendo ${progress}%` : "Guardar"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Seleccione...</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Monto" required><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Descripción" required className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={300} placeholder="Ej. Pago de energía eléctrica de agosto" /></Field>
        <Field label="Fecha" required><Input type="date" value={dateKey} max={hnDayKey(Date.now())} onChange={(e) => setDateKey(e.target.value)} /></Field>
        <Field label="Proveedor" hint="Opcional">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Ninguno</option>
            {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {expense?.supplierId && !suppliers.data.some((s) => s.id === expense.supplierId) && <option value={expense.supplierId}>{expense.supplierName || "Proveedor"}</option>}
          </Select>
        </Field>
        <Field label="Método de pago" className="sm:col-span-2"><MethodPicker value={method} onChange={setMethod} /></Field>
        <Field label="Referencia" hint="Número de recibo, transferencia, factura..." className="sm:col-span-2"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
        <div className="space-y-1.5 sm:col-span-2">
          <span className="text-[13px] font-medium text-slate-700">Comprobante</span>
          {file || hasExisting ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              {(file ? file.type === "application/pdf" : expense?.receiptType === "application/pdf") ? <FileText className="h-5 w-5 text-red-600" /> : <ImageIcon className="h-5 w-5 text-sky-600" />}
              <div className="min-w-0 flex-1 text-sm">
                {file ? <><div className="truncate font-medium">{file.name}</div><div className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB{file.type.startsWith("image/") ? " · se comprime al subir" : ""}</div></> : (
                  <button className="font-medium text-brand-700" onClick={() => openReceipt(expense!.receiptPath!).catch((err) => toast.error(errorMessage(err)))}>Ver comprobante actual</button>
                )}
              </div>
              <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => { if (file) setFile(null); else setKeepReceipt(false); }} aria-label="Quitar comprobante" />
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700">
              <Paperclip className="h-4 w-4" /> Adjuntar foto o PDF (máx. {MAX_RECEIPT_MB} MB)
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
    </Dialog>
  );
}

function VoidExpenseDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(""), [expense]);
  if (!expense) return null;
  const save = async () => {
    setSaving(true);
    try {
      await voidExpense({ expenseId: expense.id, reason: reason.trim() });
      toast.success(`Gasto ${expense.code} anulado`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={`Anular gasto ${expense.code}`} description={`${expense.description} · ${formatMoney(expense.amount)}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => void save()} loading={saving} disabled={reason.trim().length < 3}>Anular gasto</Button></>}>
      <Field label="Motivo" required hint="El gasto no se borra: queda anulado en el historial y deja de sumar."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} /></Field>
    </Dialog>
  );
}
