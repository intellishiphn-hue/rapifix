import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, HandCoins, MessageCircle, ShoppingCart, Wrench } from "lucide-react";
import { formatMoney, renderTemplate, templateBody, type Sale, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { formatDate, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { PaymentDialog } from "@/features/payments/PaymentDialogs";
import { useSettings } from "@/features/settings/api";
import { useCustomer } from "@/features/customers/api";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { WhatsAppComposer } from "@/features/work-orders/WhatsAppComposer";
import { orderVars } from "@/features/work-orders/whatsapp";
import { VoidSaleButton } from "./VoidSaleButton";
import { useReceivableOrders, useReceivableSales } from "./api";
import { StatCard } from "./parts";

/** Misma firma que las plantillas de templates.ts */
const FIRMA = "Gracias por su preferencia en *{{taller}}* 🚗";
const SALE_TEMPLATE = `¡Hola {{cliente}}! 🧾\n\nLe recordamos amablemente que su compra *{{orden}}* tiene un saldo pendiente de *{{total}}*.\n\nPuede pasar a cancelarlo cuando guste o escribirnos si tiene alguna consulta.\n\n${FIRMA}`;

const daysSince = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / 86400000));

type Charge = { kind: "order"; order: WorkOrder } | { kind: "sale"; sale: Sale };

export function ReceivablesPage() {
  const { can, role } = useAuth();
  const orders = useReceivableOrders();
  const sales = useReceivableSales(can("payments.read"));
  const [tab, setTab] = useState<"orders" | "sales">("orders");
  const [charging, setCharging] = useState<Charge | null>(null);
  const [messaging, setMessaging] = useState<Charge | null>(null);

  const ordersTotal = orders.data.reduce((a, o) => a + o.balance, 0);
  const delivered = orders.data.filter((o) => o.status === "DELIVERED");
  const deliveredTotal = delivered.reduce((a, o) => a + o.balance, 0);
  const salesTotal = sales.data.reduce((a, s) => a + s.balance, 0);

  // Entregadas con saldo primero (lo más urgente), luego el resto por saldo
  const sortedOrders = useMemo(() => [...orders.data].sort((a, b) => {
    const da = a.status === "DELIVERED" ? 1 : 0;
    const db = b.status === "DELIVERED" ? 1 : 0;
    return db - da || b.balance - a.balance;
  }), [orders.data]);

  return (
    <>
      <PageHeader title="Cuentas por cobrar" description="Órdenes y ventas con saldo pendiente. Cobre aquí o envíe un recordatorio amable por WhatsApp." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Por cobrar total" value={formatMoney(ordersTotal + salesTotal)} tone={ordersTotal + salesTotal > 0 ? "amber" : "green"} />
        <StatCard label="Órdenes entregadas" value={formatMoney(deliveredTotal)} hint={`${delivered.length} ya se llevaron el vehículo`} tone={deliveredTotal > 0 ? "red" : undefined} />
        <StatCard label="Órdenes en proceso" value={formatMoney(ordersTotal - deliveredTotal)} hint={`${orders.data.length - delivered.length} órdenes`} />
        <StatCard label="Ventas de mostrador" value={formatMoney(salesTotal)} hint={`${sales.data.length} ventas`} />
      </div>

      <Card>
        <div className="px-4 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: "orders", label: "Órdenes", icon: <Wrench className="h-4 w-4" />, count: orders.data.length },
            { value: "sales", label: "Ventas", icon: <ShoppingCart className="h-4 w-4" />, count: sales.data.length },
          ]} />
        </div>
        {tab === "orders" ? (
          orders.error ? <ErrorState message={orders.error} /> : orders.loading && !orders.data.length ? <Loading /> : !orders.data.length ? (
            <EmptyState icon={<HandCoins className="h-7 w-7" />} title="Ninguna orden con saldo" description="Todas las órdenes están al día." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {sortedOrders.map((o) => {
                const isDelivered = o.status === "DELIVERED";
                const days = isDelivered && o.deliveredAt?.toMillis ? daysSince(o.deliveredAt.toMillis()) : null;
                return (
                  <li key={o.id} className={cn("flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center", isDelivered && "bg-red-50/40")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/ordenes/${o.id}`} className="font-semibold text-slate-900 hover:text-brand-700">{o.code}</Link>
                        <StatusBadge status={o.status} short />
                        {days !== null && <Badge tone="red">Entregada {days === 0 ? "hoy" : `hace ${days} ${days === 1 ? "día" : "días"}`}</Badge>}
                      </div>
                      <div className="truncate text-sm text-slate-700">{o.customer.fullName}</div>
                      <div className="truncate text-xs text-slate-500">{o.vehicle.make} {o.vehicle.model} {o.vehicle.year} · {formatPlate(o.vehicle.plate)}{isDelivered && o.deliveredAt ? ` · entregada ${formatDate(o.deliveredAt)}` : ""}</div>
                    </div>
                    <Amounts total={o.totals?.total ?? 0} paid={o.paid} balance={o.balance} urgent={isDelivered} />
                    <div className="flex gap-1.5">
                      <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={() => setCharging({ kind: "order", order: o })}>Cobrar</Button>
                      <Button size="sm" variant="secondary" className="text-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setMessaging({ kind: "order", order: o })} aria-label="Recordatorio por WhatsApp" title="Recordatorio por WhatsApp" />
                      <Link to={`/ordenes/${o.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-500 hover:bg-slate-100" aria-label="Ver orden" title="Ver orden"><ExternalLink className="h-4 w-4" /></Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : sales.error ? <ErrorState message={sales.error} /> : sales.loading && !sales.data.length ? <Loading /> : !sales.data.length ? (
          <EmptyState icon={<HandCoins className="h-7 w-7" />} title="Ninguna venta con saldo" description="Todas las ventas de mostrador están pagadas." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {sales.data.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{s.code}</span>
                    {s.paid > 0 ? <Badge tone="blue">Abonada</Badge> : <Badge tone="amber">A crédito</Badge>}
                    {s.at?.toMillis && <span className="text-xs text-slate-500">hace {daysSince(s.at.toMillis())} días</span>}
                  </div>
                  <div className="truncate text-sm text-slate-700">{s.customerName || "Cliente de mostrador"}</div>
                  <div className="truncate text-xs text-slate-500">{[formatDate(s.at), s.vehicleLabel, s.byName && `Vendió ${s.byName}`].filter(Boolean).join(" · ")}</div>
                </div>
                <Amounts total={s.totals?.total ?? 0} paid={s.paid} balance={s.balance} />
                <div className="flex gap-1.5">
                  <Button size="sm" icon={<HandCoins className="h-4 w-4" />} onClick={() => setCharging({ kind: "sale", sale: s })}>Cobrar</Button>
                  <Button size="sm" variant="secondary" className="text-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} disabled={!s.customerId} onClick={() => setMessaging({ kind: "sale", sale: s })} aria-label="Recordatorio por WhatsApp" title={s.customerId ? "Recordatorio por WhatsApp" : "Venta sin cliente registrado"} />
                  <a href={`/imprimir/venta/${s.id}`} target="_blank" rel="noopener" className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-500 hover:bg-slate-100" aria-label="Ver venta" title="Ver venta"><ExternalLink className="h-4 w-4" /></a>
                  {(role === "admin" || role === "manager") && <VoidSaleButton sale={s} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PaymentDialog
        open={!!charging}
        onClose={() => setCharging(null)}
        target={charging?.kind === "order" ? { orderId: charging.order.id } : charging?.kind === "sale" ? { saleId: charging.sale.id } : {}}
        balance={charging?.kind === "order" ? charging.order.balance : charging?.kind === "sale" ? charging.sale.balance : 0}
        title={charging?.kind === "order" ? `Orden ${charging.order.code} · ${charging.order.customer.fullName}` : charging?.kind === "sale" ? `Venta ${charging.sale.code}${charging.sale.customerName ? ` · ${charging.sale.customerName}` : ""}` : ""}
      />
      {messaging && <ReminderDialog charge={messaging} onClose={() => setMessaging(null)} />}
    </>
  );
}

function Amounts({ total, paid, balance, urgent }: { total: number; paid: number; balance: number; urgent?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-right text-sm lg:w-80">
      <div><div className="text-[11px] text-slate-400">Total</div><div className="tabular">{formatMoney(total)}</div></div>
      <div><div className="text-[11px] text-slate-400">Pagado</div><div className="tabular text-slate-600">{formatMoney(paid)}</div></div>
      <div><div className="text-[11px] text-slate-400">Saldo</div><div className={cn("tabular font-bold", urgent ? "text-red-600" : "text-amber-700")}>{formatMoney(balance)}</div></div>
    </div>
  );
}

function Loading() {
  return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
}

function ReminderDialog({ charge, onClose }: { charge: Charge; onClose: () => void }) {
  const { settings } = useSettings();
  const customer = useCustomer(charge.kind === "sale" ? charge.sale.customerId ?? undefined : undefined);
  const taller = settings.name || "RAPIFIX";

  const text = useMemo(() => {
    if (charge.kind === "order") {
      return renderTemplate(templateBody("pago_pendiente"), { ...orderVars(charge.order, settings), total: formatMoney(charge.order.balance) });
    }
    const name = customer.data?.fullName || charge.sale.customerName;
    return renderTemplate(SALE_TEMPLATE, { cliente: name.split(" ")[0] ?? name, orden: charge.sale.code, total: formatMoney(charge.sale.balance), taller });
  }, [charge, settings, customer.data, taller]);

  const title = charge.kind === "order" ? `Recordatorio · ${charge.order.code}` : `Recordatorio · ${charge.sale.code}`;
  return (
    <Dialog open onClose={onClose} size="md" title={title} description="Revise el mensaje y envíelo por WhatsApp.">
      {charge.kind === "order" ? (
        <WhatsAppComposer context="cobro" order={charge.order} initial={text} onSent={onClose} />
      ) : customer.loading ? <Skeleton className="h-32" /> : !customer.data || !(customer.data.whatsapp || customer.data.phone) ? (
        <p className="text-sm text-slate-600">El cliente no tiene teléfono registrado.</p>
      ) : (
        <WhatsAppComposer context="cobro" to={{ phone: customer.data.whatsapp || customer.data.phone, name: customer.data.fullName }} initial={text} onSent={onClose} />
      )}
    </Dialog>
  );
}
