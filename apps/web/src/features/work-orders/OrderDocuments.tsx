import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, ExternalLink, FileText, Globe, Printer } from "lucide-react";
import type { WorkOrder } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ensurePortal, useOrderQuotes } from "@/features/quotes/api";
import { QuoteStatusBadge } from "@/features/quotes/QuoteStatusBadge";

/** Link del cliente: copia o abre el portal (lo construye si todavía no existe). */
export function PortalLinkButton({ order }: { order: WorkOrder }) {
  const [busy, setBusy] = useState(false);
  const go = async (copy: boolean) => {
    setBusy(true);
    try {
      const { token } = await ensurePortal({ orderId: order.id });
      const url = `${window.location.origin}/orden/${token}`;
      if (copy) {
        await navigator.clipboard.writeText(url);
        toast.success("Link del cliente copiado");
      } else window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" icon={<Globe className="h-4 w-4" />} loading={busy} onClick={() => void go(true)}>Copiar link del cliente</Button>
      <Button size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" />} onClick={() => void go(false)} aria-label="Ver portal">Ver</Button>
    </div>
  );
}

export function OrderDocuments({ order }: { order: WorkOrder }) {
  const { data: quotes } = useOrderQuotes(order.id);
  return (
    <ul className="divide-y divide-slate-100">
      <li className="flex items-center gap-3 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><FileText className="h-5 w-5" /></span>
        <div className="flex-1"><div className="font-semibold">Orden de trabajo {order.code}</div><div className="text-xs text-slate-500">Recepción, diagnóstico y firmas</div></div>
        <Link to={`/imprimir/orden/${order.id}`} target="_blank"><Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />}>Imprimir / PDF</Button></Link>
      </li>
      {quotes.filter((q) => q.status !== "draft").map((q) => (
        <li key={q.id} className="flex items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><FileText className="h-5 w-5" /></span>
          <div className="flex-1"><div className="flex items-center gap-2 font-semibold">Cotización {q.code}{q.version > 1 && ` v${q.version}`} <QuoteStatusBadge status={q.status} /></div><div className="text-xs text-slate-500">{formatDate(q.sentAt ?? q.createdAt)}</div></div>
          <Link to={`/imprimir/cotizacion/${q.id}`} target="_blank"><Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />}>Imprimir / PDF</Button></Link>
        </li>
      ))}
      <li className="px-5 py-3 text-xs text-slate-500"><Copy className="mr-1 inline h-3 w-3" />Use "Guardar como PDF" en la ventana de impresión para enviarlo por correo o WhatsApp.</li>
    </ul>
  );
}
