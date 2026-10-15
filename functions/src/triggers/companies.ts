import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { col } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { recountCompanyOrders, syncOrderCommission } from "../lib/companies";

type Data = FirebaseFirestore.DocumentData | undefined;
const same = (a: Data, b: Data, f: (d: FirebaseFirestore.DocumentData) => unknown) => JSON.stringify(a ? f(a) ?? null : null) === JSON.stringify(b ? f(b) ?? null : null);

/**
 * Órdenes del taller:
 * - Comisión por referido: se gana cuando la orden queda pagada completa (cubre registerPayment, pagos en línea,
 *   comprobantes aprobados y pagos de empresa, porque todos cambian paid/balance de la orden). Si después vuelve a
 *   tener saldo, la pendiente se anula; si la cotización cambia, la pendiente se recalcula.
 * - Saldo y órdenes abiertas de la empresa (flota).
 */
export const onWorkOrderCompanyWritten = onDocumentWritten(
  { document: "tenants/{tid}/workOrders/{orderId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const { tid, orderId } = event.params;

    const moneyChanged = !before || !after
      || !same(before, after, (d) => d.paid) || !same(before, after, (d) => d.balance)
      || !same(before, after, (d) => d.totals?.total) || !same(before, after, (d) => d.activeQuoteId)
      || !same(before, after, (d) => d.status);
    const companyChanged = !same(before, after, (d) => d.companyId);

    const jobs: Array<Promise<unknown>> = [];
    if (moneyChanged || companyChanged) jobs.push(syncOrderCommission(tid, orderId));
    if (moneyChanged || companyChanged || !same(before, after, (d) => d.isOpen)) {
      const ids = new Set<string>();
      if (before?.companyId) ids.add(before.companyId as string);
      if (after?.companyId) ids.add(after.companyId as string);
      for (const id of ids) jobs.push(recountCompanyOrders(tid, id));
    }
    await Promise.all(jobs);
  },
);

/** Ventas (carwash y mostrador) de un vehículo de empresa: se marcan con la empresa para su reporte. */
export const onSaleCreatedCompany = onDocumentCreated(
  { document: "tenants/{tid}/sales/{saleId}", region: REGION },
  async (event) => {
    const sale = event.data?.data();
    const vehicleId = sale?.vehicleId as string | null | undefined;
    if (!sale || !vehicleId || sale.companyId) return;
    const v = await db.doc(`${col.vehicles(event.params.tid)}/${vehicleId}`).get();
    const companyId = v.get("companyId") as string | undefined;
    if (!companyId) return;
    await event.data!.ref.update({ companyId, companyName: (v.get("companyName") as string) ?? "" });
  },
);
