import {
  agingBucket, agingSummary, daysOverdue, deliveredMs, hnDayKey, orderBalance, orderDueKey, orderPaid, orderTotal,
  type AgingBucket, type Company, type Payment, type WorkOrder,
} from "@rapifix/shared";

export interface StatementRow {
  order: WorkOrder;
  deliveredAt: number | null;
  dueKey: string | null;
  balance: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

/** Órdenes con saldo de la empresa, con vencimiento y antigüedad (de la más vieja a la más nueva). */
export function statementRows(company: Company | null | undefined, orders: WorkOrder[], todayKey = hnDayKey(Date.now())): StatementRow[] {
  return orders
    .filter((o) => o.status !== "CANCELLED" && orderBalance(o) > 0)
    .map((o) => {
      const at = o.status === "DELIVERED" ? deliveredMs(o) : null;
      const dueKey = orderDueKey(company ?? null, at);
      return { order: o, deliveredAt: at, dueKey, balance: orderBalance(o), daysOverdue: daysOverdue(dueKey, todayKey), bucket: agingBucket(dueKey, todayKey) };
    })
    .sort((a, b) => {
      if (a.dueKey !== b.dueKey) {
        if (!a.dueKey) return 1;
        if (!b.dueKey) return -1;
        return a.dueKey < b.dueKey ? -1 : 1;
      }
      return (a.order.number ?? 0) - (b.order.number ?? 0);
    });
}

export function statementSummary(rows: StatementRow[], todayKey = hnDayKey(Date.now())) {
  return agingSummary(rows.map((r) => ({ balance: r.balance, dueKey: r.dueKey })), todayKey);
}

/** Órdenes entregadas y pagos recibidos en [start, end) para el estado de cuenta impreso. */
export function periodMovements(orders: WorkOrder[], payments: Payment[], start: number, end: number) {
  const delivered = orders
    .filter((o) => o.status === "DELIVERED")
    .map((o) => ({ o, at: deliveredMs(o) ?? 0 }))
    .filter((x) => x.at >= start && x.at < end)
    .sort((a, b) => a.at - b.at);
  const paid = payments
    .filter((p) => p.status === "valid" && p.orderId)
    .filter((p) => {
      const t = p.at?.toMillis?.() ?? 0;
      return t >= start && t < end;
    })
    .sort((a, b) => (a.at?.toMillis?.() ?? 0) - (b.at?.toMillis?.() ?? 0));
  return {
    delivered,
    payments: paid,
    billed: delivered.reduce((a, x) => a + orderTotal(x.o), 0),
    collected: paid.reduce((a, p) => a + p.amount, 0),
    paidOfDelivered: delivered.reduce((a, x) => a + orderPaid(x.o), 0),
  };
}
