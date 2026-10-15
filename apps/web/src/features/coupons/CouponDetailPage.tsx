import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Copy, FileSpreadsheet, Pencil, Power, Ticket } from "lucide-react";
import {
  COUPON_UNIT_LABELS, describeCoupon, formatMoney, hnDayKey, REDEMPTION_CHANNEL_LABELS, REDEMPTION_KIND_LABELS, REDEMPTION_STATUS_LABELS, saveCouponSchema,
  type CouponRedemption, type RedemptionStatus,
} from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui/Feedback";
import { StatCard } from "@/features/finance/parts";
import { exportToExcel, type ReportTable } from "@/features/reports/table";
import { saveCoupon, useCoupon, useCouponRedemptions } from "./api";
import { CouponFormDialog, copyText, couponToForm } from "./CouponFormDialog";
import { CouponStateBadge, usesText } from "./CouponsPage";

const STATUS_TONE: Record<RedemptionStatus, "green" | "amber" | "gray"> = { used: "green", reserved: "amber", released: "gray" };

function docLink(r: CouponRedemption): string | null {
  if (r.target.kind === "quote") return r.orderId ? `/ordenes/${r.orderId}?tab=cotizacion` : `/cotizaciones/${r.target.id}`;
  if (r.target.kind === "sale") return `/imprimir/venta/${r.target.id}`;
  return `/imprimir/lavado/${r.target.id}`;
}
const appliedByText = (r: CouponRedemption) => (r.appliedBy === "customer" ? "Cliente (link)" : r.appliedBy);

/** Detalle del cupón: canjes, totales y exportar a Excel. */
export function CouponDetailPage() {
  const { code } = useParams();
  const { data: coupon, loading, error, exists } = useCoupon(code);
  const redemptions = useCouponRedemptions(code);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const stats = useMemo(() => {
    const used = redemptions.data.filter((r) => r.status === "used");
    return {
      used: used.length,
      reserved: redemptions.data.filter((r) => r.status === "reserved").length,
      discount: used.reduce((a, r) => a + (r.discount ?? 0), 0),
      revenue: used.reduce((a, r) => a + (r.total ?? 0), 0),
      newCustomers: used.filter((r) => r.firstVisit).length,
      customers: new Set(used.map((r) => r.customerKey || r.id)).size,
    };
  }, [redemptions.data]);

  const reservedNow = Math.max(0, (coupon?.usesReserved ?? 0) - (coupon?.usesCount ?? 0));
  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;
  if (!exists || !coupon) return <EmptyState icon={<Ticket className="h-7 w-7" />} title="Cupón no encontrado" action={<Link to="/cupones" className="font-semibold text-brand-700">Volver a cupones</Link>} />;

  const toggle = async () => {
    setBusy(true);
    try {
      const parsed = saveCouponSchema.parse({ ...couponToForm(coupon), active: !coupon.active, editing: true });
      await saveCoupon(parsed);
      toast.success(coupon.active ? "Cupón desactivado: ya no se puede usar." : "Cupón activado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const table: ReportTable = {
        title: "Canjes",
        columns: [
          { label: "Fecha" }, { label: "Cliente" }, { label: "Documento" }, { label: "Unidad" }, { label: "Descuento", kind: "money" }, { label: "Total con cupón", kind: "money" },
          { label: "Aplicado por" }, { label: "Canal" }, { label: "Estado" }, { label: "Cliente nuevo" },
        ],
        rows: redemptions.data.map((r) => [
          formatDate(r.usedAt ?? r.createdAt, true), r.customerName, `${REDEMPTION_KIND_LABELS[r.target.kind]} ${r.target.code}${r.orderCode ? ` (${r.orderCode})` : ""}${r.saleCode ? ` (${r.saleCode})` : ""}`,
          COUPON_UNIT_LABELS[r.unit] ?? "", r.discount, r.total, appliedByText(r), REDEMPTION_CHANNEL_LABELS[r.channel] ?? "", REDEMPTION_STATUS_LABELS[r.status], r.firstVisit ? "Sí" : "",
        ]),
        empty: "Sin canjes",
      };
      await exportToExcel({
        title: `Cupón ${coupon.code}`,
        periodLabel: `Desde ${coupon.validFrom}${coupon.validUntil ? ` hasta ${coupon.validUntil}` : ""}`,
        fileRange: `cupon ${coupon.code} ${hnDayKey(Date.now())}`,
        summary: [
          ["Cupón", `${coupon.code} · ${coupon.name}`], ["Condiciones", describeCoupon(coupon)], ["Usos (cobrados o aprobados)", coupon.usesCount ?? 0, "number"],
          ["Reservados (sin cobrar)", reservedNow, "number"], ["Descuento dado", coupon.discountGiven ?? 0, "money"], ["Ventas con el cupón (con ISV)", stats.revenue, "money"],
          ["Clientes nuevos", stats.newCustomers, "number"],
        ],
        tables: [table],
      });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: "/cupones", label: "Cupones" }}
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono tracking-wide">{coupon.code}</span><CouponStateBadge coupon={coupon} /></span>}
        description={<>{coupon.name}{coupon.description ? ` · ${coupon.description}` : ""}</>}
        actions={
          <>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copyText(coupon.code, "Código copiado")}>Copiar</Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting} onClick={() => void onExport()}>Excel</Button>
            <Button variant="secondary" icon={<Power className="h-4 w-4" />} loading={busy} onClick={() => void toggle()}>{coupon.active ? "Desactivar" : "Activar"}</Button>
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>
          </>
        }
      />

      <Card className="mb-5 p-4 text-sm">
        <p className="font-medium text-slate-800">{(() => { const d = describeCoupon(coupon); return d.charAt(0).toUpperCase() + d.slice(1); })()}.</p>
        <p className="mt-1 text-slate-500">
          {coupon.units.map((u) => COUPON_UNIT_LABELS[u]).join(", ")} · {coupon.customerApplicable ? "El cliente lo puede aplicar en su link" : "Solo lo aplica el personal"}
          {coupon.excludeCompanies && !coupon.companyId ? " · No aplica a empresas" : ""} · {usesText(coupon)}
        </p>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Descuento dado" value={formatMoney(coupon.discountGiven ?? 0)} />
        <StatCard label="Usos" value={`${coupon.usesCount ?? 0}${coupon.maxUses ? ` / ${coupon.maxUses}` : ""}`} hint={reservedNow ? `${reservedNow} reservado${reservedNow === 1 ? "" : "s"} sin cobrar` : `${stats.customers} cliente${stats.customers === 1 ? "" : "s"}`} />
        <StatCard label="Ventas con el cupón" value={formatMoney(stats.revenue)} hint="Total cobrado o aprobado, con ISV" />
        <StatCard label="Clientes nuevos" value={stats.newCustomers} hint="Su primera visita" />
      </div>

      <Card>
        <CardHeader title="Canjes" description="Reservado: aplicado pero sin cobrar o aprobar. Usado: cobrado o aprobado. Liberado: se quitó, se rechazó, venció o se anuló." />
        {redemptions.error ? <ErrorState message={redemptions.error} /> : !redemptions.data.length ? (
          <EmptyState icon={<Ticket className="h-7 w-7" />} title="Sin canjes todavía" description="Aquí aparece cada vez que alguien aplica este cupón." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5">Fecha</th><th className="px-3 py-2.5">Cliente</th><th className="px-3 py-2.5">Documento</th>
                    <th className="px-3 py-2.5 text-right">Descuento</th><th className="px-3 py-2.5">Aplicado por</th><th className="px-3 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {redemptions.data.map((r) => {
                    const link = docLink(r);
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(r.usedAt ?? r.createdAt, true)}</td>
                        <td className="px-3 py-3"><div className="font-medium text-slate-800">{r.customerName}</div>{r.firstVisit && r.status !== "released" && <div className="text-xs text-emerald-700">Cliente nuevo</div>}</td>
                        <td className="px-3 py-3">
                          {link ? <Link to={link} target={r.target.kind === "quote" ? undefined : "_blank"} className="whitespace-nowrap font-medium text-brand-700 hover:underline">{REDEMPTION_KIND_LABELS[r.target.kind]} {r.target.code}</Link> : r.target.code}
                          {(r.orderCode || r.saleCode) && <div className="text-xs text-slate-500">{[r.orderCode, r.saleCode].filter(Boolean).join(" · ")}</div>}
                        </td>
                        <td className="tabular px-3 py-3 text-right font-semibold">{formatMoney(r.discount)}</td>
                        <td className="px-3 py-3 text-slate-600">{appliedByText(r)}<div className="text-xs text-slate-400">{REDEMPTION_CHANNEL_LABELS[r.channel]}</div></td>
                        <td className="px-3 py-3"><Badge tone={STATUS_TONE[r.status]}>{REDEMPTION_STATUS_LABELS[r.status]}</Badge>{r.status === "released" && r.releaseReason && <div className="mt-0.5 max-w-[220px] text-xs text-slate-400">{r.releaseReason}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {redemptions.data.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-800">{r.customerName}</span>
                    <span className="tabular font-semibold">− {formatMoney(r.discount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={STATUS_TONE[r.status]}>{REDEMPTION_STATUS_LABELS[r.status]}</Badge>
                    <span>{REDEMPTION_KIND_LABELS[r.target.kind]} {r.target.code}</span>
                    <span>{formatDate(r.usedAt ?? r.createdAt, true)}</span>
                    <span>{appliedByText(r)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <CouponFormDialog open={editing} coupon={coupon} onClose={() => setEditing(false)} />
    </>
  );
}
