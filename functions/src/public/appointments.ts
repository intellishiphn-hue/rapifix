import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  DEFAULT_TENANT_ID, MAX_ACTIVE_PER_PHONE, SLOT_CAPACITY, availableSlots, hnDayKey, hnSlotMs, isBookable, opsCol, publicAppointmentSchema,
  publicSlotsSchema, slotOf, webPhone, webReason, type PublicAppointmentResult, type PublicSlotsResult,
} from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { parseInput } from "../lib/guards";
import { rateLimit, requestIp, requireAppCheck } from "../lib/rateLimit";

/**
 * Citas desde la web pública (/agendar). Sin sesión: todo pasa por estas funciones y las reglas
 * siguen sin permitir leer la agenda desde el navegador. Solo devuelven horas libres, nunca datos de otras citas.
 */
const TID = process.env.PUBLIC_TENANT_ID || DEFAULT_TENANT_ID;
const appts = () => db.collection(opsCol.appointments(TID));

/** Citas no canceladas que empiezan en cada bloque de 30 minutos del día */
function takenBySlot(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of docs) {
    if (d.get("status") === "cancelled") continue;
    const start = d.get("start") as Timestamp | undefined;
    if (!start) continue;
    const k = slotOf(start.toMillis());
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export const publicAppointmentSlots = onCall({ region: REGION }, async (request): Promise<PublicSlotsResult> => {
  requireAppCheck(request);
  const { date } = parseInput(publicSlotsSchema, request.data);
  await rateLimit("slots-ip", [requestIp(request)], 120, 600);
  const now = Date.now();
  const snap = await appts().where("dayKey", "==", date).get();
  return { date, slots: availableSlots(date, takenBySlot(snap.docs), now) };
});

export const requestAppointmentPublic = onCall({ region: REGION }, async (request): Promise<PublicAppointmentResult> => {
  requireAppCheck(request);
  const input = parseInput(publicAppointmentSchema, request.data);
  const now = Date.now();
  if (!isBookable(input.date, input.time, now)) throw new HttpsError("failed-precondition", "Ese horario ya no está disponible. Elige otra hora.");
  await rateLimit("appt-ip", [requestIp(request)], 5, 3600);
  const phone = webPhone(input.phone);
  const reason = webReason(input.reason);
  const start = hnSlotMs(input.date, input.time);
  const duration = input.reason === "carwash" ? 30 : 60;
  const ref = appts().doc();

  await db.runTransaction(async (tx) => {
    const [day, byPhone] = await Promise.all([tx.get(appts().where("dayKey", "==", input.date)), tx.get(appts().where("phone", "==", phone))]);
    const taken = takenBySlot(day.docs);
    if ((taken[input.time] ?? 0) >= SLOT_CAPACITY) throw new HttpsError("already-exists", "Ese horario ya no está disponible. Elige otra hora.");
    const active = byPhone.docs.filter((d) => {
      const s = d.get("status");
      const st = (d.get("start") as Timestamp | undefined)?.toMillis() ?? 0;
      return (s === "scheduled" || s === "confirmed") && st > now;
    });
    if (active.length >= MAX_ACTIVE_PER_PHONE) {
      throw new HttpsError("resource-exhausted", "Ya tienes citas pendientes con este número. Escríbenos por WhatsApp si necesitas cambiarlas.");
    }
    const title = `Cita web: ${reason.label}${input.detail ? ` (${input.detail})` : ""}`;
    tx.set(ref, {
      type: reason.type,
      status: "scheduled",
      start: Timestamp.fromMillis(start),
      end: Timestamp.fromMillis(start + duration * 60000),
      durationMin: duration,
      dayKey: hnDayKey(start),
      // No se vincula a clientes ni vehículos existentes: recepción lo hace desde el panel
      customerId: null,
      customerName: input.name,
      phone,
      vehicleId: null,
      vehicleLabel: input.vehicle,
      plate: input.plate.toUpperCase().replace(/\s+/g, " "),
      workOrderId: null,
      workOrderCode: null,
      maintenanceId: null,
      technicianId: null,
      technicianName: "",
      notes: [title, input.comment].filter(Boolean).join("\n"),
      source: "web",
      webReason: input.reason,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "web",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "web",
    });
  });
  return { ok: true, date: input.date, time: input.time };
});
