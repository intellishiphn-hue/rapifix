import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { formatMoney, formatPhone, isPlaceholderPlate, loyaltyText, netOf, VEHICLE_SIZE_LABELS, WASH_COVERAGE_LABELS, WASH_STATUS_LABELS } from "@rapifix/shared";
import { formatDate, formatPlate } from "@/lib/format";
import { ErrorState, PageLoader } from "@/components/ui/Feedback";
import { useSettings } from "@/features/settings/api";
import { useCarwashSettings, useLoyalty, useWash } from "./api";

/** Ticket de 80 mm del lavado (se abre en otra pestaña e imprime directo). */
export function WashTicketPage() {
  const { id } = useParams();
  const { data: w, loading, error } = useWash(id);
  const { settings: general } = useSettings();
  const { settings: cw } = useCarwashSettings();
  const loyalty = useLoyalty(w?.plate);
  if (loading) return <PageLoader />;
  if (error || !w) return <ErrorState message={error ?? "Lavado no encontrado"} />;

  const every = w.loyaltyEvery ?? cw.loyaltyEvery;
  const stamps = w.loyaltyCounted && typeof w.loyaltyStamps === "number" ? w.loyaltyStamps : loyalty.data?.count ?? 0;
  const rewards = loyalty.data?.rewardsAvailable ?? 0;
  // Sin placa real no hay tarjeta de lealtad (el lavado no suma sellos)
  const loyaltyLine = every > 0 && !isPlaceholderPlate(w.plate) ? loyaltyText(stamps, every, rewards) : "";

  return (
    <div className="min-h-screen bg-slate-200 py-6 print:bg-white print:py-0">
      <style>{`@page { size: 80mm auto; margin: 3mm; } @media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <div className="no-print mx-auto mb-4 flex w-[80mm] justify-end">
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>
      <div className="mx-auto w-[80mm] bg-white p-3 font-mono text-[11.5px] leading-snug text-black shadow-lg print:w-full print:p-0 print:shadow-none">
        <div className="text-center">
          {general.logoUrl && <img src={general.logoUrl} alt="" className="mx-auto mb-1 h-10 max-w-[60mm] object-contain grayscale" />}
          <div className="text-[14px] font-bold uppercase">{general.name || "RAPIFIX"}</div>
          <div>Carwash</div>
          {[general.address, general.city].filter(Boolean).length > 0 && <div>{[general.address, general.city].filter(Boolean).join(", ")}</div>}
          {general.phone && <div>Tel. {formatPhone(general.phone)}</div>}
          {general.rtn && <div>RTN {general.rtn}</div>}
          {cw.ticketHeader && <div className="mt-1 whitespace-pre-line">{cw.ticketHeader}</div>}
        </div>
        <Rule />
        <div className="flex justify-between font-bold"><span>{w.code}</span><span>{WASH_STATUS_LABELS[w.status]}</span></div>
        <div>{formatDate(w.createdAt, true)}</div>
        <div className="mt-1 text-center text-[20px] font-extrabold tracking-widest">{formatPlate(w.plate)}</div>
        <div className="text-center">{VEHICLE_SIZE_LABELS[w.size]}</div>
        {w.customerName && <div className="mt-1">Cliente: {w.customerName}</div>}
        {w.washerName && <div>Lavador: {w.washerName}</div>}
        <Rule />
        {w.items.map((i) => (
          <div key={i.serviceId}>
            <div className="flex justify-between gap-2">
              <span>{i.name}</span>
              <span className="shrink-0">{formatMoney(i.price)}</span>
            </div>
            {i.covered && <div className="pl-2 text-[10.5px]">({WASH_COVERAGE_LABELS[i.covered]}, precio {formatMoney(i.listPrice)})</div>}
          </div>
        ))}
        <Rule />
        {w.discount > 0 && <Row label="Descuento" value={`- ${formatMoney(w.discount)}`} />}
        {w.totals && w.taxMode !== "exempt" && (
          <>
            <Row label="Subtotal" value={formatMoney(netOf(w.totals))} />
            <Row label={`ISV ${w.taxRate}%`} value={formatMoney(w.totals.tax)} />
          </>
        )}
        <div className="flex justify-between text-[14px] font-extrabold"><span>TOTAL</span><span>{formatMoney(w.total)}</span></div>
        <div className="mt-1 text-center font-bold">
          {w.total === 0 ? "SIN COBRO" : w.paid ? `PAGADO${w.saleCode ? ` · ${w.saleCode}` : ""}` : "PENDIENTE DE PAGO"}
        </div>
        {w.membershipCode && <div className="text-center">Membresía {w.membershipCode}</div>}
        {loyaltyLine && (
          <>
            <Rule />
            <div className="text-center">{loyaltyLine}</div>
            {every <= 20 && (
              <div className="mt-1 text-center tracking-[0.2em]">{Array.from({ length: every }, (_, i) => (i < stamps ? "●" : "○")).join("")}</div>
            )}
          </>
        )}
        {w.notes && (
          <>
            <Rule />
            <div className="whitespace-pre-line">Notas: {w.notes}</div>
          </>
        )}
        <Rule />
        {cw.ticketFooter && <div className="whitespace-pre-line text-center">{cw.ticketFooter}</div>}
        <div className="mt-1 text-center text-[10px]">Comprobante interno. No es factura fiscal.</div>
      </div>
    </div>
  );
}

function Rule() {
  return <div className="my-1.5 border-t border-dashed border-black" />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
