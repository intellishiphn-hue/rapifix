import { doc } from "firebase/firestore";
import { opsCol, type Appointment } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDocData } from "@/lib/firestore/hooks";
import { AppointmentDetailDialog } from "./AppointmentDetailDialog";

/** Después de crear una cita: abre la cita con el WhatsApp de confirmación listo para el cliente. */
export function JustCreatedConfirm({ id, colorOf, onClose }: { id: string; colorOf?: (id: string | null | undefined) => string; onClose: () => void }) {
  const { data } = useDocData<Appointment>(doc(db, opsCol.appointments(TENANT_ID), id), `appointment-${id}`);
  if (!data) return null;
  return <AppointmentDetailDialog appointment={data} color={colorOf?.(data.technicianId) ?? "#2563eb"} onClose={onClose} onEdit={onClose} initialMsg="confirm" />;
}
