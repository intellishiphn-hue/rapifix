import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { buildPublicCarwash, carwashCol, PUBLIC_CARWASH, type CarwashPlan } from "@rapifix/shared";
import { db } from "../lib/admin";
import { REGION } from "../lib/params";
import { requireRole } from "../lib/guards";
import { CARWASH_MANAGERS, loadCarwashConfig, loadCarwashServices } from "../lib/carwash";

/**
 * Copia pública del carwash (publicCarwash/{tid}) para la página /lavado: servicios activos,
 * planes activos y regla de lealtad, sin precios ni datos de clientes. Mismo patrón que publicBranding.
 */
export async function rebuildPublicCarwashDoc(tid: string) {
  const [services, plansSnap, { cw }] = await Promise.all([
    loadCarwashServices(tid),
    db.collection(carwashCol.plans(tid)).get(),
    loadCarwashConfig(tid),
  ]);
  const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as CarwashPlan);
  const data = buildPublicCarwash(services, plans, cw);
  await db.doc(`${PUBLIC_CARWASH}/${tid}`).set({ ...data, updatedAt: FieldValue.serverTimestamp() });
  return { services: data.services.length, plans: data.plans.length };
}

export const onCarwashServicePublic = onDocumentWritten({ document: "tenants/{tid}/carwashServices/{id}", region: REGION }, async (e) => {
  await rebuildPublicCarwashDoc(e.params.tid);
});
export const onCarwashPlanPublic = onDocumentWritten({ document: "tenants/{tid}/carwashPlans/{id}", region: REGION }, async (e) => {
  await rebuildPublicCarwashDoc(e.params.tid);
});
export const onCarwashSettingsPublic = onDocumentWritten({ document: "tenants/{tid}/settings/carwash", region: REGION }, async (e) => {
  await rebuildPublicCarwashDoc(e.params.tid);
});

/** Para publicar la primera vez (o forzar) sin tener que editar el menú. Solo admin y gerencia. */
export const rebuildPublicCarwash = onCall({ region: REGION }, async (request) => {
  const caller = requireRole(request, CARWASH_MANAGERS);
  return rebuildPublicCarwashDoc(caller.tid);
});
