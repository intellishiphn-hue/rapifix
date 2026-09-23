import { defineString } from "firebase-functions/params";

/** Correo autorizado para reclamar el primer administrador (functions/.env.<proyecto>) */
export const BOOTSTRAP_ADMIN_EMAIL = defineString("BOOTSTRAP_ADMIN_EMAIL", { default: "" });
export const TENANT_ID = defineString("TENANT_ID", { default: "rapifix" });

export const REGION = "us-central1";
