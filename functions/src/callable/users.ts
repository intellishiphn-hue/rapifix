import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  col,
  createStaffUserSchema,
  updateStaffUserSchema,
  DEFAULT_SETTINGS,
  normalizePhone,
  type Role,
} from "@rapifix/shared";
import { auth, db } from "../lib/admin";
import { BOOTSTRAP_ADMIN_EMAIL, REGION, TENANT_ID } from "../lib/params";
import { parseInput, requireRole } from "../lib/guards";

async function applyRole(uid: string, tid: string, role: Role) {
  await auth.setCustomUserClaims(uid, { tid, role });
}

/**
 * Reclama el PRIMER administrador. Solo funciona una vez y solo para el correo
 * configurado en BOOTSTRAP_ADMIN_EMAIL. Evita tener que descargar llaves privadas.
 */
export const bootstrapAdmin = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debe iniciar sesión.");
  const allowed = BOOTSTRAP_ADMIN_EMAIL.value().trim().toLowerCase();
  const email = (request.auth.token.email ?? "").toLowerCase();
  if (!allowed || email !== allowed) {
    throw new HttpsError("permission-denied", "Este usuario no está autorizado para configurar el sistema.");
  }
  const tid = TENANT_ID.value();
  const bootstrapRef = db.doc(`tenants/${tid}/meta/bootstrap`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bootstrapRef);
    if (snap.exists) throw new HttpsError("already-exists", "El sistema ya fue configurado.");
    tx.set(bootstrapRef, { adminUid: request.auth!.uid, at: FieldValue.serverTimestamp() });
    tx.set(db.doc(`tenants/${tid}`), { name: "RAPIFIX", slug: tid, active: true, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      db.doc(`${col.settings(tid)}/general`),
      { ...DEFAULT_SETTINGS, updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth!.uid },
      { merge: true },
    );
    tx.set(db.doc(`${col.users}/${request.auth!.uid}`), {
      displayName: request.auth!.token.name ?? email.split("@")[0],
      email,
      phone: "",
      tid,
      role: "admin",
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      claimsUpdatedAt: FieldValue.serverTimestamp(),
    });
  });

  await applyRole(request.auth.uid, tid, "admin");
  return { ok: true };
});

/** Crea un usuario del personal con su rol. Solo administradores. */
export const createStaffUser = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const input = parseInput(createStaffUserSchema, request.data);

  let uid: string;
  try {
    const user = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      disabled: false,
    });
    uid = user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") throw new HttpsError("already-exists", "Ya existe un usuario con ese correo.");
    if (code === "auth/invalid-password") throw new HttpsError("invalid-argument", "La contraseña no es válida (mínimo 8 caracteres).");
    throw new HttpsError("internal", "No se pudo crear el usuario.");
  }

  await applyRole(uid, caller.tid, input.role);
  await db.doc(`${col.users}/${uid}`).set({
    displayName: input.displayName,
    email: input.email,
    phone: input.phone ? normalizePhone(input.phone) : "",
    tid: caller.tid,
    role: input.role,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: caller.uid,
    claimsUpdatedAt: FieldValue.serverTimestamp(),
  });
  return { uid };
});

/** Cambia rol, nombre o estado (activo/inactivo) de un usuario. Solo administradores. */
export const updateStaffUser = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, ["admin"]);
  const input = parseInput(updateStaffUserSchema, request.data);

  const ref = db.doc(`${col.users}/${input.uid}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get("tid") !== caller.tid) throw new HttpsError("not-found", "Usuario no encontrado.");

  if (input.uid === caller.uid && (input.active === false || (input.role && input.role !== "admin"))) {
    throw new HttpsError("failed-precondition", "No puede quitarse a sí mismo el rol de administrador ni desactivarse.");
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid };

  if (input.displayName) {
    update.displayName = input.displayName;
    await auth.updateUser(input.uid, { displayName: input.displayName });
  }
  if (input.role) {
    update.role = input.role;
    update.claimsUpdatedAt = FieldValue.serverTimestamp();
    await applyRole(input.uid, caller.tid, input.role);
  }
  if (input.active !== undefined) {
    update.active = input.active;
    await auth.updateUser(input.uid, { disabled: !input.active });
    if (!input.active) await auth.revokeRefreshTokens(input.uid);
  }

  await ref.update(update);
  return { ok: true };
});
