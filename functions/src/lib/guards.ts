import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { isRole, type Role } from "@rapifix/shared";

export interface Caller {
  uid: string;
  tid: string;
  role: Role;
  email?: string;
}

/** Verifica sesión, taller y rol del usuario que llama a una Function. */
export function requireRole(request: CallableRequest<unknown>, roles: readonly Role[]): Caller {
  const token = request.auth?.token;
  if (!request.auth || !token) throw new HttpsError("unauthenticated", "Debe iniciar sesión.");
  const role = token.role;
  const tid = token.tid;
  if (!isRole(role) || typeof tid !== "string") {
    throw new HttpsError("permission-denied", "Su usuario no tiene un rol asignado.");
  }
  if (!roles.includes(role)) {
    throw new HttpsError("permission-denied", "No tiene permiso para realizar esta acción.");
  }
  return { uid: request.auth.uid, tid, role, email: token.email };
}

export function parseInput<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpsError("invalid-argument", result.error.issues.map((i) => i.message).join(". "));
  }
  return result.data;
}
