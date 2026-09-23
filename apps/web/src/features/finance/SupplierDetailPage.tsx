import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Mail, MapPin, Pencil, Phone, Plus, Receipt } from "lucide-react";
import { formatMoney, PAYMENT_METHOD_LABELS, type Purchase } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageLoader, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { isOverdue, useSupplier, useSupplierPayments, useSupplierPurchases } from "./api";
import { isFinanceRole, PaySupplierDialog, PurchaseDetailDialog, PurchaseStatusBadge, StatCard, SupplierFormDialog, VoidPurchaseDialog } from "./parts";

export function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const finance = isFinanceRole(role);
  const { data: s, loading, error, exists } = useSupplier(id);
  const purchases = useSupplierPurchases(id);
  const payments = useSupplierPayments({ supplierId: id });
  const [tab, setTab] = useState<"purchases" | "payments">("purchases");
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [voiding, setVoiding] = useState<Purchase | null>(null);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;
  if (!exists || !s) return <EmptyState icon={<FileText className="h-7 w-7" />} title="Proveedor no encontrado" action={<Button variant="secondary" onClick={() => navigate("/proveedores")}>Volver a proveedores</Button>} />;

  const valid = purchases.data.filter((p) => p.status !== "voided");
  const overdue = valid.filter((p) => isOverdue(p)).reduce((a, p) => a + p.balance, 0);
  const totalBought = valid.reduce((a, p) => a + p.total, 0);
  const totalPaid = payments.data.filter((p) => p.status === "valid").reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <PageHeader
        back={{ to: "/proveedores", label: "Proveedores" }}
        title={<span className="flex flex-wrap items-center gap-2">{s.name}{!s.active && <Badge>Inactivo</Badge>}</span>}
        description={[s.categories, s.creditDays ? `Crédito a ${s.creditDays} días` : "Compras al contado"].filter(Boolean).join(" · ")}
        actions={<>
          <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>
          {s.active && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`/compras/nueva?proveedor=${s.id}`)}>Nueva compra</Button>}
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Saldo por pagar" value={formatMoney(s.balanceDue ?? 0)} tone={(s.balanceDue ?? 0) > 0 ? "amber" : "green"} />
        <StatCard label="Vencido" value={formatMoney(overdue)} tone={overdue > 0 ? "red" : undefined} />
        <StatCard label="Comprado" value={formatMoney(totalBought)} hint={`${valid.length} compras`} />
        <StatCard label="Pagado" value={formatMoney(totalPaid)} hint={`${payments.data.filter((p) => p.status === "valid").length} pagos`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Datos del proveedor" />
          <dl className="space-y-3 p-5 text-sm">
            {s.contactName && <Row label="Contacto">{s.contactName}</Row>}
            {s.phone && <Row label="Teléfono"><a href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 text-brand-700"><Phone className="h-3.5 w-3.5" />{s.phone}</a></Row>}
            {s.email && <Row label="Correo"><a href={`mailto:${s.email}`} className="inline-flex items-center gap-1.5 break-all text-brand-700"><Mail className="h-3.5 w-3.5" />{s.email}</a></Row>}
            {s.rtn && <Row label="RTN">{s.rtn}</Row>}
            {s.address && <Row label="Dirección"><span className="inline-flex gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{s.address}</span></Row>}
            <Row label="Crédito">{s.creditDays ? `${s.creditDays} días` : "Contado"}</Row>
            {s.notes && <Row label="Notas"><span className="whitespace-pre-line">{s.notes}</span></Row>}
            {!s.contactName && !s.phone && !s.email && !s.rtn && !s.address && <p className="text-slate-500">Sin datos de contacto. Toque Editar para agregarlos.</p>}
          </dl>
        </Card>

        <Card>
          <div className="px-4 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: "purchases", label: "Compras", count: purchases.data.length },
              { value: "payments", label: "Pagos", count: payments.data.length },
            ]} />
          </div>
          {tab === "purchases" ? (
            purchases.error ? <ErrorState message={purchases.error} /> : purchases.loading ? <div className="p-5"><Skeleton className="h-20" /></div> : !purchases.data.length ? (
              <EmptyState icon={<Receipt className="h-7 w-7" />} title="Sin compras registradas" description="Registre las facturas de este proveedor para llevar el saldo y actualizar el inventario." action={s.active && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate(`/compras/nueva?proveedor=${s.id}`)}>Nueva compra</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {purchases.data.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setViewing(p)} className={cn("flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50", p.status === "voided" && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.code}</span><PurchaseStatusBadge p={p} /></div>
                        <div className="text-xs text-slate-500">{[formatDate(p.date), p.invoiceNumber && `Fact. ${p.invoiceNumber}`, p.dueDate && `Vence ${formatDate(p.dueDate)}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="text-right">
                        <div className={cn("tabular font-semibold", p.status === "voided" && "line-through")}>{formatMoney(p.total)}</div>
                        {p.balance > 0 && <div className="tabular text-xs font-medium text-amber-700">Saldo {formatMoney(p.balance)}</div>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : payments.error ? <ErrorState message={payments.error} /> : payments.loading ? <div className="p-5"><Skeleton className="h-20" /></div> : !payments.data.length ? (
            <EmptyState icon={<Receipt className="h-7 w-7" />} title="Sin pagos registrados" description="Los pagos se registran desde cada compra en la pantalla de Compras." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {payments.data.map((p) => (
                <li key={p.id} className={cn("flex items-center gap-3 px-5 py-3", p.status === "voided" && "text-slate-400 line-through")}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{p.code} <span className="font-normal text-slate-500">· compra {p.purchaseCode}</span></div>
                    <div className="text-xs text-slate-500">{[formatDate(p.at, true), PAYMENT_METHOD_LABELS[p.method], p.reference, p.byName].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="tabular font-semibold">{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SupplierFormDialog open={editing} supplier={s} onClose={() => setEditing(false)} />
      <PurchaseDetailDialog purchase={viewing ? purchases.data.find((p) => p.id === viewing.id) ?? viewing : null} onClose={() => setViewing(null)} canPay={finance} onPay={(p) => { setViewing(null); setPaying(p); }} onVoid={(p) => { setViewing(null); setVoiding(p); }} />
      <PaySupplierDialog purchase={paying} onClose={() => setPaying(null)} />
      <VoidPurchaseDialog purchase={voiding} onClose={() => setVoiding(null)} />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
