import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Plus, Receipt, Wallet } from "lucide-react";
import { formatMoney, type Purchase } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { currentMonth, isOverdue, monthLabel, useOpenPurchases, usePurchases, type PurchaseFilter } from "./api";
import { isFinanceRole, MonthSwitcher, PaySupplierDialog, PurchaseDetailDialog, PurchaseStatusBadge, StatCard, VoidPurchaseDialog } from "./parts";

export function PurchasesPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const finance = isFinanceRole(role);
  const [filter, setFilter] = useState<PurchaseFilter>("due");
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error } = usePurchases(filter, month);
  const open = useOpenPurchases();
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [voiding, setVoiding] = useState<Purchase | null>(null);

  const totalDue = open.data.reduce((a, p) => a + p.balance, 0);
  const overdueList = open.data.filter((p) => isOverdue(p));
  const overdue = overdueList.reduce((a, p) => a + p.balance, 0);
  const monthTotal = filter === "all" ? data.filter((p) => p.status !== "voided").reduce((a, p) => a + p.total, 0) : 0;
  const current = viewing ? data.find((p) => p.id === viewing.id) ?? open.data.find((p) => p.id === viewing.id) ?? viewing : null;

  const actions = (p: Purchase) => (
    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {finance && (p.status === "pending" || p.status === "partial") && <Button size="sm" variant="secondary" icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(p)}>Pagar</Button>}
      {finance && p.status === "pending" && <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(p)} aria-label="Anular" title="Anular compra" />}
    </div>
  );

  return (
    <>
      <PageHeader title="Compras" description="Facturas de proveedores y cuentas por pagar. Las compras de repuestos suben la existencia del inventario." actions={<>
        <Button variant="secondary" onClick={() => navigate("/proveedores")}>Proveedores</Button>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate("/compras/nueva")}>Nueva compra</Button>
      </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total por pagar" value={open.loading ? "..." : formatMoney(totalDue)} hint={`${open.data.length} compras abiertas`} tone={totalDue > 0 ? "amber" : undefined} />
        <StatCard label="Vencido" value={open.loading ? "..." : formatMoney(overdue)} hint={overdueList.length ? `${overdueList.length} compras vencidas` : "Nada vencido"} tone={overdue > 0 ? "red" : "green"} />
        {filter === "all" && <StatCard label={`Compras de ${monthLabel(month).toLowerCase()}`} value={formatMoney(monthTotal)} hint={`${data.filter((p) => p.status !== "voided").length} facturas`} />}
      </div>

      <Card>
        <div className="flex flex-col gap-3 px-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={filter} onChange={setFilter} tabs={[
            { value: "due", label: "Por pagar", count: open.data.length },
            { value: "all", label: "Todas" },
            { value: "voided", label: "Anuladas" },
          ]} />
          {filter === "all" && <div className="pb-2 sm:pb-0"><MonthSwitcher month={month} onChange={setMonth} /></div>}
        </div>
        {error ? <ErrorState message={error} /> : loading && !data.length ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !data.length ? (
          <EmptyState icon={<Receipt className="h-7 w-7" />}
            title={filter === "due" ? "No hay cuentas por pagar" : filter === "voided" ? "No hay compras anuladas" : "Sin compras en este mes"}
            description={filter === "due" ? "Todas las compras están pagadas." : "Registre las facturas de sus proveedores para llevar el control."}
            action={filter !== "voided" && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate("/compras/nueva")}>Nueva compra</Button>} />
        ) : (
          <>
            {/* Escritorio */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-y border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Compra</th>
                    <th className="px-4 py-2 font-medium">Proveedor</th>
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-4 py-2 font-medium">Vence</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Pagado</th>
                    <th className="px-4 py-2 text-right font-medium">Saldo</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((p) => {
                    const late = isOverdue(p);
                    return (
                      <tr key={p.id} onClick={() => setViewing(p)} className={cn("cursor-pointer hover:bg-slate-50", p.status === "voided" && "text-slate-400", late && "bg-red-50/40")}>
                        <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{p.code}</div>{p.invoiceNumber && <div className="text-xs text-slate-500">Fact. {p.invoiceNumber}</div>}</td>
                        <td className="px-4 py-2.5"><Link to={`/proveedores/${p.supplierId}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand-700">{p.supplierName}</Link></td>
                        <td className="whitespace-nowrap px-4 py-2.5">{formatDate(p.date)}</td>
                        <td className={cn("whitespace-nowrap px-4 py-2.5", late && "font-semibold text-red-600")}>{p.dueDate ? formatDate(p.dueDate) : <span className="text-slate-400">Contado</span>}</td>
                        <td className={cn("tabular px-4 py-2.5 text-right", p.status === "voided" && "line-through")}>{formatMoney(p.total)}</td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-600">{formatMoney(p.paid)}</td>
                        <td className={cn("tabular px-4 py-2.5 text-right font-semibold", p.balance > 0 && (late ? "text-red-600" : "text-amber-700"))}>{formatMoney(p.balance)}</td>
                        <td className="px-4 py-2.5"><PurchaseStatusBadge p={p} /></td>
                        <td className="px-4 py-2.5">{actions(p)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Celular */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.map((p) => {
                const late = isOverdue(p);
                return (
                  <li key={p.id} onClick={() => setViewing(p)} className={cn("space-y-2 px-4 py-3", p.status === "voided" && "opacity-60", late && "bg-red-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.code}</span><PurchaseStatusBadge p={p} /></div>
                        <div className="truncate text-sm text-slate-700">{p.supplierName}</div>
                        <div className="text-xs text-slate-500">
                          {[formatDate(p.date), p.invoiceNumber && `Fact. ${p.invoiceNumber}`].filter(Boolean).join(" · ")}
                          {p.dueDate && <span className={cn(late && "font-semibold text-red-600")}> · Vence {formatDate(p.dueDate)}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("tabular font-semibold", p.status === "voided" && "line-through")}>{formatMoney(p.total)}</div>
                        {p.balance > 0 && <div className={cn("tabular text-xs font-semibold", late ? "text-red-600" : "text-amber-700")}>Saldo {formatMoney(p.balance)}</div>}
                      </div>
                    </div>
                    {finance && (p.status === "pending" || p.status === "partial") && actions(p)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <PurchaseDetailDialog purchase={current} onClose={() => setViewing(null)} canPay={finance} onPay={(p) => { setViewing(null); setPaying(p); }} onVoid={(p) => { setViewing(null); setVoiding(p); }} />
      <PaySupplierDialog purchase={paying} onClose={() => setPaying(null)} />
      <VoidPurchaseDialog purchase={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}
