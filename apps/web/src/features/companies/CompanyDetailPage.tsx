import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BarChart3, Building2, Car, ChevronLeft, ClipboardList, FileText, Mail, MapPin, MessageCircle, Pencil, Phone, ShieldCheck, User, WalletCards } from "lucide-react";
import {
  formatMoney, formatPhone, hnDayKey, paymentTermsDetail, whatsappLink,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { ReferralCard } from "@/features/commissions/ReferralDialog";
import { useCompany, useCompanyOrders, useCompanyPayments, useCompanyPaymentsReceived, useCompanySales, useCompanyVehicles } from "./api";
import { TermsBadge } from "./CompaniesPage";
import { CompanyFormDialog } from "./CompanyFormDialog";
import { FleetTab } from "./FleetTab";
import { OrdersTab } from "./OrdersTab";
import { ReportTab } from "./ReportTab";
import { StatementTab } from "./StatementTab";
import { statementRows, statementSummary } from "./statement";

type Tab = "flota" | "ordenes" | "cuenta" | "reporte";

function Info({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="break-words text-sm font-medium text-slate-900">{children}</div>
      </div>
    </div>
  );
}

/** Ficha de la empresa: datos, flota, órdenes, estado de cuenta y reporte. */
export function CompanyDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const money = can("payments.read");
  const reports = can("reports.financial");
  const [params, setParams] = useSearchParams();
  const company = useCompany(id);
  const vehicles = useCompanyVehicles(id);
  const orders = useCompanyOrders(id);
  const receipts = useCompanyPaymentsReceived(id, money);
  const companyPayments = useCompanyPayments(money ? id : undefined);
  const sales = useCompanySales(id, reports);
  const [editing, setEditing] = useState(false);

  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && ["flota", "ordenes", "cuenta", "reporte"].includes(tabParam) && (tabParam !== "cuenta" || money) && (tabParam !== "reporte" || reports) ? tabParam : "flota";
  const setTab = (t: Tab) => setParams((p) => { p.set("tab", t); return p; }, { replace: true });

  const c = company.data;
  const today = hnDayKey(Date.now());
  const summary = useMemo(() => statementSummary(statementRows(c, orders.data, today), today), [c, orders.data, today]);

  if (company.loading) return <PageLoader />;
  if (company.error) return <ErrorState message={company.error} />;
  if (!company.exists || !c) {
    return <EmptyState icon={<Building2 className="h-7 w-7" />} title="Empresa no encontrada" action={<Link to="/empresas" className="font-semibold text-brand-700">Volver a empresas</Link>} />;
  }

  const activeVehicles = vehicles.data.filter((v) => !v.archived).length;
  const open = orders.data.filter((o) => o.isOpen).length;
  const tabs: Array<{ value: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { value: "flota", label: "Flota", icon: <Car className="h-4 w-4" />, count: activeVehicles },
    { value: "ordenes", label: "Órdenes", icon: <ClipboardList className="h-4 w-4" />, count: orders.data.length },
    ...(money ? [{ value: "cuenta" as Tab, label: "Estado de cuenta", icon: <WalletCards className="h-4 w-4" /> }] : []),
    ...(reports ? [{ value: "reporte" as Tab, label: "Reporte", icon: <BarChart3 className="h-4 w-4" /> }] : []),
  ];

  return (
    <>
      <Link to="/empresas" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700"><ChevronLeft className="h-4 w-4" /> Empresas</Link>

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 sm:flex"><Building2 className="h-7 w-7" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{c.name}</h1>
                <TermsBadge company={c} />
                {c.active === false && <Badge tone="gray">Inactiva</Badge>}
              </div>
              <div className="mt-0.5 text-sm text-slate-500">{[c.legalName, c.rtn && `RTN ${c.rtn}`].filter(Boolean).join(" · ") || "Empresa con flota"}</div>
              <div className="mt-1 text-xs text-slate-500">{paymentTermsDetail(c)}{c.discountPct ? ` Descuento sugerido: ${c.discountPct}%.` : ""}{c.referral ? ` Referido por ${c.referral.referrerName} (${c.referral.pct}% de la utilidad).` : ""}</div>
            </div>
          </div>
          {can("companies.write") && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>
            </div>
          )}
        </div>
        <div className={cn("grid grid-cols-2 divide-slate-100 border-t border-slate-100 bg-slate-50/60", money ? "sm:grid-cols-4 sm:divide-x" : "sm:grid-cols-2 sm:divide-x")}>
          <Metric label="Vehículos" value={activeVehicles} />
          <Metric label="En el taller" value={open} />
          {money && <Metric label="Saldo" value={formatMoney(summary.total)} tone={summary.total > 0 ? "text-slate-900" : "text-emerald-700"} />}
          {money && <Metric label="Vencido" value={formatMoney(summary.overdue)} tone={summary.overdue > 0 ? "text-red-600" : "text-slate-900"} hint={c.creditLimit && summary.total > c.creditLimit ? "Supera el límite de crédito" : undefined} />}
        </div>
      </Card>

      <div className="grid gap-5 2xl:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <div className="px-3 pt-1"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
          {tab === "flota" && <FleetTab company={c} vehicles={vehicles.data} orders={orders.data} loading={vehicles.loading} error={vehicles.error} />}
          {tab === "ordenes" && <OrdersTab company={c} orders={orders.data} loading={orders.loading} error={orders.error} showMoney={money} />}
          {tab === "cuenta" && money && <StatementTab company={c} orders={orders.data} receipts={receipts.data} companyPayments={companyPayments.data} loading={orders.loading} error={orders.error ?? receipts.error} />}
          {tab === "reporte" && reports && <ReportTab company={c} orders={orders.data} receipts={receipts.data} sales={sales.data} loading={orders.loading || receipts.loading} error={orders.error ?? receipts.error} />}
        </Card>

        <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
          <Card>
            <CardHeader title="Contacto" />
            <div className="space-y-3.5 p-5">
              <Info icon={<User className="h-4 w-4" />} label="Persona de contacto">{c.contactName || <span className="font-normal text-slate-400">Sin registrar</span>}</Info>
              {c.contactPhone && (
                <Info icon={<Phone className="h-4 w-4" />} label="Teléfono">
                  <span className="flex items-center gap-2">{formatPhone(c.contactPhone)}<a href={whatsappLink(c.contactPhone)} target="_blank" rel="noreferrer" className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a></span>
                </Info>
              )}
              {c.contactEmail && <Info icon={<Mail className="h-4 w-4" />} label="Correo">{c.contactEmail}</Info>}
              {c.address && <Info icon={<MapPin className="h-4 w-4" />} label="Dirección">{c.address}</Info>}
              {c.approverName && (
                <Info icon={<ShieldCheck className="h-4 w-4" />} label="Encargado de flota (aprueba cotizaciones)">
                  <span className="flex items-center gap-2">{c.approverName}{c.approverPhone && <span className="font-normal text-slate-500">{formatPhone(c.approverPhone)}</span>}</span>
                </Info>
              )}
              {c.notes && <Info icon={<FileText className="h-4 w-4" />} label="Notas"><span className="whitespace-pre-line font-normal text-slate-700">{c.notes}</span></Info>}
            </div>
          </Card>
          <ReferralCard target="company" targetId={c.id} targetName={c.name} referral={c.referral} />
        </div>
      </div>

      <CompanyFormDialog open={editing} company={c} onClose={() => setEditing(false)} />
    </>
  );
}

function Metric({ label, value, tone = "text-slate-900", hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="px-5 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("tabular text-lg font-bold", tone)}>{value}</div>
      {hint && <div className="text-[11px] font-medium text-red-600">{hint}</div>}
    </div>
  );
}
