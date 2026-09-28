import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { getDownloadURL, ref } from "firebase/storage";
import { ExternalLink } from "lucide-react";
import { formatMoney, methodNeedsBank, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type Payment, type PaymentMethod } from "@rapifix/shared";
import { storage } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { formatDate, toDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { useLoader } from "@/features/reports/data";
import type { ColKind, ReportCell } from "@/features/reports/table";
import { TabActions, TabError, TabHeader, TabSkeleton } from "@/features/reports/ui";
import { loadPayments, pct } from "../data";
import { Delta, DonutChart, fmtPct, KpiCard, Note, PALETTE, RichTable, toReportTable, type Col } from "../components";
import { finKey, type FinTabProps } from "./common";

const METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "#10B981",
  card: "#1447E6",
  transfer: "#8B5CF6",
  deposit: "#0EA5E9",
  online: "#F59E0B",
  other: "#64748B",
};

const NO_BANK = "Sin banco indicado";
const NO_TERMINAL = "Sin terminal indicada";
const bankOf = (p: Payment) => (p.bank?.trim() ? p.bank.trim() : p.method === "card" ? NO_TERMINAL : NO_BANK);
/** Pagos agrupables por banco/cuenta o terminal */
const groupable = (m: PaymentMethod) => m === "transfer" || m === "deposit" || m === "card";

async function openReceipt(path: string) {
  const w = window.open("", "_blank");
  try {
    const url = await getDownloadURL(ref(storage, path));
    if (w) w.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (err) {
    w?.close();
    throw err;
  }
}

interface MethodRow {
  method: PaymentMethod;
  count: number;
  amount: number;
  share: number | null;
  prev: number;
}

interface BankRow {
  key: string;
  method: PaymentMethod;
  bank: string;
  count: number;
  amount: number;
  noReceipt: number;
}

export function PaymentsTab(props: FinTabProps) {
  const { data, loading, error } = useLoader(
    async () => {
      const [cur, prev] = await Promise.all([
        loadPayments(props.period.start, props.period.end, props.refresh),
        loadPayments(props.prev.start, props.prev.end, props.refresh),
      ]);
      return { cur, prev };
    },
    finKey("payments", props),
  );
  const [method, setMethod] = useState<"" | PaymentMethod>("");
  const [bank, setBank] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const r = useMemo(() => {
    if (!data) return null;
    const total = data.cur.reduce((a, p) => a + p.amount, 0);
    const prevTotal = data.prev.reduce((a, p) => a + p.amount, 0);
    const methods: MethodRow[] = PAYMENT_METHODS.map((m) => {
      const l = data.cur.filter((p) => p.method === m);
      const amount = l.reduce((a, p) => a + p.amount, 0);
      return { method: m, count: l.length, amount, share: pct(amount, total), prev: data.prev.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0) };
    })
      .filter((x) => x.count > 0 || x.prev > 0)
      .sort((a, b) => b.amount - a.amount);

    const bankMap = new Map<string, BankRow>();
    for (const p of data.cur) {
      if (!groupable(p.method)) continue;
      const b = bankOf(p);
      const key = `${p.method}|${b}`;
      const row = bankMap.get(key) ?? { key, method: p.method, bank: b, count: 0, amount: 0, noReceipt: 0 };
      row.count++;
      row.amount += p.amount;
      if (methodNeedsBank(p.method) && !p.receiptPath) row.noReceipt++;
      bankMap.set(key, row);
    }
    const banks = [...bankMap.values()].sort((a, b) => a.method.localeCompare(b.method) || b.amount - a.amount);
    const missingReceipts = data.cur.filter((p) => methodNeedsBank(p.method) && !p.receiptPath);
    const sorted = [...data.cur].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0));
    return { total, prevTotal, methods, banks, missingReceipts, sorted };
  }, [data]);

  const bankOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.cur.filter((p) => groupable(p.method) && (!method || p.method === method)).map(bankOf))].sort();
  }, [data, method]);

  const filtered = useMemo(() => {
    if (!r) return [];
    return r.sorted.filter((p) => (!method || p.method === method) && (!bank || bankOf(p) === bank) && (!onlyMissing || (methodNeedsBank(p.method) && !p.receiptPath)));
  }, [r, method, bank, onlyMissing]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;

  const methodCols: Col<MethodRow>[] = [
    { label: "Método", value: (x) => PAYMENT_METHOD_LABELS[x.method] },
    { label: "Pagos", kind: "number", value: (x) => x.count },
    { label: "Monto", kind: "money", value: (x) => x.amount },
    { label: "% del total", kind: "percent", value: (x) => x.share },
    { label: "Período anterior", kind: "money", value: (x) => x.prev },
  ];
  const methodTotal: ReportCell[] = ["Total", data.cur.length, r.total, r.total ? 100 : null, r.prevTotal];

  const bankCols: Col<BankRow>[] = [
    { label: "Banco / cuenta / terminal", value: (x) => x.bank, tone: (x) => (x.bank === NO_BANK || x.bank === NO_TERMINAL ? "text-amber-700" : undefined) },
    { label: "Método", value: (x) => PAYMENT_METHOD_LABELS[x.method] },
    { label: "Pagos", kind: "number", value: (x) => x.count },
    { label: "Monto", kind: "money", value: (x) => x.amount },
    { label: "Sin comprobante", kind: "number", value: (x) => (methodNeedsBank(x.method) ? x.noReceipt : null), tone: (x) => (x.noReceipt ? "text-amber-700 font-semibold" : undefined) },
  ];
  const bankTotal: ReportCell[] = ["Total", "", r.banks.reduce((a, x) => a + x.count, 0), r.banks.reduce((a, x) => a + x.amount, 0), r.banks.reduce((a, x) => a + x.noReceipt, 0)];

  const detailCols: Col<Payment>[] = [
    { label: "Fecha", value: (p) => formatDate(p.at, true) },
    { label: "Recibo", value: (p) => p.code },
    { label: "Cliente", value: (p) => p.customerName || "Consumidor final" },
    {
      label: "Orden / venta",
      value: (p) => (p.orderCode ? `Orden ${p.orderCode}` : p.saleCode ? `Venta ${p.saleCode}` : ""),
      render: (p) =>
        p.orderId ? (
          <Link to={`/ordenes/${p.orderId}`} className="font-medium text-brand-700 hover:underline">{p.orderCode ?? "Orden"}</Link>
        ) : p.saleCode ? (
          <span>Venta {p.saleCode}</span>
        ) : (
          "—"
        ),
    },
    { label: "Método", value: (p) => PAYMENT_METHOD_LABELS[p.method] },
    { label: "Banco / terminal", value: (p) => (groupable(p.method) ? bankOf(p) : "") },
    { label: "Referencia", value: (p) => p.reference || "" },
    { label: "Monto", kind: "money", value: (p) => p.amount },
    {
      label: "Comprobante",
      value: (p) => (p.receiptPath ? "Sí" : methodNeedsBank(p.method) ? "Sin comprobante" : ""),
      render: (p) =>
        p.receiptPath ? (
          <button
            className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline print:no-underline"
            onClick={() => openReceipt(p.receiptPath!).catch((err) => toast.error(`No se pudo abrir el comprobante: ${errorMessage(err)}`))}
          >
            Ver <ExternalLink className="h-3.5 w-3.5 print:hidden" />
          </button>
        ) : methodNeedsBank(p.method) ? (
          <span className="font-semibold text-amber-700">Sin comprobante</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];
  const filteredTotal = filtered.reduce((a, p) => a + p.amount, 0);
  const detailTotal: ReportCell[] = [`Total (${filtered.length} pagos)`, "", "", "", "", "", "", filteredTotal, ""];

  const donut = r.methods.filter((m) => m.amount > 0).map((m, i) => ({ name: PAYMENT_METHOD_LABELS[m.method], value: m.amount, color: METHOD_COLORS[m.method] ?? PALETTE[i % PALETTE.length]! }));
  const cash = r.methods.find((m) => m.method === "cash");
  const bankAmount = r.methods.filter((m) => m.method !== "cash").reduce((a, m) => a + m.amount, 0);
  const summary: Array<[string, ReportCell, ColKind?]> = [
    ["Total cobrado", r.total, "money"],
    ["Pagos válidos", data.cur.length, "number"],
    ["Transferencias/depósitos sin comprobante", r.missingReceipts.length, "number"],
    ...(method || bank || onlyMissing ? [["Filtro del detalle", [method && PAYMENT_METHOD_LABELS[method], bank, onlyMissing && "solo sin comprobante"].filter(Boolean).join(" · ")] as [string, ReportCell]] : []),
  ];
  const tables = [
    toReportTable("Cobrado por método de pago", methodCols, r.methods, methodTotal),
    toReportTable("Cobrado por banco, cuenta o terminal", bankCols, r.banks, bankTotal, "Sin transferencias, depósitos ni tarjetas en el período."),
    toReportTable("Detalle de pagos", detailCols, filtered, detailTotal, "No hay pagos con estos filtros."),
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Cómo nos pagan"
        subtitle={`${props.period.label} · pagos válidos por fecha de pago`}
        actions={<TabActions title="Finanzas - Cobros" periodLabel={props.period.label} fileRange={props.fileRange} tables={tables} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total cobrado" value={formatMoney(r.total)} tone="text-brand-700" sub={`${data.cur.length} pagos`} delta={<Delta current={r.total} previous={r.prevTotal} />} />
        <KpiCard label="Efectivo" value={formatMoney(cash?.amount ?? 0)} sub={`${fmtPct(pct(cash?.amount ?? 0, r.total))} del total`} hint="Debe cuadrar con la caja." />
        <KpiCard label="Bancos, tarjeta y en línea" value={formatMoney(bankAmount)} sub={`${fmtPct(pct(bankAmount, r.total))} del total`} hint="Debe cuadrar con los estados de cuenta." />
        <KpiCard
          label="Sin comprobante"
          value={r.missingReceipts.length}
          tone={r.missingReceipts.length ? "text-amber-700" : "text-emerald-700"}
          sub={r.missingReceipts.length ? formatMoney(r.missingReceipts.reduce((a, p) => a + p.amount, 0)) : "Todo con comprobante"}
          hint="Transferencias y depósitos sin foto o PDF del comprobante."
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="report-card">
          <CardHeader title="Cobrado por método" />
          <div className="px-5 pb-5">{donut.length ? <DonutChart data={donut} /> : <p className="py-6 text-center text-sm text-slate-500">No hay cobros en este período.</p>}</div>
        </Card>
        <RichTable title="Por método de pago" cols={methodCols} rows={r.methods} total={methodTotal} rowKey={(x) => x.method} empty="No hay cobros en este período." />
      </div>

      <RichTable
        title="Por banco, cuenta o terminal"
        description="Transferencias y depósitos por la cuenta donde entró el dinero; tarjeta por terminal POS. Útil para cuadrar con el banco."
        cols={bankCols}
        rows={r.banks}
        total={bankTotal}
        rowKey={(x) => x.key}
        empty="Sin transferencias, depósitos ni pagos con tarjeta en el período."
      />

      {r.missingReceipts.length > 0 && (
        <Note tone="warn">
          {r.missingReceipts.length} {r.missingReceipts.length === 1 ? "transferencia o depósito no tiene" : "transferencias o depósitos no tienen"} comprobante adjunto. Use el filtro "Solo sin comprobante" para verlos.
        </Note>
      )}

      <div className="print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={method} onChange={(e) => { setMethod(e.target.value as "" | PaymentMethod); setBank(""); }} className="h-9 w-auto min-w-[150px]">
              <option value="">Todos los métodos</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </Select>
            <Select value={bank} onChange={(e) => setBank(e.target.value)} className="h-9 w-auto min-w-[150px]" disabled={!bankOptions.length}>
              <option value="">Todos los bancos</option>
              {bankOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Solo sin comprobante
            </label>
          </div>
      </div>
      <RichTable
        title="Detalle de pagos"
        description="Lista para cuadrar con la caja y el banco. Los totales al pie respetan los filtros."
        cols={detailCols}
        rows={filtered}
        total={detailTotal}
        maxRows={50}
        rowKey={(p) => p.id}
        empty="No hay pagos con estos filtros."
      />
    </div>
  );
}
