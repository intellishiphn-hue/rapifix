import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { REGION } from "../lib/params";
import { ownersOfPlate, ownersOfVehicle, ownersOfVehicleId, rebuildHistories, type HistoryOwner } from "../lib/history";

/**
 * "Mi historial RAPIFIX": rehace publicHistory/{token} del cliente y de la empresa cuando cambia algo
 * que se muestra. Cada trigger solo actúa si cambió un campo visible (filtro `changed`), y
 * buildHistory no hace nada si el link no está activo ni escribe si el contenido es igual.
 */

type Data = FirebaseFirestore.DocumentData | undefined;
const pick = (d: Data, fields: string[]) => (d ? JSON.stringify(fields.map((f) => f.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], d) ?? null)) : "-");
const changed = (before: Data, after: Data, fields: string[]) => pick(before, fields) !== pick(after, fields);

const customer = (id: unknown): HistoryOwner | null => (id ? { kind: "customer", id: String(id) } : null);
const company = (id: unknown): HistoryOwner | null => (id ? { kind: "company", id: String(id) } : null);

const ORDER_FIELDS = [
  "status", "isOpen", "deliveredAt", "statusChangedAt", "totals.total", "paid", "balance", "activeQuoteId", "mileageOut", "mileageUnit",
  "reception.mileageIn", "reception.receivedAt", "vehicleId", "customerId", "companyId", "portalToken", "portalEnabled", "code",
];
export const onWorkOrderHistory = onDocumentWritten({ document: "tenants/{tid}/workOrders/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!changed(before, after, ORDER_FIELDS)) return;
  await rebuildHistories(e.params.tid, [
    customer(before?.customerId), customer(after?.customerId), company(before?.companyId), company(after?.companyId),
  ]);
});

const QUOTE_FIELDS = ["status", "items", "totals.total", "publicToken", "vehicleId", "customerId", "orderId", "sentAt", "validUntil", "code"];
export const onQuoteHistory = onDocumentWritten({ document: "tenants/{tid}/quotes/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  // Los borradores no se muestran: editarlos no cambia nada
  if ((before?.status ?? "draft") === "draft" && (after?.status ?? "draft") === "draft") return;
  if (!changed(before, after, QUOTE_FIELDS)) return;
  const tid = e.params.tid;
  const vehicleId = (after?.vehicleId ?? before?.vehicleId) as string | undefined;
  await rebuildHistories(tid, [customer(before?.customerId), customer(after?.customerId), ...(await ownersOfVehicleId(tid, vehicleId))]);
});

const MAINT_FIELDS = ["status", "serviceName", "nextDate", "nextMileage", "dueDate", "odometerUnit", "lastDate", "vehicleId"];
export const onMaintenanceHistory = onDocumentWritten({ document: "tenants/{tid}/maintenance/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  // La fecha estimada cambia cada día con el kilometraje estimado: se redondea al día para no rehacer por horas
  const day = (d: Data) => (d ? { ...d, dueDate: typeof d.dueDate?.toMillis === "function" ? Math.floor(d.dueDate.toMillis() / 86_400_000) : null } : d);
  if (!changed(day(before), day(after), MAINT_FIELDS)) return;
  const tid = e.params.tid;
  const ids = new Set([before?.vehicleId, after?.vehicleId].filter(Boolean) as string[]);
  const owners = (await Promise.all([...ids].map((id) => ownersOfVehicleId(tid, id)))).flat();
  await rebuildHistories(tid, owners);
});

const WASH_FIELDS = ["status", "total", "paid", "items", "plate", "payToken", "customerId", "deliveredAt", "code"];
export const onWashHistory = onDocumentWritten({ document: "tenants/{tid}/carwashWashes/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!changed(before, after, WASH_FIELDS)) return;
  const tid = e.params.tid;
  const plates = new Set([before?.plate, after?.plate].filter(Boolean) as string[]);
  const owners = (await Promise.all([...plates].map((p) => ownersOfPlate(tid, p)))).flat();
  await rebuildHistories(tid, owners);
});

export const onLoyaltyHistory = onDocumentWritten({ document: "tenants/{tid}/carwashLoyalty/{plate}", region: REGION }, async (e) => {
  if (!changed(e.data?.before.data(), e.data?.after.data(), ["count", "rewardsAvailable", "welcomePending"])) return;
  await rebuildHistories(e.params.tid, await ownersOfPlate(e.params.tid, e.params.plate));
});

export const onMembershipHistory = onDocumentWritten({ document: "tenants/{tid}/carwashMemberships/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!changed(before, after, ["status", "plate", "planName", "paidUntil", "periodEnd", "usedInPeriod"])) return;
  const tid = e.params.tid;
  const plates = new Set([before?.plate, after?.plate].filter(Boolean) as string[]);
  const owners = (await Promise.all([...plates].map((p) => ownersOfPlate(tid, p)))).flat();
  await rebuildHistories(tid, owners);
});

const VEHICLE_FIELDS = ["customerId", "companyId", "archived", "plate", "make", "model", "year", "color", "mileage", "odometerUnit"];
export const onVehicleHistory = onDocumentWritten({ document: "tenants/{tid}/vehicles/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!changed(before, after, VEHICLE_FIELDS)) return;
  // El dueño anterior también se rehace: así el vehículo vendido o reasignado desaparece de su historial
  await rebuildHistories(e.params.tid, [...ownersOfVehicle(before), ...ownersOfVehicle(after)]);
});

/** Nombre del cliente o datos de la empresa que se muestran (nombre y forma de pago). */
export const onCustomerHistory = onDocumentWritten({ document: "tenants/{tid}/customers/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!after?.history?.enabled || !changed(before, after, ["fullName"])) return;
  await rebuildHistories(e.params.tid, [customer(e.params.id)]);
});

export const onCompanyHistory = onDocumentWritten({ document: "tenants/{tid}/companies/{id}", region: REGION }, async (e) => {
  const before = e.data?.before.data();
  const after = e.data?.after.data();
  if (!after?.history?.enabled || !changed(before, after, ["name", "paymentTerms", "creditDays", "cutoffDay", "monthlyDueDays"])) return;
  await rebuildHistories(e.params.tid, [company(e.params.id)]);
});
