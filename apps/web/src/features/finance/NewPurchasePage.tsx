import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { Info, Package, PenLine, Plus, Save, Trash2 } from "lucide-react";
import { createPurchaseSchema, formatMoney, hnDayKey, type ManualPaymentMethod, type ProductCost } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { CatalogPicker } from "@/features/catalog/CatalogPicker";
import { costRef } from "@/features/catalog/api";
import { addDaysKey, createPurchase, dayKeyToMs, useActiveSuppliers } from "./api";
import { MethodPicker, SupplierFormDialog } from "./parts";

interface Line {
  key: string;
  productId: string | null;
  sku: string;
  description: string;
  qty: number;
  unitCost: number;
}

const COST_ROLES = ["admin", "manager", "warehouse"];
let seq = 0;
const lineKey = () => `l${++seq}`;

export function NewPurchasePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { role } = useAuth();
  const canSeeCost = COST_ROLES.includes(role ?? "");
  const canPay = role === "admin" || role === "manager";
  const suppliers = useActiveSuppliers();

  const today = hnDayKey(Date.now());
  const [supplierId, setSupplierId] = useState(params.get("proveedor") ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dateKey, setDateKey] = useState(today);
  const [dueKey, setDueKey] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<ManualPaymentMethod>("cash");
  const [payRef, setPayRef] = useState("");
  const [picker, setPicker] = useState(false);
  const [newSupplier, setNewSupplier] = useState(false);
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.data.find((s) => s.id === supplierId);
  const subtotal = useMemo(() => lines.reduce((a, l) => a + Math.round(l.qty * l.unitCost), 0), [lines]);
  const total = subtotal + tax;

  // Vencimiento sugerido: fecha + días de crédito del proveedor
  useEffect(() => {
    if (dueTouched || !dateKey) return;
    setDueKey(supplier ? addDaysKey(dateKey, supplier.creditDays ?? 0) : "");
  }, [supplier, dateKey, dueTouched]);

  useEffect(() => {
    if (payNow) setPayAmount((a) => (a > 0 && a <= total ? a : total));
  }, [payNow, total]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addProduct = async (p: { id: string; name: string; sku: string }) => {
    const key = lineKey();
    setLines((ls) => [...ls, { key, productId: p.id, sku: p.sku, description: p.name, qty: 1, unitCost: 0 }]);
    if (!canSeeCost) return;
    try {
      const snap = await getDoc(costRef(p.id));
      if (snap.exists()) {
        const c = snap.data() as ProductCost;
        const last = c.lastPurchaseCost || c.cost || c.avgCost || 0;
        if (last) setLines((ls) => ls.map((l) => (l.key === key && l.unitCost === 0 ? { ...l, unitCost: last } : l)));
      }
    } catch {
      /* sin permiso o sin costo registrado */
    }
  };

  const submit = async () => {
    if (!supplierId) {
      toast.error("Seleccione el proveedor");
      return;
    }
    if (dueKey && dueKey < dateKey) {
      toast.error("El vencimiento no puede ser antes de la fecha de la compra");
      return;
    }
    const input = {
      supplierId,
      invoiceNumber: invoiceNumber.trim(),
      date: dayKeyToMs(dateKey),
      ...(dueKey ? { dueDate: dayKeyToMs(dueKey) } : {}),
      items: lines.map((l) => ({ ...(l.productId ? { productId: l.productId } : {}), description: l.description.trim(), qty: l.qty, unitCost: l.unitCost })),
      tax,
      notes: notes.trim(),
      ...(canPay && payNow && payAmount > 0 ? { payment: { amount: payAmount, method: payMethod, reference: payRef.trim() } } : {}),
    };
    const parsed = createPurchaseSchema.safeParse(input);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
      return;
    }
    if (input.payment && input.payment.amount > total) {
      toast.error("El pago no puede ser mayor al total de la compra");
      return;
    }
    setSaving(true);
    try {
      const r = await createPurchase(parsed.data);
      toast.success(`Compra ${r.code} registrada${r.balance > 0 ? `. Por pagar: ${formatMoney(r.balance)}` : ". Pagada"}`);
      navigate("/compras");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const stockLines = lines.filter((l) => l.productId).length;

  return (
    <>
      <PageHeader back={{ to: "/compras", label: "Compras" }} title="Nueva compra" description="Registre la factura del proveedor. Lo que no se pague ahora queda como cuenta por pagar." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Factura" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Proveedor" required className="sm:col-span-2" hint={supplier ? `${supplier.creditDays ? `Crédito a ${supplier.creditDays} días` : "Contado"}${supplier.balanceDue > 0 ? ` · saldo actual ${formatMoney(supplier.balanceDue)}` : ""}` : undefined}>
                <div className="flex gap-2">
                  <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={suppliers.loading}>
                    <option value="">{suppliers.loading ? "Cargando..." : "Seleccione..."}</option>
                    {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewSupplier(true)} aria-label="Nuevo proveedor" title="Nuevo proveedor" />
                </div>
              </Field>
              <Field label="Número de factura"><Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={40} placeholder="Ej. 000-001-01-00012345" /></Field>
              <Field label="Fecha de la factura" required><Input type="date" value={dateKey} max={today} onChange={(e) => setDateKey(e.target.value)} /></Field>
              <Field label="Vencimiento" hint={dueTouched ? "Deje vacío si no tiene fecha de pago" : "Sugerido según los días de crédito del proveedor"}>
                <Input type="date" value={dueKey} min={dateKey} onChange={(e) => { setDueTouched(true); setDueKey(e.target.value); }} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Detalle" description="Productos del inventario o líneas libres (fletes, servicios, insumos no inventariados)." action={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<Package className="h-4 w-4" />} onClick={() => setPicker(true)}>Producto</Button>
                <Button size="sm" variant="secondary" icon={<PenLine className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, { key: lineKey(), productId: null, sku: "", description: "", qty: 1, unitCost: 0 }])}>Línea libre</Button>
              </div>
            } />
            {!lines.length ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Agregue los productos de la factura. <button className="font-semibold text-brand-700" onClick={() => setPicker(true)}>Buscar en el inventario</button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <li key={l.key} className="grid gap-3 px-5 py-3 sm:grid-cols-[1fr_90px_140px_110px_auto] sm:items-end">
                    <div className="min-w-0">
                      {l.productId ? (
                        <>
                          <div className="text-[13px] font-medium text-slate-700">Producto</div>
                          <div className="flex h-10 items-center gap-2">
                            <Package className="h-4 w-4 shrink-0 text-sky-600" />
                            <span className="truncate text-sm font-semibold">{l.description}</span>
                            {l.sku && <span className="shrink-0 text-xs text-slate-500">{l.sku}</span>}
                          </div>
                        </>
                      ) : (
                        <Field label="Descripción"><Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={160} placeholder="Ej. Flete, envío" /></Field>
                      )}
                    </div>
                    <div className="grid grid-cols-[90px_1fr] gap-3 sm:contents">
                      <Field label="Cantidad"><Input type="number" inputMode="decimal" min={0} step="any" value={l.qty || ""} onChange={(e) => update(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })} className="tabular text-right" /></Field>
                      <Field label="Costo unitario"><MoneyInput value={l.unitCost} onChange={(v) => update(l.key, { unitCost: v })} /></Field>
                    </div>
                    <div className="flex items-center justify-between sm:block sm:text-right">
                      <span className="text-xs text-slate-500 sm:block">Total</span>
                      <span className="tabular block font-semibold sm:h-10 sm:leading-10">{formatMoney(Math.round(l.qty * l.unitCost))}</span>
                    </div>
                    <Button size="sm" variant="ghost" className="justify-self-end text-slate-400 hover:text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Quitar línea" />
                  </li>
                ))}
              </ul>
            )}
            {stockLines > 0 && (
              <div className="flex gap-2 border-t border-slate-100 bg-sky-50/50 px-5 py-3 text-xs text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Las {stockLines === 1 ? "línea" : `${stockLines} líneas`} del inventario suben la existencia al guardar y actualizan el costo promedio del producto con el costo de esta compra.</span>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Notas" />
            <div className="p-5"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="Opcional" /></div>
          </Card>
        </div>

        <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader title="Totales" />
            <div className="space-y-3 p-5 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="tabular font-medium">{formatMoney(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">ISV</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setTax(Math.round(subtotal * 0.15))} disabled={!subtotal}>15%</Button>
                  <MoneyInput value={tax} onChange={setTax} className="w-32" />
                </div>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3 text-base font-bold"><span>Total</span><span className="tabular">{formatMoney(total)}</span></div>
            </div>
          </Card>

          {canPay && (
            <Card>
              <label className="flex items-center gap-2 px-5 py-4 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
                Pagado ahora (contado o abono)
              </label>
              {payNow && (
                <div className="space-y-4 border-t border-slate-100 p-5">
                  <Field label="Monto pagado" hint={payAmount < total ? `Quedará por pagar ${formatMoney(Math.max(0, total - payAmount))}` : "Compra pagada completa"}><MoneyInput value={payAmount} onChange={setPayAmount} /></Field>
                  <Field label="Método"><MethodPicker value={payMethod} onChange={setPayMethod} /></Field>
                  <Field label="Referencia"><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} maxLength={80} placeholder="Transferencia, cheque, recibo..." /></Field>
                </div>
              )}
            </Card>
          )}

          <div className={cn("rounded-xl p-4 text-sm", total - (canPay && payNow ? payAmount : 0) > 0 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>
            {total - (canPay && payNow ? payAmount : 0) > 0
              ? <>Quedará como cuenta por pagar: <b className="tabular">{formatMoney(Math.max(0, total - (canPay && payNow ? payAmount : 0)))}</b>{dueKey && <> con vencimiento el {dueKey.split("-").reverse().join("/")}</>}.</>
              : total > 0 ? "La compra queda pagada." : "Agregue líneas para calcular el total."}
          </div>

          <Button size="lg" className="w-full" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!lines.length || !supplierId} onClick={() => void submit()}>Registrar compra</Button>
        </div>
      </div>

      <CatalogPicker open={picker} onClose={() => setPicker(false)} only="product" onPick={(p) => { if (p.kind === "product") void addProduct(p.item); }} />
      <SupplierFormDialog open={newSupplier} supplier={null} onClose={(id) => { setNewSupplier(false); if (id) setSupplierId(id); }} />
    </>
  );
}
