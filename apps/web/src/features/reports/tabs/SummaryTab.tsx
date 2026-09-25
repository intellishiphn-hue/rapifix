import { useMemo } from "react";
import { where, limit } from "firebase/firestore";
import { Info } from "lucide-react";
import {
  catalogCol, financeCol, formatMoney, orderCol, PAYMENT_METHOD_LABELS, PAYMENT_METHODS,
  type Expense, type Payment, type Purchase, type Sale, type SupplierPayment, type WorkOrder,
} from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { formatDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { fetchAll, fetchRange, sumBy, useLoader } from "../data";
import { DailyAmountChart, paymentsByDay } from "../charts";
import { dayKeys } from "../period";
import type { ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

async function load(p: TabProps) {
  const { start, end } = p.period;
  const [payments, sales, expenses, supplierPayments, ordersDue, salesDue, purchasesDue] = await Promise.all([
    fetchRange<Payment>(catalogCol.payments(TENANT_ID), "at", start, end),
    fetchRange<Sale>(catalogCol.sales(TENANT_ID), "at", start, end).then((l) => l.filter((x) => x.status !== "voided")),
    fetchRange<Expense>(financeCol.expenses(TENANT_ID), "date", start, end),
    fetchRange<SupplierPayment>(financeCol.supplierPayments(TENANT_ID), "at", start, end),
    fetchAll<WorkOrder>(orderCol.workOrders(TENANT_ID), where("balance", ">", 0), limit(1000)),
    fetchAll<Sale>(catalogCol.sales(TENANT_ID), where("balance", ">", 0), limit(1000)),
    fetchAll<Purchase>(financeCol.purchases(TENANT_ID), where("status", "in", ["pending", "partial"]), limit(1000)),
  ]);
  return {
    payments: payments.filter((x) => x.status === "valid"),
    sales,
    expenses: expenses.filter((x) => x.status === "valid"),
    supplierPayments: supplierPayments.filter((x) => x.status === "valid"),
    ordersDue: ordersDue.filter((o) => o.status !== "CANCELLED"),
    salesDue,
    purchasesDue,
  };
}

export function SummaryTab(props: TabProps) {
  const { data, loading, error } = useLoader(() => load(props), loaderKey("summary", props));

  const r = useMemo(() => {
    if (!data) return null;
    const collected = sumBy(data.payments, (x) => x.amount);
    const fromOrders = sumBy(data.payments.filter((x) => x.orderId), (x) => x.amount);
    const fromSales = sumBy(data.payments.filter((x) => x.saleId), (x) => x.amount);
    const salesTotal = sumBy(data.sales, (x) => x.totals.total);
    const expenses = sumBy(data.expenses, (x) => x.amount);
    const supplier = sumBy(data.supplierPayments, (x) => x.amount);
    const cashFlow = collected - expenses - supplier;
    const receivableOrders = sumBy(data.ordersDue, (x) => x.balance);
    const receivableSales = sumBy(data.salesDue, (x) => x.balance);
    const payable = sumBy(data.purchasesDue, (x) => x.balance);
    const days = paymentsByDay(data.payments, dayKeys(props.period.start, props.period.end));

    const byMethod: ReportTable = {
      title: "Cobrado por método de pago",
      columns: [{ label: "Método" }, { label: "Pagos", kind: "number" }, { label: "Monto", kind: "money" }],
      rows: PAYMENT_METHODS.map((m) => {
        const list = data.payments.filter((x) => x.method === m);
        return [PAYMENT_METHOD_LABELS[m], list.length, sumBy(list, (x) => x.amount)] as [string, number, number];
      }).filter((row) => row[1] > 0),
      total: ["Total", data.payments.length, collected],
      empty: "No hay cobros en este período.",
    };
    const byDay: ReportTable = {
      title: "Cobrado por día",
      columns: [{ label: "Día" }, { label: "Monto", kind: "money" }],
      rows: days.filter((d) => d.amount > 0).map((d) => [formatDate(new Date(`${d.key}T12:00:00Z`)), d.amount]),
      total: ["Total", collected],
    };
    const flow: ReportTable = {
      title: "Flujo de caja del período",
      columns: [{ label: "Concepto" }, { label: "Monto", kind: "money" }],
      rows: [
        ["Cobrado en órdenes", fromOrders],
        ["Cobrado en ventas del POS", fromSales],
        ["(−) Gastos", -expenses],
        ["(−) Pagos a proveedores", -supplier],
      ],
      total: ["Flujo de caja", cashFlow],
    };
    const receivables: ReportTable = {
      title: "Cuentas por cobrar (al día de hoy)",
      columns: [{ label: "Documento" }, { label: "Cliente" }, { label: "Fecha" }, { label: "Total", kind: "money" }, { label: "Saldo", kind: "money" }],
      rows: [
        ...data.ordersDue.map((o) => [`Orden ${o.code}`, o.customer.fullName, formatDate(o.createdAt), o.totals.total, o.balance] as const),
        ...data.salesDue.map((s) => [`Venta ${s.code}`, s.customerName || "Consumidor final", formatDate(s.at), s.totals.total, s.balance] as const),
      ]
        .sort((a, b) => b[4] - a[4])
        .map((row) => [...row]),
      total: ["Total", "", "", null, receivableOrders + receivableSales],
      empty: "No hay saldos pendientes de clientes.",
    };
    const payables: ReportTable = {
      title: "Cuentas por pagar a proveedores (al día de hoy)",
      columns: [{ label: "Compra" }, { label: "Proveedor" }, { label: "Factura" }, { label: "Vence" }, { label: "Total", kind: "money" }, { label: "Saldo", kind: "money" }],
      rows: [...data.purchasesDue]
        .sort((a, b) => (a.dueDate?.toMillis() ?? Infinity) - (b.dueDate?.toMillis() ?? Infinity))
        .map((x) => [x.code, x.supplierName, x.invoiceNumber || "", x.dueDate ? formatDate(x.dueDate) : "Sin fecha", x.total, x.balance]),
      total: ["Total", "", "", "", null, payable],
      empty: "No hay compras pendientes de pago.",
    };
    return { collected, salesTotal, expenses, supplier, cashFlow, receivableOrders, receivableSales, payable, days, tables: [flow, byMethod, byDay, receivables, payables] };
  }, [data, props.period.start, props.period.end]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const [flow, byMethod, byDay, receivables, payables] = r.tables as [ReportTable, ReportTable, ReportTable, ReportTable, ReportTable];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Resumen financiero"
        subtitle={props.period.label}
        actions={
          <TabActions
            title="Resumen"
            periodLabel={props.period.label}
            fileRange={props.fileRange}
            tables={r.tables}
            summary={[
              ["Cobrado", r.collected, "money"],
              ["Ventas del POS (facturado)", r.salesTotal, "money"],
              ["Gastos", r.expenses, "money"],
              ["Pagos a proveedores", r.supplier, "money"],
              ["Flujo de caja (cobrado − gastos − pagos a proveedores)", r.cashFlow, "money"],
              ["Cuentas por cobrar", r.receivableOrders + r.receivableSales, "money"],
              ["Cuentas por pagar", r.payable, "money"],
            ]}
          />
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cobrado" value={formatMoney(r.collected)} hint={`${data.payments.length} pagos válidos`} tone="text-emerald-700" />
        <StatCard label="Ventas del POS" value={formatMoney(r.salesTotal)} hint={`${data.sales.length} ventas`} />
        <StatCard label="Gastos" value={formatMoney(r.expenses)} hint={`${data.expenses.length} registros`} tone="text-red-700" />
        <StatCard label="Pagos a proveedores" value={formatMoney(r.supplier)} hint={`${data.supplierPayments.length} pagos`} tone="text-red-700" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Flujo de caja" value={formatMoney(r.cashFlow)} tone={r.cashFlow >= 0 ? "text-emerald-700" : "text-red-700"} hint="Cobrado − gastos − pagos a proveedores" />
        <StatCard label="Cuentas por cobrar" value={formatMoney(r.receivableOrders + r.receivableSales)} tone="text-amber-700" hint={`Órdenes ${formatMoney(r.receivableOrders)} · Ventas ${formatMoney(r.receivableSales)}`} />
        <StatCard label="Cuentas por pagar" value={formatMoney(r.payable)} tone="text-amber-700" hint={`${data.purchasesDue.length} compras pendientes`} />
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          El <b>flujo de caja</b> muestra el dinero que entró y salió en el período. No es la utilidad contable: no considera el costo de los
          repuestos vendidos, las compras aún no pagadas, las cuentas por cobrar ni la depreciación. Las cuentas por cobrar y por pagar son saldos al día de hoy.
        </p>
      </div>
      <Card className="report-card">
        <CardHeader title="Cobrado por día" description={props.period.label} />
        <div className="p-4">{r.days.length ? <DailyAmountChart data={r.days} /> : <p className="py-6 text-center text-sm text-slate-500">Sin días en el período.</p>}</div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <DataTable table={flow} />
        <DataTable table={byMethod} />
      </div>
      <DataTable table={byDay} maxRows={10} />
      <DataTable table={receivables} maxRows={10} />
      <DataTable table={payables} maxRows={10} />
    </div>
  );
}
