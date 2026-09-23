import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  formatMoney, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PURCHASE_STATUS_LABELS, saveSupplierSchema,
  type ManualPaymentMethod, type Purchase, type PurchaseStatus, type SaveSupplierInput, type Supplier,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Feedback";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { currentMonth, isOverdue, monthLabel, paySupplier, shiftMonth, saveSupplier, useSupplierPayments, voidPurchase } from "./api";

export const isFinanceRole = (role: string | null | undefined) => role === "admin" || role === "manager";

export function PurchaseStatusBadge({ p }: { p: Pick<Purchase, "status" | "dueDate" | "balance"> }) {
  const tone = ({ pending: "amber", partial: "blue", paid: "green", voided: "gray" } as const)[p.status as PurchaseStatus];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={tone}>{PURCHASE_STATUS_LABELS[p.status]}</Badge>
      {isOverdue(p) && <Badge tone="red">Vencida</Badge>}
    </span>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("tabular mt-0.5 text-xl font-bold sm:text-2xl", tone === "red" && "text-red-600", tone === "amber" && "text-amber-700", tone === "green" && "text-emerald-700")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function MethodPicker({ value, onChange }: { value: ManualPaymentMethod; onChange: (m: ManualPaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {MANUAL_PAYMENT_METHODS.map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} className={cn("rounded-lg border px-2 py-2 text-xs font-semibold", value === m ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600")}>
          {PAYMENT_METHOD_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

// ---------- Proveedor ----------
const EMPTY_SUPPLIER: SaveSupplierInput = { name: "", contactName: "", phone: "", email: "", rtn: "", categories: "", address: "", notes: "", creditDays: 0, active: true };

export function SupplierFormDialog({ open, supplier, onClose }: { open: boolean; supplier: Supplier | null | undefined; onClose: (id?: string) => void }) {
  const [form, setForm] = useState<SaveSupplierInput>(EMPTY_SUPPLIER);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(supplier ? {
      name: supplier.name, contactName: supplier.contactName ?? "", phone: supplier.phone ?? "", email: supplier.email ?? "", rtn: supplier.rtn ?? "",
      categories: supplier.categories ?? "", address: supplier.address ?? "", notes: supplier.notes ?? "", creditDays: supplier.creditDays ?? 0, active: supplier.active,
    } : EMPTY_SUPPLIER);
  }, [open, supplier]);

  const set = <K extends keyof SaveSupplierInput>(k: K, v: SaveSupplierInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const parsed = saveSupplierSchema.safeParse({ ...form, ...(supplier ? { supplierId: supplier.id } : {}) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    setSaving(true);
    try {
      const r = await saveSupplier(parsed.data);
      toast.success(supplier ? "Proveedor actualizado" : "Proveedor creado");
      onClose(r.supplierId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose()} title={supplier ? "Editar proveedor" : "Nuevo proveedor"} footer={<><Button variant="secondary" onClick={() => onClose()}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre o razón social" required error={errors.name} className="sm:col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} autoFocus /></Field>
        <Field label="Persona de contacto" error={errors.contactName}><Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={80} /></Field>
        <Field label="Teléfono" error={errors.phone}><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} inputMode="tel" /></Field>
        <Field label="Correo" error={errors.email}><Input value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={120} type="email" /></Field>
        <Field label="RTN" error={errors.rtn}><Input value={form.rtn} onChange={(e) => set("rtn", e.target.value)} maxLength={20} /></Field>
        <Field label="Qué nos vende" hint="Ej. repuestos, aceites, llantas" error={errors.categories} className="sm:col-span-2"><Input value={form.categories} onChange={(e) => set("categories", e.target.value)} maxLength={200} /></Field>
        <Field label="Días de crédito" hint="Para sugerir el vencimiento de las compras. 0 = contado." error={errors.creditDays}>
          <Input type="number" min={0} max={365} value={form.creditDays} onChange={(e) => set("creditDays", Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))))} />
        </Field>
        <Field label="Estado">
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Proveedor activo</label>
        </Field>
        <Field label="Dirección" error={errors.address} className="sm:col-span-2"><Input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={250} /></Field>
        <Field label="Notas" error={errors.notes} className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} rows={2} /></Field>
      </div>
    </Dialog>
  );
}

// ---------- Pago a proveedor ----------
export function PaySupplierDialog({ purchase, onClose }: { purchase: Purchase | null; onClose: () => void }) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<ManualPaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (purchase) {
      setAmount(purchase.balance);
      setMethod("transfer");
      setReference("");
    }
  }, [purchase]);

  if (!purchase) return null;
  const save = async () => {
    if (amount <= 0 || amount > purchase.balance) {
      toast.error(`El monto debe ser entre L 0.01 y ${formatMoney(purchase.balance)}`);
      return;
    }
    setSaving(true);
    try {
      const r = await paySupplier({ purchaseId: purchase.id, amount, method, reference: reference.trim() });
      toast.success(`Pago ${r.code} registrado${r.balance > 0 ? `. Saldo: ${formatMoney(r.balance)}` : ". Compra pagada"}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="Pagar a proveedor" description={`${purchase.code} · ${purchase.supplierName} · saldo ${formatMoney(purchase.balance)}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Registrar pago</Button></>}>
      <div className="space-y-4">
        <Field label="Monto" hint={amount > 0 && amount < purchase.balance ? `Abono. Quedará un saldo de ${formatMoney(purchase.balance - amount)}` : "Pago total"}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Método"><MethodPicker value={method} onChange={setMethod} /></Field>
        <Field label="Referencia" hint="Número de transferencia, cheque, recibo, etc."><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
      </div>
    </Dialog>
  );
}

// ---------- Anular compra ----------
export function VoidPurchaseDialog({ purchase, onClose }: { purchase: Purchase | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setReason(""), [purchase]);
  if (!purchase) return null;
  const hasStock = purchase.items.some((i) => i.productId);
  const save = async () => {
    setSaving(true);
    try {
      await voidPurchase({ purchaseId: purchase.id, reason: reason.trim() });
      toast.success(`Compra ${purchase.code} anulada`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title={`Anular compra ${purchase.code}`} description={`${purchase.supplierName} · ${formatMoney(purchase.total)}`} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={() => void save()} loading={saving} disabled={reason.trim().length < 3 || purchase.paid > 0}>Anular compra</Button></>}>
      <div className="space-y-4">
        {purchase.paid > 0 ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Esta compra ya tiene pagos registrados por {formatMoney(purchase.paid)}. No se puede anular.</p>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            La compra no se borra: queda anulada en el historial y su saldo deja de contar como cuenta por pagar.
            {hasStock && " Las existencias que entraron con esta compra se descuentan del inventario (solo si todavía están disponibles)."}
          </p>
        )}
        <Field label="Motivo" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Ej. Factura registrada dos veces" /></Field>
      </div>
    </Dialog>
  );
}

// ---------- Detalle de compra ----------
export function PurchaseDetailDialog({ purchase, onClose, canPay, onPay, onVoid }: { purchase: Purchase | null; onClose: () => void; canPay?: boolean; onPay?: (p: Purchase) => void; onVoid?: (p: Purchase) => void }) {
  const payments = useSupplierPayments({ purchaseId: purchase?.id });
  if (!purchase) return null;
  const open = purchase.status === "pending" || purchase.status === "partial";
  return (
    <Dialog open onClose={onClose} size="lg" title={`Compra ${purchase.code}`} description={`${purchase.supplierName}${purchase.invoiceNumber ? ` · Factura ${purchase.invoiceNumber}` : ""}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {canPay && purchase.status === "pending" && onVoid && <Button variant="ghost" className="text-red-600" onClick={() => onVoid(purchase)}>Anular</Button>}
        {canPay && open && onPay && <Button onClick={() => onPay(purchase)}>Registrar pago</Button>}
      </>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Fecha" value={formatDate(purchase.date)} />
          <Info label="Vencimiento" value={purchase.dueDate ? formatDate(purchase.dueDate) : "Contado"} />
          <Info label="Estado" value={<PurchaseStatusBadge p={purchase} />} />
          <Info label="Saldo" value={<span className={cn("tabular font-semibold", purchase.balance > 0 && "text-amber-700")}>{formatMoney(purchase.balance)}</span>} />
        </div>
        {purchase.status === "voided" && purchase.voidReason && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Anulada: {purchase.voidReason}</p>}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-3 py-2 font-medium">Descripción</th><th className="px-3 py-2 text-right font-medium">Cant.</th><th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Costo unit.</th><th className="px-3 py-2 text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchase.items.map((it, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.description}</div>
                    <div className="text-xs text-slate-500">{it.productId ? "Inventario" : "Línea libre"}<span className="sm:hidden"> · {formatMoney(it.unitCost)} c/u</span></div>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{it.qty}</td>
                  <td className="tabular hidden px-3 py-2 text-right sm:table-cell">{formatMoney(it.unitCost)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">{formatMoney(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50/60 text-sm">
              <tr><td colSpan={2} className="px-3 py-1.5 text-right text-slate-500 sm:hidden">Subtotal</td><td colSpan={3} className="hidden px-3 py-1.5 text-right text-slate-500 sm:table-cell">Subtotal</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(purchase.subtotal)}</td></tr>
              <tr><td colSpan={2} className="px-3 py-1.5 text-right text-slate-500 sm:hidden">ISV</td><td colSpan={3} className="hidden px-3 py-1.5 text-right text-slate-500 sm:table-cell">ISV</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(purchase.tax)}</td></tr>
              <tr className="font-semibold"><td colSpan={2} className="px-3 py-2 text-right sm:hidden">Total</td><td colSpan={3} className="hidden px-3 py-2 text-right sm:table-cell">Total</td><td className="tabular px-3 py-2 text-right">{formatMoney(purchase.total)}</td></tr>
            </tfoot>
          </table>
        </div>
        {purchase.notes && <p className="text-sm text-slate-600"><span className="font-medium text-slate-700">Notas:</span> {purchase.notes}</p>}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Pagos</h4>
          {payments.loading ? <Skeleton className="h-12" /> : payments.error ? <p className="text-sm text-red-600">{payments.error}</p> : !payments.data.length ? <p className="text-sm text-slate-500">Sin pagos registrados.</p> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {payments.data.map((p) => (
                <li key={p.id} className={cn("flex items-center justify-between gap-3 px-3 py-2 text-sm", p.status === "voided" && "text-slate-400 line-through")}>
                  <div className="min-w-0">
                    <div className="font-medium">{p.code} · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ""}</div>
                    <div className="text-xs text-slate-500">{formatDate(p.at, true)} · {p.byName}</div>
                  </div>
                  <span className="tabular font-semibold">{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium text-slate-800">{value}</div>
    </div>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrent = month >= currentMonth();
  return (
    <div className="flex items-center gap-1 rounded-[10px] bg-slate-200/70 p-1">
      <button onClick={() => onChange(shiftMonth(month, -1))} className="rounded-lg p-1.5 text-slate-600 hover:bg-white" aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-[9.5rem] text-center text-sm font-semibold text-slate-800">{monthLabel(month)}</span>
      <button onClick={() => onChange(shiftMonth(month, 1))} disabled={isCurrent} className="rounded-lg p-1.5 text-slate-600 hover:bg-white disabled:opacity-30" aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

