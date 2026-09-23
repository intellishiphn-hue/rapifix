import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { History } from "lucide-react";
import { col, type AuditLog } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { formatDate } from "@/lib/format";
import { useStaffUsers } from "@/features/users/api";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";

const FIELD_LABELS: Record<string, string> = {
  firstName: "nombre", lastName: "apellido", fullName: "nombre completo", phone: "teléfono", whatsapp: "WhatsApp",
  email: "correo", idNumber: "identidad", rtn: "RTN", address: "dirección", city: "ciudad", notes: "notas", status: "estado",
  customerId: "propietario", make: "marca", model: "modelo", year: "año", color: "color", plate: "placa", vin: "VIN",
  mileage: "kilometraje", fuelType: "combustible", engine: "motor", transmission: "transmisión", archived: "archivado",
  coverPhotoUrl: "foto principal", mileageUpdatedAt: "fecha de kilometraje", customer: "datos del propietario",
};
const ACTIONS = { create: "creó el registro", update: "modificó", delete: "eliminó el registro" } as const;

/** Historial de cambios de un registro (auditoría del servidor). */
export function AuditTrail({ entityId }: { entityId: string }) {
  const { data, loading, error } = useQueryData<AuditLog>(
    query(collection(db, col.auditLogs(TENANT_ID)), where("entityId", "==", entityId), orderBy("at", "desc"), limit(30)),
    `audit-${entityId}`,
  );
  const users = useStaffUsers();
  const nameOf = (uid: string | null) => users.data.find((u) => u.id === uid)?.displayName ?? (uid ? "Usuario" : "Sistema");

  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!data.length) return <EmptyState icon={<History className="h-7 w-7" />} title="Sin cambios registrados" />;

  return (
    <ol className="relative space-y-5 p-5 before:absolute before:bottom-5 before:left-[27px] before:top-5 before:w-px before:bg-slate-200">
      {data.map((log) => (
        <li key={log.id} className="relative flex gap-4">
          <span className="z-10 mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-white bg-brand-500 ring-2 ring-brand-100" />
          <div className="text-sm">
            <p className="text-slate-800">
              <b>{nameOf(log.actorId)}</b> {ACTIONS[log.action]}
              {log.action === "update" && log.changedFields.length > 0 && (
                <> {log.changedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}</>
              )}
            </p>
            <p className="text-xs text-slate-500">{formatDate(log.at, true)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
