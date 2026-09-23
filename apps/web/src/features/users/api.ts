import { useMemo } from "react";
import { collection, query, where } from "firebase/firestore";
import type { CreateStaffUserInput, UpdateStaffUserInput, UserProfile } from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";

export const createStaffUser = callable<CreateStaffUserInput, { uid: string }>("createStaffUser");
export const updateStaffUser = callable<UpdateStaffUserInput, { ok: boolean }>("updateStaffUser");
export const seedDemoData = callable<void, { customers: number; vehicles: number }>("seedDemoData");

/** Lista de usuarios del taller (solo admin/gerente pueden leerla según las reglas) */
export function useStaffUsers(enabled = true) {
  // Sin orderBy en la consulta (evita depender de un índice compuesto); se ordena aquí
  const state = useQueryData<UserProfile>(
    enabled ? query(collection(db, "users"), where("tid", "==", TENANT_ID)) : null,
    `users-${TENANT_ID}-${enabled}`,
  );
  const data = useMemo(() => [...state.data].sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "es")), [state.data]);
  return { ...state, data };
}
