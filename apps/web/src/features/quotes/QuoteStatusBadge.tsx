import { QUOTE_STATUS_META, type QuoteStatus } from "@rapifix/shared";
import { Badge } from "@/components/ui/Badge";

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const m = QUOTE_STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
