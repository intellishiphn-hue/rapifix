import { FirebaseError } from "firebase/app";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo no es válido.",
  "auth/user-disabled": "Este usuario está desactivado. Contacte al administrador.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/too-many-requests": "Demasiados intentos. Espere unos minutos e intente de nuevo.",
  "auth/network-request-failed": "Sin conexión a internet. Revise su red.",
  "permission-denied": "No tiene permiso para realizar esta acción.",
  "unavailable": "El servicio no está disponible. Revise su conexión e intente de nuevo.",
  "not-found": "El registro no existe o fue eliminado.",
  "failed-precondition": "Falta un índice o una condición previa. Si persiste, contacte a soporte.",
  "resource-exhausted": "Se alcanzó un límite temporal. Intente en unos minutos.",
  "unauthenticated": "Su sesión expiró. Inicie sesión de nuevo.",
  "storage/unauthorized": "No tiene permiso para subir este archivo.",
  "storage/canceled": "La subida fue cancelada.",
  "storage/quota-exceeded": "Se superó el espacio de almacenamiento.",
  "storage/retry-limit-exceeded": "La conexión es muy lenta. Intente de nuevo.",
};

/** Convierte cualquier error de Firebase en un mensaje claro en español. */
export function errorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    const code = err.code.replace(/^functions\//, "").replace(/^firestore\//, "");
    // Las Cloud Functions ya envían mensajes en español
    if (err.code.startsWith("functions/") && err.message && !/^(internal|INTERNAL)$/.test(err.message)) {
      return err.message;
    }
    return MESSAGES[err.code] ?? MESSAGES[code] ?? `Ocurrió un error (${err.code}).`;
  }
  if (err instanceof Error) return err.message;
  return "Ocurrió un error inesperado.";
}
