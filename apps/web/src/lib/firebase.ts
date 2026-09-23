import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { DEFAULT_TENANT_ID } from "@rapifix/shared";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!config.apiKey || !config.projectId) {
  // Mensaje claro si falta apps/web/.env.local
  throw new Error("Falta la configuración de Firebase. Copie .env.example como apps/web/.env.local y complete los valores.");
}

export const app = initializeApp(config);

// App Check (protección contra bots): se activa al poner VITE_RECAPTCHA_SITE_KEY (ver docs/FASE-7.md)
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (recaptchaKey && import.meta.env.VITE_USE_EMULATORS !== "true") {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaKey), isTokenAutoRefreshEnabled: true });
}
export const auth = getAuth(app);
// Caché local: la app sigue mostrando datos si el internet del taller falla un momento
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");

export const TENANT_ID = import.meta.env.VITE_TENANT_ID || DEFAULT_TENANT_ID;

if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

/** Helper tipado para Cloud Functions callable */
export function callable<I, O>(name: string) {
  const fn = httpsCallable<I, O>(functions, name);
  return async (data: I): Promise<O> => (await fn(data)).data;
}
