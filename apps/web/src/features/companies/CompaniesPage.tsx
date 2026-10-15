import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Car, ChevronRight, Plus, Search, X } from "lucide-react";
import { formatMoney, formatPhone, normalizeText, paymentTermsLabel, type Company } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { StatCard } from "@/features/finance/parts";
import { useCompanies } from "./api";
import { CompanyFormDialog } from "./CompanyFormDialog";

export function TermsBadge({ company }: { company: Pick<Company, "paymentTerms" | "creditDays" | "cutoffDay" | "monthlyDueDays"> }) {
  const tone = company.paymentTerms === "cash" ? "gray" : company.paymentTerms === "credit" ? "blue" : "amber";
  return <Badge tone={tone}>{paymentTermsLabel(company)}</Badge>;
}

/** Lista de empresas con flota. */
export function CompaniesPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const money = can("payments.read");
  const companies = useCompanies();
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const q = normalizeText(search);
    return companies.data
      .filter((c) => (inactive ? true : c.active !== false))
      .filter((c) => !q || normalizeText([c.name, c.legalName, c.rtn, c.contactName, c.referral?.referrerName].filter(Boolean).join(" ")).includes(q));
  }, [companies.data, search, inactive]);

  const activeList = companies.data.filter((c) => c.active !== false);
  const totalVehicles = activeList.reduce((a, c) => a + (c.vehicleCount ?? 0), 0);
  const totalBalance = activeList.reduce((a, c) => a + (c.balanceDue ?? 0), 0);
  const totalOpen = activeList.reduce((a, c) => a + (c.openOrders ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Clientes con flota: sus vehículos, órdenes, estado de cuenta y reportes."
        actions={can("companies.write") && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nueva empresa</Button>}
      />

      <div className={cn("mb-5 grid grid-cols-2 gap-3", money ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <StatCard label="Empresas activas" value={activeList.length} />
        <StatCard label="Vehículos en flotas" value={totalVehicles} />
        <StatCard label="Órdenes abiertas" value={totalOpen} />
        {money && <StatCard label="Saldo por cobrar" value={formatMoney(totalBalance)} tone={totalBalance > 0 ? "amber" : undefined} />}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa, RTN o contacto" className="pl-9 pr-9" aria-label="Buscar" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Borrar búsqueda"><X className="h-4 w-4" /></button>}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Mostrar inactivas</label>
        </div>
        {companies.error ? (
          <ErrorState message={companies.error} />
        ) : companies.loading && !companies.data.length ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !rows.length ? (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title={companies.data.length ? "Ninguna empresa coincide" : "Sin empresas registradas"}
            description={companies.data.length ? "Pruebe con otra búsqueda." : "Registre las empresas que traen varios vehículos para ver su flota, su estado de cuenta y sus reportes."}
            action={!companies.data.length && can("companies.write") ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nueva empresa</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5">Empresa</th><th className="px-3 py-2.5">Forma de pago</th><th className="px-3 py-2.5 text-right">Vehículos</th>
                    <th className="px-3 py-2.5 text-right">Abiertas</th>{money && <th className="px-3 py-2.5 text-right">Saldo</th>}<th className="px-3 py-2.5">Referido</th><th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/empresas/${c.id}`)} className="cursor-pointer hover:bg-brand-50/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">{c.name}{c.active === false && <Badge tone="gray">Inactiva</Badge>}</div>
                        <div className="text-xs text-slate-500">{[c.contactName, formatPhone(c.contactPhone)].filter(Boolean).join(" · ") || c.legalName}</div>
                      </td>
                      <td className="px-3 py-3"><TermsBadge company={c} /></td>
                      <td className="tabular px-3 py-3 text-right">{c.vehicleCount ?? 0}</td>
                      <td className="tabular px-3 py-3 text-right">{c.openOrders ?? 0}</td>
                      {money && <td className={cn("tabular px-3 py-3 text-right font-semibold", (c.balanceDue ?? 0) > 0 ? "text-amber-700" : "text-slate-500")}>{formatMoney(c.balanceDue ?? 0)}</td>}
                      <td className="px-3 py-3 text-slate-600">{c.referral?.referrerName ?? <span className="text-slate-400">—</span>}</td>
                      <td className="pr-4 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/empresas/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate font-semibold text-slate-900">{c.name}</span><TermsBadge company={c} /></div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><Car className="h-3 w-3" />{c.vehicleCount ?? 0}</span>
                        <span>{c.openOrders ?? 0} abiertas</span>
                        {c.referral && <span className="truncate">Ref. {c.referral.referrerName}</span>}
                      </div>
                    </div>
                    {money && <span className={cn("tabular text-sm font-bold", (c.balanceDue ?? 0) > 0 ? "text-amber-700" : "text-slate-400")}>{formatMoney(c.balanceDue ?? 0)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <CompanyFormDialog open={creating} onClose={(id) => { setCreating(false); if (id) navigate(`/empresas/${id}`); }} />
    </>
  );
}
