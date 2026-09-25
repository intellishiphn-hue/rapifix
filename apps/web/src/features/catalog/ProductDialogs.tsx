import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  formatMoney, MOVEMENT_LABELS, MOVEMENT_TYPES, PRODUCT_UNITS, productSchema,
  type MovementType, type Product, type ProductInput,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Feedback";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { registerInventoryMovement, saveProduct, useMovements, useProductCost } from "./api";

const EMPTY: ProductInput = { sku: "", name: "", category: "", brand: "", supplier: "", unit: "unidad", price: 0, minStock: 1, location: "", taxable: true, active: true };

export function ProductFormDialog({ open, onClose, product, onSaved, initial, hideInitialStock }: {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
  /** Al crear: devuelve el producto nuevo (ej. para agregarlo directo a una compra) */
  onSaved?: (p: { id: string; name: string; sku: string }) => void;
  /** Valores iniciales al crear (ej. el nombre que se buscó, el proveedor de la compra) */
  initial?: Partial<ProductInput>;
  /** En compras la existencia entra con la compra: no se pide existencia inicial */
  hideInitialStock?: boolean;
}) {
  const { user, can } = useAuth();
  const seeCost = can("inventory.manage");
  const costDoc = useProductCost(product?.id, open && seeCost);
  const [cost, setCost] = useState(0);
  const [initialStock, setInitialStock] = useState("");
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<ProductInput>({ resolver: zodResolver(productSchema), defaultValues: EMPTY });
  const { errors, isSubmitting } = formState;
  const price = watch("price");

  useEffect(() => {
    if (!open) return;
    reset(product ? { sku: product.sku, name: product.name, category: product.category, brand: product.brand, supplier: product.supplier, unit: product.unit, price: product.price, minStock: product.minStock, location: product.location, taxable: product.taxable, active: product.active } : { ...EMPTY, ...(initial ?? {}) });
    setInitialStock("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product, reset]);
  useEffect(() => setCost(costDoc.data?.cost ?? 0), [costDoc.data?.cost]);

  const submit = async (v: ProductInput) => {
    if (!user) return;
    try {
      const id = await saveProduct(product?.id ?? null, v, seeCost ? cost : null, user.uid);
      const qty = hideInitialStock ? 0 : Number(initialStock);
      if (!product && qty > 0) await registerInventoryMovement({ productId: id, type: "in", qty, unitCost: seeCost ? cost : null, reason: "Existencia inicial" });
      toast.success(product ? "Producto actualizado" : "Producto creado");
      if (!product) onSaved?.({ id, name: v.name, sku: v.sku.toUpperCase() });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={product ? "Editar producto" : "Nuevo producto o repuesto"} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={handleSubmit(submit)} loading={isSubmitting}>Guardar</Button></>}>
      <form onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Nombre" required error={errors.name?.message} className="sm:col-span-2"><Input {...register("name")} autoFocus placeholder="Ej. Filtro de aceite Toyota 90915-YZZD2" /></Field>
        <Field label="Código / SKU" error={errors.sku?.message}><Input {...register("sku")} className="uppercase" /></Field>
        <Field label="Categoría" error={errors.category?.message}><Input {...register("category")} placeholder="Filtros, frenos, aceites..." /></Field>
        <Field label="Marca"><Input {...register("brand")} /></Field>
        <Field label="Proveedor"><Input {...register("supplier")} /></Field>
        <Field label="Precio de venta" required error={errors.price?.message}><MoneyInput value={price} onChange={(v) => setValue("price", v, { shouldDirty: true })} /></Field>
        {seeCost && <Field label="Costo" hint={costDoc.data?.avgCost ? `Costo promedio: ${formatMoney(costDoc.data.avgCost)}` : "Solo lo ven administración, gerencia y bodega"}><MoneyInput value={cost} onChange={setCost} /></Field>}
        <Field label="Unidad"><Select {...register("unit")}>{PRODUCT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
        <Field label="Existencia mínima" error={errors.minStock?.message} hint="Se avisa cuando baje de aquí"><Input type="number" min={0} {...register("minStock", { valueAsNumber: true })} /></Field>
        <Field label="Ubicación"><Input {...register("location")} placeholder="Estante A-3" /></Field>
        {!product && !hideInitialStock && <Field label="Existencia inicial" hint="Se registra como entrada"><Input type="number" min={0} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} /></Field>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("taxable")} /> Aplica ISV</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("active")} /> Activo</label>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

export function MovementDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { can } = useAuth();
  const [type, setType] = useState<MovementType>("in");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const moves = useMovements(product?.id, 15, !!product);

  useEffect(() => {
    if (product) {
      setType("in");
      setQty("");
      setCost(0);
      setReason("");
    }
  }, [product]);
  if (!product) return null;

  const n = Number(qty);
  const preview = type === "in" || type === "return" ? product.stock + n : type === "out" ? product.stock - n : n;

  const save = async () => {
    if (qty === "" || !(n >= 0) || (type !== "adjust" && n <= 0)) {
      toast.error("Ingrese una cantidad válida");
      return;
    }
    setSaving(true);
    try {
      const r = await registerInventoryMovement({ productId: product.id, type, qty: n, unitCost: type === "in" && cost > 0 ? cost : null, reason: reason.trim() });
      toast.success(`Existencia actualizada: ${r.stock}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title="Movimiento de inventario" description={`${product.name} · existencia actual: ${product.stock}`} footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button onClick={() => void save()} loading={saving}>Registrar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as MovementType)}>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>)}</Select></Field>
        <Field label={type === "adjust" ? "Existencia contada" : "Cantidad"} hint={qty !== "" && Number.isFinite(preview) ? `Quedará en ${preview}` : undefined}>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        {type === "in" && can("inventory.manage") && <Field label="Costo unitario de compra" hint="Actualiza el costo promedio"><MoneyInput value={cost} onChange={setCost} /></Field>}
        <Field label="Motivo / referencia" className={type === "in" ? "" : "sm:col-span-2"}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Factura #, conteo mensual, daño..." maxLength={300} /></Field>
      </div>
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold">Últimos movimientos</h3>
        {moves.loading ? <Skeleton className="h-20" /> : !moves.data.length ? <p className="text-sm text-slate-400">Sin movimientos</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {moves.data.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span><b className={m.qty < 0 || m.type === "out" ? "text-red-600" : "text-emerald-700"}>{m.type === "out" ? `-${m.qty}` : m.qty > 0 ? `+${m.qty}` : m.qty}</b> <span className="text-slate-600">{MOVEMENT_LABELS[m.type]}</span> <span className="text-xs text-slate-400">{m.reason}</span></span>
                <span className="shrink-0 text-xs text-slate-500">{m.stockBefore} → {m.stockAfter} · {formatDate(m.at, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
