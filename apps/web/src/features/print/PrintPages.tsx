import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import {
  formatMoney, formatPhone, FUEL_LABELS, PAYMENT_METHOD_LABELS, PRIORITY_LABELS, QUOTE_ITEM_LABELS, QUOTE_STATUS_META, RECEPTION_CHECKLIST, STATUS_META, WORK_TYPE_LABELS,
  type WorkshopSettings,
} from "@rapifix/shared";
import { formatDate, formatKm, formatPlate } from "@/lib/format";
import { PageLoader, ErrorState } from "@/components/ui/Feedback";
import { LogoMark } from "@/components/common/Logo";
import { useSettings } from "@/features/settings/api";
import { useWorkOrder } from "@/features/work-orders/api";
import { useQuote } from "@/features/quotes/api";
import { useVehicle } from "@/features/vehicles/api";
import { usePayment, useSale, useSalePayments } from "@/features/payments/api";

const FUEL = ["Vacío", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Lleno"];

function PrintShell({ settings, title, code, date, children }: { settings: WorkshopSettings; title: string; code: string; date: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <style>{`@page { size: letter; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[816px] justify-end px-4">
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow"><Printer className="h-4 w-4" /> Imprimir / Guardar PDF</button>
      </div>
      <div className="mx-auto w-full max-w-[816px] bg-white text-[12.5px] leading-relaxed text-slate-800 shadow-lg print:max-w-none print:shadow-none">
        <div className="h-2 bg-brand-600" />
        <div className="p-[6%] print:p-0 print:pt-4">
          <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-4">
            <div className="flex items-center gap-3">
              {settings.logoUrl ? <img src={settings.logoUrl} alt="" className="h-14 max-w-[200px] object-contain" /> : <><LogoMark className="h-12 w-12" /><div className="text-2xl font-extrabold tracking-tight">RAPI<span className="text-brand-600">FIX</span></div></>}
            </div>
            <div className="text-right text-[11px] text-slate-600">
              <div className="text-base font-extrabold uppercase tracking-wide text-slate-900">{title}</div>
              <div className="text-lg font-bold text-brand-700">{code}</div>
              <div>{date}</div>
            </div>
          </header>
          <div className="mt-2 text-[11px] text-slate-500">
            {[settings.legalName || settings.name, settings.rtn && `RTN ${settings.rtn}`, settings.address, settings.city, settings.phone && formatPhone(settings.phone), settings.email].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-5 space-y-5">{children}</div>
          <footer className="mt-10 border-t border-slate-200 pt-3 text-center text-[10.5px] text-slate-400">{settings.name} · {settings.subtitle}</footer>
        </div>
        <div className="h-2 bg-brand-600" />
      </div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 border-l-4 border-brand-600 pl-2 text-[11px] font-bold uppercase tracking-wider text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
      {rows.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-slate-500">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>)}
    </dl>
  );
}

export function PrintOrderPage() {
  const { id } = useParams();
  const { data: o, loading, error } = useWorkOrder(id);
  const v = useVehicle(o?.vehicleId);
  const { settings } = useSettings();
  if (loading) return <PageLoader />;
  if (error || !o) return <ErrorState message={error ?? "Orden no encontrada"} />;
  const r = o.reception;
  return (
    <PrintShell settings={settings} title="Orden de trabajo" code={o.code} date={formatDate(o.createdAt, true)}>
      <div className="grid grid-cols-2 gap-6">
        <Box title="Cliente"><KV rows={[["Nombre", o.customer.fullName], ["Teléfono", formatPhone(o.customer.phone)]]} /></Box>
        <Box title="Vehículo"><KV rows={[["Vehículo", `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.year}`], ["Placa", formatPlate(o.vehicle.plate)], ["Color", o.vehicle.color], ["VIN", v.data?.vin], ["Combustible", v.data ? FUEL_LABELS[v.data.fuelType] : ""]]} /></Box>
      </div>
      <Box title="Orden">
        <KV rows={[["Estado", STATUS_META[o.status].label], ["Tipo", WORK_TYPE_LABELS[o.type]], ["Prioridad", PRIORITY_LABELS[o.priority]], ["Técnico", o.technicians?.map((t) => t.name).join(", ")], ["Prometida", formatDate(o.promisedAt, true)], ["Entregado", formatDate(o.deliveredAt, true)]]} />
        <p className="mt-2"><span className="text-slate-500">Motivo de ingreso:</span> {o.reason}</p>
      </Box>
      <Box title="Recepción">
        <KV rows={[["Kilometraje", formatKm(r?.mileageIn ?? 0)], ["Combustible", FUEL[r?.fuelLevel ?? 0]], ["Km salida", o.mileageOut != null ? formatKm(o.mileageOut) : ""]]} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {RECEPTION_CHECKLIST.map((c) => <span key={c.key}>{r?.checklist?.[c.key] ? "☑" : "☐"} {c.label}</span>)}
        </div>
        {[["Exterior", r?.exteriorNotes], ["Interior", r?.interiorNotes], ["Accesorios", r?.accessories], ["Otros objetos", r?.otherObjects]].filter(([, t]) => t).map(([k, t]) => <p key={k} className="mt-1"><span className="text-slate-500">{k}:</span> {t}</p>)}
      </Box>
      {o.diagnosis && (o.diagnosis.technicianDiagnosis || o.diagnosis.obdCodes?.length) && (
        <Box title="Diagnóstico">
          {o.diagnosis.technicianDiagnosis && <p className="whitespace-pre-line">{o.diagnosis.technicianDiagnosis}</p>}
          {o.diagnosis.obdCodes?.length > 0 && <p className="mt-1"><span className="text-slate-500">Códigos OBD:</span> <span className="font-mono">{o.diagnosis.obdCodes.join(", ")}</span></p>}
          {o.diagnosis.recommendations && <p className="mt-1"><span className="text-slate-500">Recomendaciones:</span> {o.diagnosis.recommendations}</p>}
        </Box>
      )}
      <div className="flex justify-end">
        <dl className="w-64 space-y-1"><div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{formatMoney(o.totals?.total ?? 0)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Saldo</dt><dd>{formatMoney(o.balance ?? 0)}</dd></div></dl>
      </div>
      <div className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px] text-slate-500">
        <div className="border-t border-slate-400 pt-1">Firma del cliente</div>
        <div className="border-t border-slate-400 pt-1">Recibido por {settings.name}</div>
      </div>
      <p className="text-[10.5px] text-slate-400">El cliente declara que los datos y el estado del vehículo descritos son correctos. {settings.name} no se responsabiliza por objetos de valor no declarados.</p>
    </PrintShell>
  );
}

export function PrintQuotePage() {
  const { id } = useParams();
  const { data: q, loading, error } = useQuote(id);
  const { settings } = useSettings();
  if (loading) return <PageLoader />;
  if (error || !q) return <ErrorState message={error ?? "Cotización no encontrada"} />;
  return (
    <PrintShell settings={settings} title="Cotización" code={`${q.code}${q.version > 1 ? ` v${q.version}` : ""}`} date={formatDate(q.sentAt ?? q.createdAt)}>
      <div className="grid grid-cols-2 gap-6">
        <Box title="Preparado para"><KV rows={[["Cliente", q.customerName], ["Orden", q.orderCode ?? "Cotización previa"]]} /></Box>
        <Box title="Vehículo"><KV rows={[["Vehículo", q.vehicleLabel], ["Placa", formatPlate(q.plate)]]} /></Box>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="bg-slate-900 text-left text-[11px] uppercase tracking-wide text-white"><th className="px-2 py-1.5">Descripción</th><th className="px-2 py-1.5">Tipo</th><th className="px-2 py-1.5 text-right">Cant.</th><th className="px-2 py-1.5 text-right">Precio</th><th className="px-2 py-1.5 text-right">Desc.</th><th className="px-2 py-1.5 text-right">Total</th></tr></thead>
        <tbody>
          {q.items.map((it) => (
            <tr key={it.id} className="border-b border-slate-200">
              <td className="px-2 py-1.5">{it.description}</td><td className="px-2 py-1.5 text-slate-500">{QUOTE_ITEM_LABELS[it.type]}</td>
              <td className="px-2 py-1.5 text-right">{it.qty}</td><td className="px-2 py-1.5 text-right">{formatMoney(it.unitPrice)}</td>
              <td className="px-2 py-1.5 text-right">{it.discount ? formatMoney(it.discount) : ""}</td><td className="px-2 py-1.5 text-right font-semibold">{formatMoney(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end">
        <dl className="w-64 space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(q.totals.subtotal)}</dd></div>
          {q.totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Descuento</dt><dd>- {formatMoney(q.totals.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-500">ISV ({q.taxRate}%)</dt><dd>{formatMoney(q.totals.tax)}</dd></div>
          <div className="flex justify-between border-t-2 border-slate-900 pt-1 text-base font-extrabold"><dt>Total</dt><dd>{formatMoney(q.totals.total)}</dd></div>
        </dl>
      </div>
      <Box title="Condiciones generales">
        {q.notes && <p className="whitespace-pre-line">{q.notes}</p>}
        <p>Cotización válida {q.validUntil ? `hasta el ${formatDate(q.validUntil)}` : `por ${q.validDays} días`}. Precios en Lempiras, incluyen ISV donde se indica.</p>
        <p>Estado: {QUOTE_STATUS_META[q.status].label}{q.decision ? ` por ${q.decision.name} el ${formatDate(q.decision.at, true)} (ID ${q.decision.approvalId.slice(0, 8)})` : ""}.</p>
      </Box>
    </PrintShell>
  );
}

export function PrintReceiptPage() {
  const { id } = useParams();
  const { data: p, loading, error } = usePayment(id);
  const { settings } = useSettings();
  if (loading) return <PageLoader />;
  if (error || !p) return <ErrorState message={error ?? "Pago no encontrado"} />;
  return (
    <PrintShell settings={settings} title="Comprobante de pago" code={p.code} date={formatDate(p.at, true)}>
      {p.status === "voided" && <div className="rounded border-2 border-red-600 p-2 text-center text-lg font-extrabold text-red-600">ANULADO · {p.voidReason}</div>}
      <KV rows={[["Recibido de", p.customerName], ["Concepto", p.orderCode ? `Orden de trabajo ${p.orderCode}` : p.saleCode ? `Venta ${p.saleCode}` : ""], ["Método", PAYMENT_METHOD_LABELS[p.method]], ["Referencia", p.reference], ["Recibido por", p.receivedByName]]} />
      <div className="rounded-lg bg-slate-100 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Monto recibido</div>
        <div className="text-3xl font-extrabold">{formatMoney(p.amount)}</div>
      </div>
      <div className="grid grid-cols-2 gap-10 pt-12 text-center text-[11px] text-slate-500">
        <div className="border-t border-slate-400 pt-1">Firma del cliente</div>
        <div className="border-t border-slate-400 pt-1">{settings.name}</div>
      </div>
      <p className="text-[10.5px] text-slate-400">Comprobante interno de pago. No es factura fiscal.</p>
    </PrintShell>
  );
}

export function PrintSalePage() {
  const { id } = useParams();
  const { data: s, loading, error } = useSale(id);
  const pays = useSalePayments(id);
  const { settings } = useSettings();
  if (loading) return <PageLoader />;
  if (error || !s) return <ErrorState message={error ?? "Venta no encontrada"} />;
  return (
    <PrintShell settings={settings} title="Comprobante de venta" code={s.code} date={formatDate(s.at, true)}>
      <KV rows={[["Cliente", s.customerName], ["Vehículo", s.vehicleLabel], ["Atendió", s.byName]]} />
      <table className="w-full border-collapse">
        <thead><tr className="bg-slate-900 text-left text-[11px] uppercase tracking-wide text-white"><th className="px-2 py-1.5">Descripción</th><th className="px-2 py-1.5 text-right">Cant.</th><th className="px-2 py-1.5 text-right">Precio</th><th className="px-2 py-1.5 text-right">Desc.</th><th className="px-2 py-1.5 text-right">Total</th></tr></thead>
        <tbody>
          {s.items.map((it) => (
            <tr key={it.id} className="border-b border-slate-200"><td className="px-2 py-1.5">{it.description}</td><td className="px-2 py-1.5 text-right">{it.qty}</td><td className="px-2 py-1.5 text-right">{formatMoney(it.unitPrice)}</td><td className="px-2 py-1.5 text-right">{it.discount ? formatMoney(it.discount) : ""}</td><td className="px-2 py-1.5 text-right font-semibold">{formatMoney(it.lineTotal)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end">
        <dl className="w-64 space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(s.totals.subtotal)}</dd></div>
          {s.totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Descuento</dt><dd>- {formatMoney(s.totals.discount)}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-500">ISV ({s.taxRate}%)</dt><dd>{formatMoney(s.totals.tax)}</dd></div>
          <div className="flex justify-between border-t-2 border-slate-900 pt-1 text-base font-extrabold"><dt>Total</dt><dd>{formatMoney(s.totals.total)}</dd></div>
          {pays.data.filter((p) => p.status === "valid").map((p) => <div key={p.id} className="flex justify-between text-slate-600"><dt>{PAYMENT_METHOD_LABELS[p.method]} ({p.code})</dt><dd>{formatMoney(p.amount)}</dd></div>)}
          <div className="flex justify-between font-bold"><dt>Saldo</dt><dd>{formatMoney(s.balance)}</dd></div>
        </dl>
      </div>
      <p className="text-[10.5px] text-slate-400">Comprobante interno de venta. No es factura fiscal.</p>
    </PrintShell>
  );
}
