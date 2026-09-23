import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Minus, Package, Plus, Printer, Search, ShoppingCart, Trash2, Wrench, X } from "lucide-react";
import {
  computeQuote, formatMoney, PAYMENT_METHOD_LABELS, MANUAL_PAYMENT_METHODS,
  type Customer, type ManualPaymentMethod, type Product, type SaleItemKind, type Service,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/firestore/hooks";
import { newId } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { CustomerPicker } from "@/features/vehicles/CustomerPicker";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { searchCatalog } from "@/features/catalog/api";
import { createSale } from "@/features/payments/api";

interface CartLine { id: string; kind: SaleItemKind; refId: string | null; description: string; qty: number; unitPrice: number; discount: number; taxable: boolean; stock?: number }
interface PayLine { id: string; method: ManualPaymentMethod; amount: number; reference: string }

export function POSPage() {
  const { settings } = useSettings();
  const [text, setText] = useState("");
  const debounced = useDebounced(text, 250);
  const [results, setResults] = useState<{ products: Product[]; services: Service[] }>({ products: [], services: [] });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<PayLine[]>([{ id: newId(), method: "cash", amount: 0, reference: "" }]);
  const [received, setReceived] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ saleId: string; code: string; balance: number } | null>(null);
  const [payTouched, setPayTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    searchCatalog(debounced).then((r) => !cancelled && setResults(r)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const computed = useMemo(
    () => computeQuote(cart.map((l) => ({ id: l.id, type: "other" as const, description: l.description, qty: l.qty, unitCost: 0, unitPrice: l.unitPrice, discount: l.discount, taxable: l.taxable })), settings.taxRate),
    [cart, settings.taxRate],
  );
  const total = computed.totals.total;
  const paid = payments.reduce((a, p) => a + p.amount, 0);

  // El pago por defecto sigue al total mientras no lo toquen
  useEffect(() => {
    if (!payTouched) setPayments((ps) => (ps.length === 1 ? [{ ...ps[0]!, amount: total }] : ps));
  }, [total, payTouched]);

  const add = (kind: SaleItemKind, item?: Product | Service) => {
    if (item && kind === "product") {
      const p = item as Product;
      const existing = cart.find((l) => l.refId === p.id);
      if (existing) {
        setCart(cart.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + 1 } : l)));
        return;
      }
      setCart([...cart, { id: newId(), kind, refId: p.id, description: p.name, qty: 1, unitPrice: p.price, discount: 0, taxable: p.taxable, stock: p.stock }]);
    } else if (item) {
      const s = item as Service;
      setCart([...cart, { id: newId(), kind, refId: s.id, description: s.name, qty: 1, unitPrice: s.price, discount: 0, taxable: s.taxable }]);
    } else {
      setCart([...cart, { id: newId(), kind: "other", refId: null, description: "", qty: 1, unitPrice: 0, discount: 0, taxable: true }]);
    }
  };
  const edit = (id: string, patch: Partial<CartLine>) => setCart(cart.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const reset = () => {
    setCart([]);
    setCustomer(null);
    setPayments([{ id: newId(), method: "cash", amount: 0, reference: "" }]);
    setReceived(0);
    setPayTouched(false);
    setDone(null);
  };

  const charge = async () => {
    if (!cart.length) return toast.error("Agregue productos o servicios");
    if (cart.some((l) => !l.description.trim() || !(l.qty > 0))) return toast.error("Revise las líneas: descripción y cantidad");
    const over = cart.find((l) => l.kind === "product" && l.stock !== undefined && l.qty > l.stock);
    if (over) return toast.error(`No hay suficiente existencia de ${over.description} (hay ${over.stock})`);
    if (paid > total) return toast.error("Los pagos superan el total");
    if (paid < total && !customer) return toast.error("Para dejar saldo pendiente, seleccione el cliente");
    setSaving(true);
    try {
      const r = await createSale({
        customerId: customer?.id ?? null,
        items: cart.map(({ stock: _s, ...l }) => ({ ...l, description: l.description.trim() })),
        payments: payments.filter((p) => p.amount > 0).map((p) => ({ amount: p.amount, method: p.method, reference: p.reference.trim() })),
      });
      setDone(r);
      toast.success(`Venta ${r.code} registrada`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const cashPaid = payments.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0);
  const change = received > cashPaid && cashPaid > 0 ? received - cashPaid : 0;

  return (
    <>
      <PageHeader title="Punto de venta" description="Ventas de mostrador: repuestos, aceites, servicios rápidos." />
      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        <Card>
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar producto o servicio..." className="h-11 pl-9" autoFocus />
            </div>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {results.products.map((p) => (
              <button key={p.id} onClick={() => add("product", p)} disabled={p.stock <= 0} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-50">
                <Package className="h-5 w-5 shrink-0 text-sky-600" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className={cn("block text-xs", p.stock <= p.minStock ? "text-amber-700" : "text-slate-500")}>Existencia: {p.stock}</span></span>
                <span className="tabular text-sm font-semibold">{formatMoney(p.price)}</span>
              </button>
            ))}
            {results.services.map((s) => (
              <button key={s.id} onClick={() => add("service", s)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50/40">
                <Wrench className="h-5 w-5 shrink-0 text-violet-600" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.name}</span>
                <span className="tabular text-sm font-semibold">{formatMoney(s.price)}</span>
              </button>
            ))}
            <button onClick={() => add("other")} className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-3 text-sm font-semibold text-slate-500 hover:border-brand-300 hover:text-brand-700"><Plus className="h-4 w-4" /> Línea libre</button>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title={<span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Venta actual</span>} action={cart.length > 0 && <Button size="sm" variant="ghost" onClick={reset}>Limpiar</Button>} />
          <div className="space-y-4 p-5">
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-slate-700">Cliente <span className="font-normal text-slate-400">(opcional)</span></div>
              <CustomerPicker value={customer} onChange={setCustomer} />
            </div>
            {!cart.length ? <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Toque un producto o servicio para agregarlo.</p> : (
              <ul className="space-y-2">
                {cart.map((l, i) => (
                  <li key={l.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start gap-2">
                      {l.kind === "other" ? <Input value={l.description} onChange={(e) => edit(l.id, { description: e.target.value })} placeholder="Descripción" className="h-9" /> : <div className="flex-1 text-sm font-semibold">{l.description}</div>}
                      <button onClick={() => setCart(cart.filter((x) => x.id !== l.id))} className="rounded-md p-1 text-slate-400 hover:text-red-600" aria-label="Quitar"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex items-center rounded-lg border border-slate-200">
                        <button onClick={() => edit(l.id, { qty: Math.max(1, l.qty - 1) })} className="p-2 text-slate-500" aria-label="Menos"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="tabular w-8 text-center text-sm font-semibold">{l.qty}</span>
                        <button onClick={() => edit(l.id, { qty: l.qty + 1 })} className="p-2 text-slate-500" aria-label="Más"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                      <label className="text-[11px] text-slate-500">Precio<MoneyInput value={l.unitPrice} onChange={(v) => edit(l.id, { unitPrice: v })} className="w-28" placeholder="0.00" /></label>
                      <label className="text-[11px] text-slate-500">Descuento<MoneyInput value={l.discount} onChange={(v) => edit(l.id, { discount: v })} className="w-24" placeholder="0.00" /></label>
                      <span className="tabular ml-auto font-semibold">{formatMoney(computed.items[i]?.lineTotal ?? 0)}</span>
                    </div>
                    {l.stock !== undefined && l.qty > l.stock && <p className="mt-1 text-xs text-red-600">Solo hay {l.stock} en existencia</p>}
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular">{formatMoney(computed.totals.subtotal)}</dd></div>
              {computed.totals.discount > 0 && <div className="flex justify-between text-slate-600"><dt>Descuento</dt><dd className="tabular">- {formatMoney(computed.totals.discount)}</dd></div>}
              <div className="flex justify-between text-slate-600"><dt>ISV ({settings.taxRate}%)</dt><dd className="tabular">{formatMoney(computed.totals.tax)}</dd></div>
              <div className="flex justify-between text-xl font-extrabold"><dt>Total</dt><dd className="tabular">{formatMoney(total)}</dd></div>
            </dl>
            <div className="space-y-2">
              <div className="text-[13px] font-medium text-slate-700">Pago</div>
              {payments.map((p) => (
                <div key={p.id} className="flex gap-2">
                  <div className="w-36 shrink-0">
                    <Select value={p.method} onChange={(e) => setPayments(payments.map((x) => (x.id === p.id ? { ...x, method: e.target.value as ManualPaymentMethod } : x)))}>
                      {MANUAL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                    </Select>
                  </div>
                  <MoneyInput value={p.amount} onChange={(v) => { setPayTouched(true); setPayments(payments.map((x) => (x.id === p.id ? { ...x, amount: v } : x))); }} className="min-w-0 flex-1" placeholder="0.00" />
                  {p.method !== "cash" && <Input value={p.reference} onChange={(e) => setPayments(payments.map((x) => (x.id === p.id ? { ...x, reference: e.target.value } : x)))} placeholder="Ref." className="w-24" />}
                  {payments.length > 1 && <button onClick={() => setPayments(payments.filter((x) => x.id !== p.id))} className="p-2 text-slate-400 hover:text-red-600" aria-label="Quitar pago"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
              {payments.length < 3 && <button onClick={() => { setPayTouched(true); setPayments([...payments, { id: newId(), method: "card", amount: Math.max(0, total - paid), reference: "" }]); }} className="text-xs font-semibold text-brand-700">+ Dividir pago</button>}
              {cashPaid > 0 && (
                <div className="flex items-center gap-2 text-sm"><span className="text-slate-600">Recibido en efectivo</span><MoneyInput value={received} onChange={setReceived} className="w-32" />{change > 0 && <b className="text-emerald-700">Cambio {formatMoney(change)}</b>}</div>
              )}
              {paid < total && cart.length > 0 && <p className="text-xs text-amber-700">Quedará un saldo de {formatMoney(total - paid)}{customer ? "" : " (seleccione el cliente)"}.</p>}
            </div>
            <Button size="lg" className="w-full" loading={saving} disabled={!cart.length} onClick={() => void charge()}>Cobrar {formatMoney(paid > 0 ? paid : total)}</Button>
          </div>
        </Card>
      </div>

      {done && (
        <Dialog open onClose={reset} size="sm" title={`Venta ${done.code} registrada`} description={done.balance > 0 ? `Saldo pendiente: ${formatMoney(done.balance)}` : "Pagada en su totalidad"} footer={<><Link to={`/imprimir/venta/${done.saleId}`} target="_blank"><Button variant="secondary" icon={<Printer className="h-4 w-4" />}>Imprimir comprobante</Button></Link><Button onClick={reset}>Nueva venta</Button></>}>
          <p className="text-sm text-slate-600">El inventario ya se actualizó y los pagos quedaron registrados.</p>
        </Dialog>
      )}
    </>
  );
}
