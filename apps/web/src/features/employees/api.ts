import { collection, query } from "firebase/firestore";
import { opsCol, type EmployeeProfile } from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";

export const saveEmployeeProfile = callable<{ uid: string; phone: string; specialty: string; color: string }, { ok: boolean }>("saveEmployeeProfile");

/** Perfiles del personal (teléfono, especialidad, color). La llave del documento es el uid. */
export function useEmployeeProfiles() {
  return useQueryData<Partial<EmployeeProfile> & { id: string }>(query(collection(db, opsCol.employees(TENANT_ID))), "employee-profiles");
}
