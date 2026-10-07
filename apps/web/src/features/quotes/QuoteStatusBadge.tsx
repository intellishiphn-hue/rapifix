import { QUOTE_STATUS_META, type QuoteStatus } from "@rapifix/shared";
import { Badge } from "@/components/ui/Badge";

/** `discarded`: modificación descartada por el taller (se guarda como expirada). */
export function QuoteStatusBadge({ status, discarded }: { status: QuoteStatus; discarded?: boolean }) {
  const m = QUOTE_STATUS_META[status];
  return <Badge tone={m.tone}>{status === "expired" && discarded ? "Descartada" : m.label}</Badge>;
}
