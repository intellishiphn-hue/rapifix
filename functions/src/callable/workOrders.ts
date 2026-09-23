import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  addOrderEventSchema, canTransition, changeStatusSchema, col, createWorkOrderSchema,
  isOpenStatus, orderCol, saveSectionSchema, STATUS_META, updateWorkOrderSchema,
  type OrderEventType, type Role, type WorkOrderStatus,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput, requireRole, type Caller } from "../lib/guards";
import { actorName } from "../lib/actors";
import { insertWorkOrder, logMileage, resolveTechnicians } from "../lib/orders";

const ALL_STAFF: Role[] = ["admin", "manager", "reception", "technician", "warehouse", "seller"];
const DESK: Role[] = ["admin", "manager", "reception"];

function orderRef(tid: string, id: string) {
  return db.doc(`${orderCol.workOrders(tid)}/${id}`);
}

function eventData(caller: Caller, name: string, type: OrderEventType, text: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    text,
    visibleToCustomer: false,
    channels: [],
    fromStatus: null,
    toStatus: null,
    actorId: caller.uid,
    actorName: name,
    at: FieldValue.serverTimestamp(),
    ...extra,
  };
}

/** El técnico solo puede trabajar órdenes donde está asignado. */
function assertCanWork(caller: Caller, order: FirebaseFirestore.DocumentData) {
  if (DESK.includes(caller.role)) return;
  if (caller.role === "technician" && (order.technicianIds as string[]).includes(caller.uid)) return;
  throw new HttpsError("permission-denied", "No está asignado a esta orden.");
}

/** Crea una orden de trabajo con numeración correlativa y token de portal. */
export const createWorkOrder = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(createWorkOrderSchema, request.data);
  const name = await actorName(caller.uid, caller.email);
  return insertWorkOrder(caller, name, input);
});

/** Cambia el estado validando el flujo y el rol. Deja historial. */
export const changeWorkOrderStatus = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ALL_STAFF);
  const input = parseInput(changeStatusSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const ref = orderRef(tid, input.orderId);
  let vehicleId = "";

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "La orden no existe.");
    const order = snap.data()!;
    const from = order.status as WorkOrderStatus;
    const to = input.toStatus;
    if (caller.role === "technician") assertCanWork(caller, order);
    if (!canTransition(caller.role, from, to)) {
      throw new HttpsError("failed-precondition", `No se puede pasar de "${STATUS_META[from].label}" a "${STATUS_META[to].label}" con su rol.`);
    }
    if (to === "CANCELLED" && !input.note?.trim()) {
      throw new HttpsError("invalid-argument", "Indique el motivo de la cancelación.");
    }
    vehicleId = order.vehicleId;
    const update: Record<string, unknown> = {
      status: to,
      isOpen: isOpenStatus(to),
      statusChangedAt: FieldValue.serverTimestamp(),
      statusChangedBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller.uid,
    };
    if (to === "DELIVERED") {
      update.deliveredAt = FieldValue.serverTimestamp();
      if (input.mileageOut != null) update.mileageOut = input.mileageOut;
    }
    if (to === "CANCELLED") update.cancelReason = input.note!.trim();
    if (from === "CANCELLED") update.cancelReason = "";
    tx.update(ref, update);

    const text = `${STATUS_META[from].label} → ${STATUS_META[to].label}${input.note?.trim() ? `. ${input.note.trim()}` : ""}`;
    tx.set(ref.collection("events").doc(), eventData(caller, name, "status_change", text, {
      fromStatus: from, toStatus: to, visibleToCustomer: to !== "CANCELLED",
    }));
    return { from, to };
  });

  if (result.to === "DELIVERED" && input.mileageOut != null && vehicleId) {
    await logMileage(db.doc(`${col.vehicles(tid)}/${vehicleId}`), input.mileageOut, "delivery", caller, name, "Entrega");
  }
  return result;
});

/** Edita datos generales: motivo, tipo, prioridad, técnicos, fecha prometida. */
export const updateWorkOrder = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, DESK);
  const input = parseInput(updateWorkOrderSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const ref = orderRef(tid, input.orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La orden no existe.");
  if (!snap.get("isOpen")) throw new HttpsError("failed-precondition", "La orden está cerrada.");

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };
  if (input.reason !== undefined) update.reason = input.reason;
  if (input.type !== undefined) update.type = input.type;
  if (input.priority !== undefined) update.priority = input.priority;
  if (input.promisedAt !== undefined) update.promisedAt = input.promisedAt ? Timestamp.fromDate(new Date(input.promisedAt)) : null;

  const batch = db.batch();
  if (input.technicianIds !== undefined) {
    const technicians = await resolveTechnicians(tid, input.technicianIds);
    const newIds = technicians.map((t) => t.id);
    update.technicianIds = newIds;
    update.technicians = technicians;
    const before = ((snap.get("technicianIds") as string[]) ?? []).slice().sort().join();
    if (before !== newIds.slice().sort().join()) {
      const text = technicians.length ? `Técnico asignado: ${technicians.map((t) => t.name).join(", ")}` : "Se quitó la asignación de técnico";
      batch.set(ref.collection("events").doc(), eventData(caller, name, "assignment", text));
    }
  }
  batch.update(ref, update);
  await batch.commit();
  return { ok: true };
});

/** Guarda recepción, diagnóstico o control de calidad. */
export const saveWorkOrderSection = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "reception", "technician"]);
  const input = parseInput(saveSectionSchema, request.data);
  const tid = caller.tid;
  const name = await actorName(caller.uid, caller.email);
  const ref = orderRef(tid, input.orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La orden no existe.");
  const order = snap.data()!;
  assertCanWork(caller, order);
  if (!order.isOpen) throw new HttpsError("failed-precondition", "La orden está cerrada.");

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  const base = { updatedAt: now, updatedBy: caller.uid };

  if (input.section === "reception") {
    if (caller.role === "technician") throw new HttpsError("permission-denied", "Solo recepción puede editar la recepción.");
    batch.update(ref, { ...base, reception: { ...order.reception, ...input.data } });
    batch.set(ref.collection("events").doc(), eventData(caller, name, "section", "Se actualizó la recepción del vehículo"));
  }

  if (input.section === "diagnosis") {
    const wasComplete = !!order.diagnosis?.completedAt;
    batch.update(ref, {
      ...base,
      diagnosis: {
        ...input.data,
        completedAt: input.complete ? (wasComplete ? order.diagnosis.completedAt : now) : null,
        completedBy: input.complete ? (wasComplete ? order.diagnosis.completedBy : caller.uid) : null,
        updatedAt: now,
        updatedBy: caller.uid,
      },
    });
    if (input.complete && !wasComplete) {
      batch.set(ref.collection("events").doc(), eventData(caller, name, "section", "Diagnóstico completado", { visibleToCustomer: true }));
    }
  }

  if (input.section === "qc") {
    const passed = !!order.qc?.passedAt;
    batch.update(ref, {
      ...base,
      qc: {
        ...input.data,
        passedAt: input.pass ? (passed ? order.qc.passedAt : now) : null,
        passedBy: input.pass ? (passed ? order.qc.passedBy : caller.uid) : null,
      },
    });
    if (input.pass && !passed) {
      batch.set(ref.collection("events").doc(), eventData(caller, name, "section", "Control de calidad aprobado", { visibleToCustomer: true }));
    }
  }

  await batch.commit();
  return { ok: true };
});

/** Nota interna o actualización para el cliente (Centro de comunicación). */
export const addOrderEvent = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin", "manager", "reception", "technician"]);
  const input = parseInput(addOrderEventSchema, request.data);
  const tid = caller.tid;
  const ref = orderRef(tid, input.orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La orden no existe.");
  assertCanWork(caller, snap.data()!);
  const name = await actorName(caller.uid, caller.email);
  const ev = await ref.collection("events").add(
    eventData(caller, name, input.visibleToCustomer ? "customer_update" : "note", input.text, {
      visibleToCustomer: input.visibleToCustomer,
      channels: input.channels,
    }),
  );
  await ref.update({ updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  return { eventId: ev.id };
});

/** Registra el último acceso (y sincroniza el directorio del personal). */
export const touchSession = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debe iniciar sesión.");
  const ref = db.doc(`users/${request.auth.uid}`);
  if ((await ref.get()).exists) await ref.update({ lastLoginAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
