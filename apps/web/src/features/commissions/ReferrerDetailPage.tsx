import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, HandCoins, Mail, MessageCircle, Pencil, Phone, Printer, User, UserRound, Wallet } from "lucide-react";
import { formatMoney, formatPhone, isReferralActive, PAYMENT_METHOD_LABELS, referralLabel, whatsappLink, type ReferralCommission } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { KpiCard, RichTable } from "@/features/finance-analytics/components";
import { useReferred, useReferrer, useReferrerCommissions, useReferrerPayouts } from "./api";
import { commissionCols } from "./CommissionsPage";
import { PayCommissionsDialog, VoidCommissionDialog } from "./PayCommissionsDialog";
import { ReferrerFormDialog } from "./ReferrerFormDialog";

/** Ficha del referido: datos, a quién refirió y lo que ha ganado, cobrado y tiene pendiente. */
export function ReferrerDetailPage() {
  const { id } = useParams();
  const { role } = useAuth();
  const referrer = useReferrer(id);
  const commissions = useReferrerCommissions(id);
  const payouts = useReferrerPayouts(id);
  const referred = useReferred(id);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [acting, setActing] = useState<{ c: ReferralCommission; mode: "void" | "reviewed" } | null>(null);

  const stats = useMemo(() => {
    const valid = commissions.data.filter((c) => c.status !== "voided");
    const pending = commissions.data.filter((c) => c.status === "pending");
    return {
      earned: valid.reduce((a, c) => a + c.amount, 0),
      paid: valid.filter((c) => c.status === "paid").reduce((a, c) => a + c.amount, 0),
      pending,
      pendingTotal: pending.reduce((a, c) => a + c.amount, 0),
      orders: valid.length,
    };
  }, [commissions.data]);

  if (referrer.loading) return <PageLoader />;
  if (referrer.error) return <ErrorState message={referrer.error} />;
  const r = referrer.data;
  if (!referrer.exists || !r) return <EmptyState icon={<UserRound className="h-7 w-7" />} title="Referido no encontrado" action={<Link to="/comisiones" className="font-semibold text-brand-700">Volver a comisiones</Link>} />;

  const actions = role === "admin" ? (c: ReferralCommission) => (
    c.status === "pending" ? <button onClick={() => setActing({ c, mode: "void" })} className="text-xs font-semibold text-red-600 hover:underline">Anular</button>
      : c.needsReview ? <button onClick={() => setActing({ c, mode: "reviewed" })} className="text-xs font-semibold text-brand-700 hover:underline">Revisar</button> : null
  ) : undefined;

  return (
    <>
      <PageHeader
        back={{ to: "/comisiones", label: "Comisiones" }}
        title={<span className="flex flex-wrap items-center gap-3">{r.name}{!r.active && <Badge tone="gray">Inactivo</Badge>}</span>}
        description={`${r.defaultPct}% de la utilidad por defecto · aplica a órdenes del taller (el carwash y el punto de venta no generan comisión)`}
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>
            {stats.pending.length > 0 && <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setPaying(true)}>Pagar {formatMoney(stats.pendingTotal)}</Button>}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total ganado" value={formatMoney(stats.earned)} sub={`${stats.orders} ${stats.orders === 1 ? "orden" : "órdenes"}`} />
        <KpiCard label="Pagado" value={formatMoney(stats.paid)} tone="text-emerald-700" />
        <KpiCard label="Pendiente" value={formatMoney(stats.pendingTotal)} tone={stats.pendingTotal > 0 ? "text-amber-700" : "text-slate-900"} />
        <KpiCard label="Refiere a" value={referred.companies.data.length + referred.customers.data.length} sub={`${referred.companies.data.length} empresas · ${referred.customers.data.length} clientes`} />
      </div>

      <div className="grid gap-5 2xl:grid-cols-[320px_1fr]">
        <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-1">
          <Card>
            <CardHeader title="Datos" />
            <div className="space-y-3 p-5 text-sm">
              <Row icon={<Phone className="h-4 w-4" />} label="Teléfono"><span className="flex items-center gap-2">{formatPhone(r.phone)}<a href={whatsappLink(r.phone)} target="_blank" rel="noreferrer" className="text-emerald-600" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a></span></Row>
              {r.email && <Row icon={<Mail className="h-4 w-4" />} label="Correo">{r.email}</Row>}
              {r.idNumber && <Row icon={<User className="h-4 w-4" />} label="Identidad">{r.idNumber}</Row>}
              <Row icon={<Wallet className="h-4 w-4" />} label="Cómo se le paga">{r.paymentMethod || <span className="text-slate-400">Sin indicar</span>}</Row>
              {r.notes && <p className="whitespace-pre-line border-t border-slate-100 pt-3 text-slate-600">{r.notes}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="A quién refirió" />
            {!referred.companies.data.length && !referred.customers.data.length ? (
              <p className="px-5 py-4 text-sm text-slate-500">Todavía no tiene empresas ni clientes asignados. Asígnelo desde la ficha de la empresa o del cliente.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {referred.companies.data.map((c) => (
                  <li key={c.id}><Link to={`/empresas/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50"><Building2 className="h-4 w-4 text-slate-400" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{c.name}</span>{c.referral && <span className="block truncate text-xs text-slate-500">{referralLabel(c.referral)}</span>}</span>{c.referral && <Badge tone={isReferralActive(c.referral, Date.now()) ? "green" : "gray"}>{isReferralActive(c.referral, Date.now()) ? "Vigente" : "Vencida"}</Badge>}</Link></li>
                ))}
                {referred.customers.data.map((c) => (
                  <li key={c.id}><Link to={`/clientes/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50"><User className="h-4 w-4 text-slate-400" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{c.fullName}</span>{c.referral && <span className="block truncate text-xs text-slate-500">{referralLabel(c.referral)}</span>}</span>{c.referral && <Badge tone={isReferralActive(c.referral, Date.now()) ? "green" : "gray"}>{isReferralActive(c.referral, Date.now()) ? "Vigente" : "Vencida"}</Badge>}</Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {commissions.error ? <Card><ErrorState message={commissions.error} /></Card> : (
            <RichTable title="Comisiones por orden" description="Todas, de la más reciente a la más vieja." cols={commissionCols({ actions })} rows={commissions.data} rowKey={(c) => c.id} maxRows={15} empty="Todavía no ha ganado comisiones." />
          )}
          <Card>
            <CardHeader title="Pagos recibidos" />
            {!payouts.data.length ? <p className="px-5 py-4 text-sm text-slate-500">Sin pagos todavía.</p> : (
              <ul className="divide-y divide-slate-100">
                {payouts.data.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{p.code} <span className="font-normal text-slate-500">· {formatDate(p.at)}</span></div>
                      <div className="truncate text-xs text-slate-500">{PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ref. ${p.reference}` : ""} · {p.orderCodes.join(", ")}</div>
                    </div>
                    <span className="tabular text-sm font-bold text-emerald-700">{formatMoney(p.amount)}</span>
                    <a href={`/imprimir/comision/${p.id}`} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Comprobante" aria-label={`Comprobante ${p.code}`}><Printer className="h-4 w-4" /></a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ReferrerFormDialog open={editing} referrer={r} onClose={() => setEditing(false)} />
      {paying && <PayCommissionsDialog referrer={r} pending={stats.pending} onClose={() => setPaying(false)} />}
      {acting && <VoidCommissionDialog commission={acting.c} mode={acting.mode} onClose={() => setActing(null)} />}
    </>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0"><div className="text-xs text-slate-500">{label}</div><div className="break-words font-medium text-slate-900">{children}</div></div>
    </div>
  );
}
