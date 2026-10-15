import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Copy, Plus, Search, Ticket, X } from "lucide-react";
import {
  COUPON_STATE_META, COUPON_UNIT_LABELS, couponState, describeCoupon, formatMoney, normalizeText,
  type Coupon, type CouponState,
} from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { StatCard } from "@/features/finance/parts";
import { useCoupons } from "./api";
import { CouponFormDialog, copyText } from "./CouponFormDialog";

export function CouponStateBadge({ coupon }: { coupon: Coupon }) {
  const st = couponState(coupon, Date.now());
  return <Badge tone={COUPON_STATE_META[st].tone}>{COUPON_STATE_META[st].label}</Badge>;
}

/** "3 usados · 1 reservado / 50" */
export function usesText(c: Coupon) {
  const reserved = Math.max(0, (c.usesReserved ?? 0) - (c.usesCount ?? 0));
  return `${c.usesCount ?? 0} usado${(c.usesCount ?? 0) === 1 ? "" : "s"}${reserved ? ` · ${reserved} reservado${reserved === 1 ? "" : "s"}` : ""}${c.maxUses ? ` de ${c.maxUses}` : ""}`;
}

const valueText = (c: Coupon) => (c.type === "percent" ? `${c.value}%` : formatMoney(c.value));

type Filter = "all" | CouponState;

/** Cupones y códigos de descuento (admin y gerencia). */
export function CouponsPage() {
  const navigate = useNavigate();
  const coupons = useCoupons();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const now = Date.now();

  const withState = useMemo(() => coupons.data.map((c) => ({ c, st: couponState(c, now) })), [coupons.data, now]);
  const rows = useMemo(() => {
    const q = normalizeText(search);
    return withState
      .filter((x) => filter === "all" || x.st === filter || (filter === "active" && x.st === "scheduled"))
      .filter((x) => !q || normalizeText(`${x.c.code} ${x.c.name} ${x.c.description}`).includes(q))
      .sort((a, b) => Number(b.st === "active") - Number(a.st === "active") || (b.c.usesCount ?? 0) - (a.c.usesCount ?? 0) || a.c.code.localeCompare(b.c.code));
  }, [withState, search, filter]);

  const count = (s: CouponState) => withState.filter((x) => x.st === s).length;
  const given = coupons.data.reduce((a, c) => a + (c.discountGiven ?? 0), 0);
  const uses = coupons.data.reduce((a, c) => a + (c.usesCount ?? 0), 0);
  const reserved = coupons.data.reduce((a, c) => a + Math.max(0, (c.usesReserved ?? 0) - (c.usesCount ?? 0)), 0);

  return (
    <>
      <PageHeader
        title="Cupones"
        description="Códigos de descuento para taller, carwash y punto de venta. Los aplica el cliente en su link o el personal en el panel."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo cupón</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Cupones activos" value={count("active")} hint={count("scheduled") ? `${count("scheduled")} programados` : undefined} />
        <StatCard label="Usos" value={uses} hint={reserved ? `${reserved} reservados (sin cobrar)` : "Cobrados o aprobados"} />
        <StatCard label="Descuento dado" value={formatMoney(given)} />
        <StatCard label="Vencidos o agotados" value={count("expired") + count("exhausted")} />
      </div>

      <Card>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código o nombre" className="pl-9 pr-9" aria-label="Buscar" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Borrar búsqueda"><X className="h-4 w-4" /></button>}
          </div>
          <Tabs<Filter>
            value={filter} onChange={setFilter}
            tabs={[
              { value: "all", label: "Todos", count: coupons.data.length },
              { value: "active", label: "Activos", count: count("active") + count("scheduled") },
              { value: "expired", label: "Vencidos", count: count("expired") },
              { value: "exhausted", label: "Agotados", count: count("exhausted") },
              { value: "inactive", label: "Inactivos", count: count("inactive") },
            ]}
          />
        </div>
        {coupons.error ? (
          <ErrorState message={coupons.error} />
        ) : coupons.loading && !coupons.data.length ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !rows.length ? (
          <EmptyState
            icon={<Ticket className="h-7 w-7" />}
            title={coupons.data.length ? "Ningún cupón coincide" : "Todavía no hay cupones"}
            description={coupons.data.length ? "Pruebe con otra búsqueda o filtro." : "Cree un código de descuento, por ejemplo 10% en mano de obra una vez por cliente, y compártalo con sus clientes."}
            action={!coupons.data.length ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nuevo cupón</Button> : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5">Cupón</th><th className="px-3 py-2.5">Descuento</th><th className="px-3 py-2.5">Dónde</th>
                    <th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">Usos</th><th className="px-3 py-2.5 text-right">Descuento dado</th><th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ c }) => (
                    <tr key={c.id} onClick={() => navigate(`/cupones/${c.code}`)} className="cursor-pointer hover:bg-brand-50/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold tracking-wide text-slate-900">{c.code}</span>
                          <button onClick={(e) => { e.stopPropagation(); void copyText(c.code, "Código copiado"); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Copiar ${c.code}`} title="Copiar código"><Copy className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="text-xs text-slate-500">{c.name}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800">{valueText(c)}</div>
                        <div className="max-w-[280px] truncate text-xs text-slate-500" title={describeCoupon(c)}>{describeCoupon(c)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{c.units.length === 3 ? "Todo" : c.units.map((u) => COUPON_UNIT_LABELS[u]).join(", ")}</td>
                      <td className="px-3 py-3"><CouponStateBadge coupon={c} /></td>
                      <td className="px-3 py-3 text-slate-600">{usesText(c)}</td>
                      <td className="tabular px-3 py-3 text-right font-semibold">{formatMoney(c.discountGiven ?? 0)}</td>
                      <td className="pr-4 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map(({ c }) => (
                <li key={c.id}>
                  <Link to={`/cupones/${c.code}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold", c.active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400")}>{c.type === "percent" ? `${c.value}%` : <Ticket className="h-5 w-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate font-mono font-bold text-slate-900">{c.code}</span><CouponStateBadge coupon={c} /></div>
                      <div className="truncate text-xs text-slate-500">{c.name} · {usesText(c)}</div>
                    </div>
                    <span className="tabular text-sm font-semibold text-slate-700">{formatMoney(c.discountGiven ?? 0)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <CouponFormDialog open={creating} coupon={null} onClose={(code) => { setCreating(false); if (code) navigate(`/cupones/${code}`); }} />
    </>
  );
}
