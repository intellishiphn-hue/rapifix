import { collection, orderBy, query, where } from "firebase/firestore";
import type { CreateStaffUserInput, UpdateStaffUserInput, UserProfile } from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";

export const createStaffUser = callable<CreateStaffUserInput, { uid: string }>("createStaffUser");
export const updateStaffUser = callable<UpdateStaffUserInput, { ok: boolean }>("updateStaffUser");
export const seedDemoData = callable<void, { customers: number; vehicles: number }>("seedDemoData");

/** Lista de usuarios del taller (solo admin/gerente pueden leerla según las reglas) */
export function useStaffUsers(enabled = true) {
  return useQueryData<UserProfile>(
    enabled ? query(collection(db, "users"), where("tid", "==", TENANT_ID), orderBy("displayName")) : null,
    `users-${TENANT_ID}-${enabled}`,
  );
}
