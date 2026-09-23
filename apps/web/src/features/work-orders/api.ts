import {
  addDoc, collection, deleteDoc, doc, limit, orderBy, query, serverTimestamp, updateDoc, where, type QueryConstraint,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import {
  orderCol, orderStoragePath, searchToken,
  type AddOrderEventInput, type ChangeStatusInput, type CreateWorkOrderInput, type OrderEvent, type OrderPhoto,
  type PhotoStage, type SaveSectionInput, type StaffEntry, type UpdateWorkOrderInput, type WorkOrder, type WorkOrderStatus,
} from "@rapifix/shared";
import { callable, db, storage, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { useAuth } from "@/lib/auth/useAuth";
import { newId, uploadImage } from "@/lib/storage";

const ordersCol = () => collection(db, orderCol.workOrders(TENANT_ID));
export const orderRef = (id: string) => doc(db, orderCol.workOrders(TENANT_ID), id);

// ---------- Cloud Functions ----------
export const createWorkOrder = callable<CreateWorkOrderInput, { orderId: string; code: string }>("createWorkOrder");
export const changeWorkOrderStatus = callable<ChangeStatusInput, { from: WorkOrderStatus; to: WorkOrderStatus }>("changeWorkOrderStatus");
export const updateWorkOrder = callable<UpdateWorkOrderInput, { ok: boolean }>("updateWorkOrder");
export const saveWorkOrderSection = callable<SaveSectionInput, { ok: boolean }>("saveWorkOrderSection");
export const addOrderEvent = callable<AddOrderEventInput, { eventId: string }>("addOrderEvent");
export const seedDemoOrders = callable<void, { orders: number }>("seedDemoOrders");
export const touchSession = callable<void, { ok: boolean }>("touchSession");

/**
 * Las reglas solo dejan ver al técnico las órdenes donde está asignado,
 * así que todas sus consultas deben incluir ese filtro.
 */
function useScope(): { constraints: QueryConstraint[]; key: string } {
  const { role, user } = useAuth();
  if (role === "technician" && user) return { constraints: [where("technicianIds", "array-contains", user.uid)], key: `tech:${user.uid}` };
  return { constraints: [], key: "all" };
}

/** Órdenes abiertas (Kanban). Incluye entregadas de los últimos días aparte. */
export function useOpenOrders() {
  const scope = useScope();
  return useQueryData<WorkOrder>(
    query(ordersCol(), ...scope.constraints, where("isOpen", "==", true), orderBy("statusChangedAt", "desc"), limit(300)),
    `open-orders|${scope.key}`,
  );
}

export function useRecentDelivered(days = 7) {
  const scope = useScope();
  return useQueryData<WorkOrder>(
    query(ordersCol(), ...scope.constraints, where("status", "==", "DELIVERED"), orderBy("createdAt", "desc"), limit(40)),
    `delivered|${scope.key}|${days}`,
  );
}

export type ListStatus = WorkOrderStatus | "all" | "open";

export function useOrdersList(opts: { search: string; status: ListStatus; pageSize: number }) {
  const scope = useScope();
  const token = searchToken(opts.search);
  const searching = token.length >= 2;
  const c: QueryConstraint[] = [...scope.constraints];

  // Firestore permite un solo array-contains por consulta. El personal busca en el servidor;
  // el técnico (que ya filtra por technicianIds) busca sobre sus órdenes en pantalla.
  if (searching && scope.key === "all") {
    c.push(where("searchKeywords", "array-contains", token), orderBy("createdAt", "desc"));
  } else if (opts.status === "open") {
    c.push(where("isOpen", "==", true), orderBy("statusChangedAt", "desc"));
  } else if (opts.status !== "all") {
    c.push(where("status", "==", opts.status), orderBy("createdAt", "desc"));
  } else {
    c.push(orderBy("createdAt", "desc"));
  }
  c.push(limit(opts.pageSize));

  const state = useQueryData<WorkOrder>(query(ordersCol(), ...c), `orders|${scope.key}|${token}|${opts.status}|${opts.pageSize}`);
  let data = state.data;
  if (searching && scope.key !== "all") data = data.filter((o) => o.searchKeywords?.includes(token));
  if (searching && scope.key === "all") {
    if (opts.status === "open") data = data.filter((o) => o.isOpen);
    else if (opts.status !== "all") data = data.filter((o) => o.status === opts.status);
  }
  return { ...state, data, hasMore: state.data.length >= opts.pageSize };
}

export function useVehicleOrders(vehicleId: string | undefined) {
  const scope = useScope();
  return useQueryData<WorkOrder>(
    vehicleId ? query(ordersCol(), ...scope.constraints, where("vehicleId", "==", vehicleId), orderBy("createdAt", "desc"), limit(50)) : null,
    `vehicle-orders|${scope.key}|${vehicleId}`,
  );
}

export function useCustomerOrders(customerId: string | undefined) {
  const scope = useScope();
  return useQueryData<WorkOrder>(
    customerId ? query(ordersCol(), ...scope.constraints, where("customerId", "==", customerId), orderBy("createdAt", "desc"), limit(50)) : null,
    `customer-orders|${scope.key}|${customerId}`,
  );
}

export function useWorkOrder(id: string | undefined) {
  return useDocData<WorkOrder>(id ? orderRef(id) : null, `order-${id}`);
}

export function useOrderEvents(orderId: string | undefined) {
  return useQueryData<OrderEvent>(
    orderId ? query(collection(db, orderCol.events(TENANT_ID, orderId)), orderBy("at", "desc"), limit(200)) : null,
    `order-events-${orderId}`,
  );
}

export function useOrderPhotos(orderId: string | undefined) {
  return useQueryData<OrderPhoto>(
    orderId ? query(collection(db, orderCol.photos(TENANT_ID, orderId)), orderBy("at", "desc")) : null,
    `order-photos-${orderId}`,
  );
}

/** Personal activo del taller (para asignar técnicos). */
export function useStaffDirectory() {
  const state = useQueryData<StaffEntry>(query(collection(db, orderCol.staff(TENANT_ID)), orderBy("displayName")), "staff-directory");
  return { ...state, technicians: state.data.filter((s) => s.active && s.role === "technician"), active: state.data.filter((s) => s.active) };
}

// ---------- Fotos ----------
export async function uploadOrderPhoto(
  orderId: string,
  file: File,
  meta: { stage: PhotoStage; angle?: string; caption?: string; visibleToCustomer?: boolean },
  uid: string,
  byName: string,
  onProgress?: (p: number) => void,
) {
  const path = orderStoragePath.photo(TENANT_ID, orderId, newId());
  const url = await uploadImage(file, path, onProgress);
  await addDoc(collection(db, orderCol.photos(TENANT_ID, orderId)), {
    url,
    storagePath: path,
    stage: meta.stage,
    angle: meta.angle ?? "",
    caption: meta.caption ?? "",
    visibleToCustomer: meta.visibleToCustomer ?? meta.stage !== "diagnosis",
    by: uid,
    byName,
    at: serverTimestamp(),
  });
}

export async function updateOrderPhoto(orderId: string, photoId: string, patch: Partial<Pick<OrderPhoto, "caption" | "visibleToCustomer" | "stage">>) {
  await updateDoc(doc(db, orderCol.photos(TENANT_ID, orderId), photoId), patch);
}

export async function deleteOrderPhoto(orderId: string, photo: OrderPhoto) {
  await deleteDoc(doc(db, orderCol.photos(TENANT_ID, orderId), photo.id));
  await deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined);
}
