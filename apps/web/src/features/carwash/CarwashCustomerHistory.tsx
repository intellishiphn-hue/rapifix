import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Droplets, Gift, Printer } from "lucide-react";
import { formatMoney, WASH_STATUS_LABELS, type CarwashMembership } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { useCarwashFor, useCarwashSettings } from "./api";
import { Stamps } from "./RegisterWashDialog";
import { AdjustStampsButton } from "./LoyaltyAdjust";
import { MEMBERSHIP_TONE, membershipNow, STATUS_STYLE } from "./ui";

const CASHIER_ROLES = ["admin", "manager", "reception", "seller"];

/**
 * Historial del carwash en la ficha del cliente (customerId + placas de sus vehículos)
 * o del vehículo (vehicleId + su placa): membresías, sellos de lealtad y últimos lavados.
 */
export function CarwashCustomerHistory({ customerId, vehicleId, plates }: { customerId?: string; vehicleId?: string; plates: string[] }) {
  const { can, role } = useAuth();
  const money = can("carwash.charge");
  const canMemberships = !!role && CASHIER_ROLES.includes(role);
  const { settings } = useCarwashSettings();
  const cw = useCarwashFor({ customerId, vehicleId, plates, memberships: canMemberships, enabled: can("carwash.read") });
  const [show, setShow] = useState(10);

  if (cw.error) return <ErrorState message={cw.error} />;
  if (cw.loading && !cw.washes.length) {
    return <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  }

  const now = Date.now();
  const memberships = cw.memberships
    .map((m) => ({ m, v: membershipNow(m, now) }))
    .sort((a, b) => (a.v.status === "active" ? 0 : 1) - (b.v.status === "active" ? 0 : 1) || b.v.paidUntil - a.v.paidUntil);
  const active = memberships.filter((x) => x.v.status === "active");
  const lastInactive = !active.length ? memberships[0] : undefined;
  const every = settings.loyaltyEvery;
  const valid = cw.washes.filter((w) => w.status !== "cancelled");

  if (!cw.washes.length && !cw.loyalty.length && !memberships.length) {
    return (
      <EmptyState
        icon={<Droplets className="h-7 w-7" />}
        title="Sin visitas al carwash"
        description="Cuando registre un lavado con este cliente o su placa, aparecerá aquí con sus sellos y membresía."
      />
    );
  }

  return (
    <div className="space-y-5 p-5">
      {/* Resumen */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Lavados" value={String(valid.length)} />
        <Stat label="Último lavado" value={valid[0] ? formatDate(valid[0].createdAt) : "-"} />
        {money && <Stat label="Total en carwash" value={formatMoney(valid.filter((w) => w.paid).reduce((a, w) => a + (w.total ?? 0), 0))} />}
      </div>

      {/* Membresías */}
      {canMemberships && (active.length > 0 || lastInactive) && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Membresía</h4>
          {(active.length ? active : lastInactive ? [lastInactive] : []).map(({ m, v }) => (
            <MembershipRow key={m.id} m={m} v={v} />
          ))}
        </div>
      )}

      {/* Sellos por placa */}
      {every > 0 && cw.loyalty.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tarjeta de lealtad</h4>
          <div className="grid gap-2 lg:grid-cols-2">
            {cw.loyalty.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PlateTag plate={l.id} />
                  <span className="tabular text-sm font-semibold text-slate-800">{l.count ?? 0}/{every} sellos</span>
                  {(l.rewardsAvailable ?? 0) > 0 && (
                    <Badge tone="blue"><Gift className="h-3 w-3" /> {l.rewardsAvailable === 1 ? "1 premio disponible" : `${l.rewardsAvailable} premios disponibles`}</Badge>
                  )}
                  <span className="ml-auto"><AdjustStampsButton loyalty={l} every={every} /></span>
                </div>
                <div className="mt-2"><Stamps count={l.count ?? 0} every={every} /></div>
                <div className="mt-1.5 text-xs text-slate-500">
                  {l.totalWashes ?? 0} visita{l.totalWashes === 1 ? "" : "s"}{l.rewardsUsed ? ` · ${l.rewardsUsed} premio${l.rewardsUsed === 1 ? "" : "s"} usado${l.rewardsUsed === 1 ? "" : "s"}` : ""}
                  {l.lastWashAt ? ` · último ${formatDate(l.lastWashAt)}` : ""}
                  {l.welcomeStamps ? ` · arrancó con ${l.welcomeStamps} de regalo` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lavados */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Últimos lavados</h4>
        {!cw.washes.length ? (
          <p className="text-sm text-slate-500">Sin lavados registrados.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {cw.washes.slice(0, show).map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{w.code}</span>
                    <PlateTag plate={w.plate} />
                    <Badge tone={STATUS_STYLE[w.status].tone}>{WASH_STATUS_LABELS[w.status]}</Badge>
                    {w.membershipCode && <Badge tone="green"><BadgeCheck className="h-3 w-3" /> Membresía</Badge>}
                    {w.loyaltyRedeemed && <Badge tone="blue"><Gift className="h-3 w-3" /> Premio</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {formatDate(w.createdAt, true)} · {w.items.map((i) => i.name).join(", ")}
                  </div>
                </div>
                {money && <span className="tabular font-semibold">{formatMoney(w.total)}</span>}
                <Link to={`/imprimir/lavado/${w.id}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                  <Printer className="h-3.5 w-3.5" /> Ticket
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cw.washes.length > show && (
          <div className="mt-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShow((n) => n + 20)}>Ver más ({cw.washes.length - show})</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="tabular text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function MembershipRow({ m, v }: { m: CarwashMembership; v: ReturnType<typeof membershipNow> }) {
  const perMonth = m.plan?.washesPerMonth ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 p-3 text-sm">
      <BadgeCheck className="h-5 w-5 text-emerald-600" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{m.planName}</span>
          <span className="text-xs text-slate-500">{m.code}</span>
          <PlateTag plate={m.plate} />
          <Badge tone={MEMBERSHIP_TONE[v.status]}>{v.status === "active" ? "Activa" : v.status === "expired" ? "Vencida" : "Cancelada"}</Badge>
        </div>
        <div className="mt-0.5 text-xs text-slate-600">
          {v.status === "active" ? "Vence" : "Venció"} {formatDate(new Date(v.paidUntil))}
          {v.status === "active" && ` · ${perMonth === null ? "lavados ilimitados" : `usados ${v.usedInPeriod} de ${perMonth} este mes`}`}
        </div>
      </div>
    </div>
  );
}
