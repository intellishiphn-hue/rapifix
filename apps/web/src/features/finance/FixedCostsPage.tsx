import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, PiggyBank, Plus, Power, Repeat, Users } from "lucide-react";
import {
  EXPENSE_CATEGORIES, EXPENSE_UNIT_LABELS, EXPENSE_UNITS, FIXED_COST_FREQUENCY_LABELS, formatMoney, isRole, MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS, ROLE_LABELS, saveFixedCostSchema,
  type ExpenseUnit, type FixedCost, type FixedCostFrequency, type ManualPaymentMethod, type SaveFixedCostInput,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { useStaffDirectory } from "@/features/work-orders/api";
import { currentMonth, saveFinanceBudget, saveFixedCost, useActiveSuppliers, useFinanceBudget, useFixedCosts } from "./api";
import { StatCard } from "./parts";
import { useEnsureFixedCostsGenerated } from "./PendingExpenses";

const SALARY = "Salarios";

const scheduleLabel = (fc: Pick<FixedCost, "frequency" | "dayOfMonth">) =>
  fc.frequency === "biweekly" ? "Quincenal: días 15 y fin de mes" : `Mensual: día ${fc.dayOfMonth}`;

function toInput(fc: FixedCost): SaveFixedCostInput {
  return {
    fixedCostId: fc.id, name: fc.name, category: fc.category as SaveFixedCostInput["category"], amount: fc.amount, frequency: fc.frequency,
    dayOfMonth: fc.dayOfMonth || 1, unit: fc.unit ?? "general", employeeName: fc.employeeName ?? "", defaultMethod: fc.defaultMethod ?? "transfer",
    notes: fc.notes ?? "", active: fc.active, startMonth: fc.startMonth,
    ...(fc.employeeId ? { employeeId: fc.employeeId } : {}),
    ...(fc.supplierId ? { supplierId: fc.supplierId } : {}),
    ...(fc.endMonth ? { endMonth: fc.endMonth } : {}),
  };
}

export function FixedCostsPage() {
  const { data, loading, error } = useFixedCosts();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null | undefined>(undefined);
  const [salaries, setSalaries] = useState(false);
  const [budget, setBudget] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  useEnsureFixedCostsGenerated();

  const month = currentMonth();
  const activeNow = data.filter((f) => f.active && f.startMonth <= month && (!f.endMonth || month <= f.endMonth));
  const total = activeNow.reduce((a, f) => a + f.amount, 0);
  const byUnit = EXPENSE_UNITS.map((u) => [u, activeNow.filter((f) => (f.unit ?? "general") === u).reduce((a, f) => a + f.amount, 0)] as const);
  const shown = showInactive ? data : data.filter((f) => f.active);
  const groups = useMemo(() => {
    const m = new Map<string, FixedCost[]>();
    shown.forEach((f) => m.set(f.category, [...(m.get(f.category) ?? []), f]));
    return [...m.entries()]
      .map(([category, items]) => ({ category, items, total: items.filter((f) => activeNow.includes(f)).reduce((a, f) => a + f.amount, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [shown, activeNow]);

  const toggle = async (fc: FixedCost) => {
    setToggling(fc.id);
    try {
      await saveFixedCost({ ...toInput(fc), active: !fc.active });
      toast.success(fc.active ? `${fc.name}: desactivado. Si este mes estaba pendiente, ya no se cobra.` : `${fc.name}: activado`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Gastos fijos"
        description="Lo que el negocio paga todos los meses: alquiler, salarios, luz, internet. Cada mes aparecen solos en Gastos como pendientes por pagar."
        actions={<>
          <Button variant="secondary" icon={<PiggyBank className="h-4 w-4" />} onClick={() => setBudget(true)}>Presupuesto</Button>
          <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => setSalaries(true)}>Agregar salarios de empleados</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo gasto fijo</Button>
        </>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total fijo al mes" value={formatMoney(total)} hint={`${activeNow.length} gastos activos`} />
        {byUnit.map(([u, amt]) => (
          <StatCard key={u} label={u === "general" ? "General (compartido)" : EXPENSE_UNIT_LABELS[u]} value={formatMoney(amt)} hint={total ? `${Math.round((amt / total) * 100)}% del total` : undefined} />
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div className="text-sm text-slate-600">Montos mensuales. Los quincenales se pagan en dos partes iguales.</div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Ver inactivos</label>
        </div>
        {error ? <ErrorState message={error} /> : loading && !data.length ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !groups.length ? (
          <EmptyState
            icon={<Repeat className="h-7 w-7" />}
            title="Aún no hay gastos fijos"
            description="Agregue el alquiler, los salarios y los servicios. Así cada mes sabrá cuánto cuesta abrir el negocio y cuánto necesita vender."
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>Nuevo gasto fijo</Button>}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => (
              <section key={g.category}>
                <div className="flex items-center justify-between bg-slate-50/70 px-5 py-2 text-sm">
                  <span className="font-semibold text-slate-800">{g.category}</span>
                  <span className="tabular font-semibold text-slate-900">{formatMoney(g.total)} <span className="text-xs font-normal text-slate-500">/ mes</span></span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.items.map((f) => (
                    <li key={f.id} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", !f.active && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{f.name}</span>
                          {!f.active && <Badge tone="gray">Inactivo</Badge>}
                          {(f.unit ?? "general") !== "general" && <Badge tone={f.unit === "carwash" ? "blue" : "gray"}>{EXPENSE_UNIT_LABELS[f.unit]}</Badge>}
                          {f.active && f.startMonth > month && <Badge tone="amber">Desde {f.startMonth}</Badge>}
                          {f.endMonth && <Badge tone="gray">Hasta {f.endMonth}</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {[scheduleLabel(f), PAYMENT_METHOD_LABELS[f.defaultMethod], f.employeeName, f.supplierName, f.notes].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <span className="tabular w-28 font-semibold sm:text-right">{formatMoney(f.amount)}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(f)} aria-label="Editar" title="Editar" />
                          <Button size="sm" variant="ghost" icon={<Power className="h-4 w-4" />} loading={toggling === f.id} onClick={() => void toggle(f)} aria-label={f.active ? "Desactivar" : "Activar"} title={f.active ? "Desactivar" : "Activar"} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-500">
        Cambiar un gasto fijo actualiza el pendiente de este mes (si no lo ha pagado ni ajustado) y los meses siguientes. Lo ya pagado no cambia.
      </p>

      <FixedCostDialog open={editing !== undefined} fixedCost={editing ?? null} onClose={() => setEditing(undefined)} />
      <SalariesDialog open={salaries} existing={data} onClose={() => setSalaries(false)} />
      <BudgetDialog open={budget} onClose={() => setBudget(false)} />
    </>
  );
}

// ---------- Crear / editar ----------
function emptyForm(): SaveFixedCostInput {
  return {
    name: "", category: "Alquiler", amount: 0, frequency: "monthly", dayOfMonth: 1, unit: "general", employeeName: "",
    defaultMethod: "transfer", notes: "", active: true, startMonth: currentMonth(),
  };
}

function FixedCostDialog({ open, fixedCost, onClose }: { open: boolean; fixedCost: FixedCost | null; onClose: () => void }) {
  const staff = useStaffDirectory();
  const suppliers = useActiveSuppliers();
  const [form, setForm] = useState<SaveFixedCostInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm(fixedCost ? toInput(fixedCost) : emptyForm());
  }, [open, fixedCost]);
  const set = <K extends keyof SaveFixedCostInput>(k: K, v: SaveFixedCostInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const omit = (k: keyof SaveFixedCostInput) => setForm((f) => { const n = { ...f }; delete n[k]; return n; });

  const save = async () => {
    const parsed = saveFixedCostSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revise los datos");
    setSaving(true);
    try {
      await saveFixedCost(parsed.data);
      toast.success(fixedCost ? "Gasto fijo actualizado" : "Gasto fijo creado. Ya aparece en Gastos como pendiente de este mes.");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isSalary = form.category === SALARY;
  const activeStaff = staff.data.filter((s) => s.active || s.id === form.employeeId);

  return (
    <Dialog open={open} onClose={onClose} title={fixedCost ? "Editar gasto fijo" : "Nuevo gasto fijo"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={saving}>Guardar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="Ej. Alquiler del local, Energía eléctrica, Salario de Juan" autoFocus /></Field>
        <Field label="Categoría" required>
          <Select value={form.category} onChange={(e) => set("category", e.target.value as SaveFixedCostInput["category"])}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Monto al mes" required hint={form.frequency === "biweekly" && form.amount > 0 ? `Dos pagos de ${formatMoney(Math.floor(form.amount / 2))}` : "Si varía (como la luz), ponga un promedio."}>
          <MoneyInput value={form.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field label="Cada cuánto se paga">
          <Select value={form.frequency} onChange={(e) => set("frequency", e.target.value as FixedCostFrequency)}>
            <option value="monthly">{FIXED_COST_FREQUENCY_LABELS.monthly}</option>
            <option value="biweekly">Quincenal (días 15 y fin de mes)</option>
          </Select>
        </Field>
        {form.frequency === "monthly" ? (
          <Field label="Día de pago" hint="Si el mes es más corto, se usa el último día.">
            <Input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => set("dayOfMonth", Math.max(1, Math.min(31, Math.round(Number(e.target.value) || 1))))} />
          </Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Negocio" hint="General = se reparte entre taller y carwash">
          <Select value={form.unit} onChange={(e) => set("unit", e.target.value as ExpenseUnit)}>
            {EXPENSE_UNITS.map((u) => <option key={u} value={u}>{u === "general" ? "General (taller y carwash)" : EXPENSE_UNIT_LABELS[u]}</option>)}
          </Select>
        </Field>
        <Field label="Método de pago habitual">
          <Select value={form.defaultMethod} onChange={(e) => set("defaultMethod", e.target.value as ManualPaymentMethod)}>
            {MANUAL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </Select>
        </Field>
        {isSalary ? (
          <>
            <Field label="Empleado" hint="Usuarios del sistema">
              <Select value={form.employeeId ?? ""} onChange={(e) => {
                const s = activeStaff.find((x) => x.id === e.target.value);
                if (!s) { omit("employeeId"); return; }
                setForm((f) => ({ ...f, employeeId: s.id, employeeName: s.displayName, name: f.name || `Salario de ${s.displayName}` }));
              }}>
                <option value="">Otra persona (escribir nombre)</option>
                {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
              </Select>
            </Field>
            <Field label="Nombre del empleado"><Input value={form.employeeName} disabled={!!form.employeeId} onChange={(e) => set("employeeName", e.target.value)} maxLength={80} /></Field>
          </>
        ) : (
          <Field label="Proveedor" hint="Opcional" className="sm:col-span-2">
            <Select value={form.supplierId ?? ""} onChange={(e) => (e.target.value ? set("supplierId", e.target.value) : omit("supplierId"))}>
              <option value="">Ninguno</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {fixedCost?.supplierId && !suppliers.data.some((s) => s.id === fixedCost.supplierId) && <option value={fixedCost.supplierId}>{fixedCost.supplierName || "Proveedor"}</option>}
            </Select>
          </Field>
        )}
        <Field label="Desde (mes)" required><Input type="month" value={form.startMonth} onChange={(e) => e.target.value && set("startMonth", e.target.value)} /></Field>
        <Field label="Hasta (mes)" hint="Opcional. Vacío = sin fecha final.">
          <Input type="month" value={form.endMonth ?? ""} min={form.startMonth} onChange={(e) => (e.target.value ? set("endMonth", e.target.value) : omit("endMonth"))} />
        </Field>
        <Field label="Notas" className="sm:col-span-2"><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={500} placeholder="Ej. Contrato vence en diciembre, número de medidor..." /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Activo</label>
      </div>
    </Dialog>
  );
}

// ---------- Agregar salarios de empleados ----------
interface SalaryRow {
  key: string;
  employeeId: string | null;
  name: string;
  role: string;
  checked: boolean;
  amount: number;
  frequency: FixedCostFrequency;
  unit: ExpenseUnit;
}

function SalariesDialog({ open, existing, onClose }: { open: boolean; existing: FixedCost[]; onClose: () => void }) {
  const staff = useStaffDirectory();
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const has = new Set(existing.filter((f) => f.active && f.category === SALARY && f.employeeId).map((f) => f.employeeId));
    setRows(staff.data.filter((s) => s.active && !has.has(s.id)).map((s) => ({
      key: s.id, employeeId: s.id, name: s.displayName, role: isRole(s.role) ? ROLE_LABELS[s.role] : s.role,
      checked: true, amount: 0, frequency: "biweekly", unit: "shop",
    })));
  }, [open, staff.data.length]); // solo al abrir (o cuando carga el directorio)

  const upd = (key: string, p: Partial<SalaryRow>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const addOther = () => setRows((r) => [...r, { key: `otro-${Date.now()}`, employeeId: null, name: "", role: "Sin usuario en el sistema", checked: true, amount: 0, frequency: "biweekly", unit: "shop" }]);
  const chosen = rows.filter((r) => r.checked);
  const total = chosen.reduce((a, r) => a + r.amount, 0);

  const save = async () => {
    if (!chosen.length) return toast.error("Marque al menos un empleado");
    const missing = chosen.find((r) => r.amount <= 0 || r.name.trim().length < 2);
    if (missing) return toast.error(missing.name.trim().length < 2 ? "Escriba el nombre de cada persona" : `Indique el salario de ${missing.name}`);
    setSaving(true);
    let ok = 0;
    try {
      for (const r of chosen) {
        await saveFixedCost({
          name: `Salario de ${r.name.trim()}`, category: SALARY, amount: r.amount, frequency: r.frequency, dayOfMonth: 31, unit: r.unit,
          employeeName: r.name.trim(), defaultMethod: "transfer", notes: "", active: true, startMonth: currentMonth(),
          ...(r.employeeId ? { employeeId: r.employeeId } : {}),
        });
        ok++;
      }
      toast.success(`${ok} salarios agregados como gastos fijos`);
      onClose();
    } catch (err) {
      toast.error(`${ok ? `Se guardaron ${ok}. ` : ""}${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Agregar salarios de empleados"
      description="Una línea por persona con su salario mensual. Quincenal = dos pagos el 15 y fin de mes."
      footer={<>
        <div className="mr-auto self-center text-sm text-slate-600">Total: <b className="tabular text-slate-900">{formatMoney(total)}</b> al mes</div>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => void save()} loading={saving}>Agregar {chosen.length || ""}</Button>
      </>}>
      <div className="space-y-3">
        {staff.loading ? <Skeleton className="h-24" /> : !rows.length && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Todos los empleados activos ya tienen su salario como gasto fijo. Puede agregar personas que no usan el sistema.</p>
        )}
        {rows.map((r) => (
          <div key={r.key} className={cn("grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_150px_150px_130px] sm:items-center", r.checked ? "border-slate-200" : "border-slate-100 opacity-60")}>
            <label className="flex min-w-0 items-center gap-2">
              <input type="checkbox" checked={r.checked} onChange={(e) => upd(r.key, { checked: e.target.checked })} />
              {r.employeeId ? (
                <span className="min-w-0"><span className="block truncate font-medium text-slate-900">{r.name}</span><span className="block text-xs text-slate-500">{r.role}</span></span>
              ) : (
                <Input value={r.name} onChange={(e) => upd(r.key, { name: e.target.value })} maxLength={80} placeholder="Nombre" />
              )}
            </label>
            <MoneyInput value={r.amount} onChange={(v) => upd(r.key, { amount: v })} placeholder="Salario mensual" />
            <Select value={r.frequency} onChange={(e) => upd(r.key, { frequency: e.target.value as FixedCostFrequency })}>
              <option value="biweekly">Quincenal</option>
              <option value="monthly">Mensual (fin de mes)</option>
            </Select>
            <Select value={r.unit} onChange={(e) => upd(r.key, { unit: e.target.value as ExpenseUnit })}>
              {EXPENSE_UNITS.map((u) => <option key={u} value={u}>{EXPENSE_UNIT_LABELS[u]}</option>)}
            </Select>
          </div>
        ))}
        <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={addOther}>Agregar persona sin usuario</Button>
      </div>
    </Dialog>
  );
}

// ---------- Presupuesto de gastos variables ----------
function BudgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const budget = useFinanceBudget();
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setValues({ ...(budget.data?.budgets ?? {}) });
  }, [open, budget.data]);
  const total = Object.values(values).reduce((a, v) => a + (v || 0), 0);
  const save = async () => {
    setSaving(true);
    try {
      await saveFinanceBudget({ budgets: Object.fromEntries(Object.entries(values).filter(([, v]) => v > 0)) });
      toast.success("Presupuesto guardado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Presupuesto mensual de gastos variables"
      description="Opcional. Cuánto piensa gastar al mes por categoría en gastos que no son fijos (insumos, publicidad, combustible...). En el cierre del mes se compara con lo gastado."
      footer={<>
        <div className="mr-auto self-center text-sm text-slate-600">Total: <b className="tabular text-slate-900">{formatMoney(total)}</b></div>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => void save()} loading={saving}>Guardar</Button>
      </>}>
      <Card className="shadow-none">
        <CardHeader title="Por categoría" description="Deje en 0 las que no quiera controlar." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          {EXPENSE_CATEGORIES.map((c) => (
            <Field key={c} label={c}><MoneyInput value={values[c] ?? 0} onChange={(v) => setValues((s) => ({ ...s, [c]: v }))} /></Field>
          ))}
        </div>
      </Card>
    </Dialog>
  );
}
