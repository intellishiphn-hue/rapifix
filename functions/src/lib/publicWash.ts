import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  carwashCol, carwashSettingsFrom, isPlaceholderPlate, catalogCol, clampStartStamps, col, membershipWindow, PUBLIC_WASHES,
  type CarwashMembership, type CarwashSettings, type MembershipStatus, type PublicProof, type PublicWash, type WashItem, DEFAULT_SETTINGS } from "@rapifix/shared";
import { db } from "./admin";
import { toMs } from "./carwash";

const DAY = 86400000;

/** Último comprobante enviado por el cliente (para mostrar su estado en el link). */
export function latestProof(docs: FirebaseFirestore.QueryDocumentSnapshot[]): PublicProof | null {
  let best: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (const d of docs) if (!best || toMs(d.get("createdAt")) > toMs(best.get("createdAt"))) best = d;
  if (!best) return null;
  return {
    status: best.get("status"),
    amount: Number(best.get("amount") ?? 0),
    reason: String(best.get("rejectReason") ?? ""),
    at: toMs(best.get("createdAt")),
  };
}

export function workshopInfo(s: FirebaseFirestore.DocumentData) {
  return {
    name: s.name || "RAPIFIX", logoUrl: s.logoUrl || "", phone: s.phone || "", whatsapp: s.whatsapp || s.phone || "",
    address: s.address || "", city: s.city || "", hours: s.hours || "",
  };
}

/** Bancos para el cliente. Si nunca se guardó la lista en Configuración, se usa la lista por defecto. */
export const bankList = (s: FirebaseFirestore.DocumentData): string[] =>
  (Array.isArray(s.bankAccounts) ? s.bankAccounts : [...DEFAULT_SETTINGS.bankAccounts]).filter((b: unknown): b is string => typeof b === "string" && !!b.trim()).slice(0, 20);

/**
 * Construye la copia pública y mínima del lavado en publicWashes/{payToken}.
 * La página /lavado/:token solo lee este documento. Sin teléfono, sin otros clientes, sin comisiones.
 */
export async function buildPublicWash(tid: string, washId: string): Promise<string | null> {
  return db.runTransaction(async (tx) => {
    const w = await tx.get(db.doc(`${carwashCol.washes(tid)}/${washId}`));
    if (!w.exists) return null;
    const token = w.get("payToken") as string | undefined;
    if (!token) return null;
    const plate = String(w.get("plate") ?? "");
    // Sin placa real no hay tarjeta de lealtad que mostrar
    const hasCard = !!plate && !isPlaceholderPlate(plate);
    const membershipId = w.get("membershipId") as string | null;
    const [general, carwash, roki, loyalty, proofs, membership] = await Promise.all([
      tx.get(db.doc(`${col.settings(tid)}/general`)),
      tx.get(db.doc(`${col.settings(tid)}/carwash`)),
      tx.get(db.doc(`${catalogCol.privateConfig(tid)}/roki`)),
      hasCard ? tx.get(db.doc(`${carwashCol.loyalty(tid)}/${plate}`)) : Promise.resolve(null),
      tx.get(db.collection(catalogCol.paymentProofs(tid)).where("washId", "==", washId).limit(30)),
      membershipId ? tx.get(db.doc(`${carwashCol.memberships(tid)}/${membershipId}`)) : Promise.resolve(null),
    ]);
    const s = general.data() ?? {};
    const cw = carwashSettingsFrom(carwash.data() as Partial<CarwashSettings> | undefined);
    const status = w.get("status") as PublicWash["status"];
    const total = Number(w.get("total") ?? 0);
    const paid = !!w.get("paid") || total === 0;
    const now = Date.now();
    const cancelledAt = toMs(w.get("cancelledAt"));
    const deliveredAt = toMs(w.get("deliveredAt"));
    const expired = (status === "cancelled" && !!cancelledAt && now - cancelledAt > 7 * DAY) || (!!deliveredAt && now - deliveredAt > 90 * DAY);

    let m: PublicWash["membership"] = null;
    if (membership?.exists) {
      const view = membershipWindow(
        {
          status: membership.get("status") as MembershipStatus,
          periodStart: toMs(membership.get("periodStart")), periodEnd: toMs(membership.get("periodEnd")),
          paidUntil: toMs(membership.get("paidUntil")), usedInPeriod: Number(membership.get("usedInPeriod") ?? 0),
        },
        now,
      );
      const plan = membership.get("plan") as CarwashMembership["plan"] | undefined;
      m = {
        code: String(membership.get("code") ?? ""), planName: String(membership.get("planName") ?? ""),
        paidUntil: toMs(membership.get("paidUntil")), washesPerMonth: plan?.washesPerMonth ?? null, usedInPeriod: view.usedInPeriod,
      };
    }

    const items = ((w.get("items") as WashItem[]) ?? []).map((i) => ({ name: i.name, kind: i.kind, listPrice: i.listPrice, price: i.price, covered: i.covered ?? null }));
    const pendingWelcome = cw.loyaltyEvery > 0 && (!loyalty?.exists || loyalty.get("welcomePending") === true) ? clampStartStamps(cw.loyaltyStartStamps, cw.loyaltyEvery) : 0;
    const doc: Omit<PublicWash, "updatedAt"> & { updatedAt: FirebaseFirestore.FieldValue } = {
      tid,
      washId,
      code: String(w.get("code") ?? ""),
      plate,
      size: w.get("size"),
      business: workshopInfo(s),
      customerFirstName: String(w.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "",
      items,
      totals: w.get("totals") ?? { subtotal: total, discount: 0, tax: 0, total },
      total,
      discount: Number(w.get("discount") ?? 0),
      taxRate: Number(w.get("taxRate") ?? 0),
      taxMode: w.get("taxMode") ?? cw.taxMode,
      status,
      paid,
      balance: paid || status === "cancelled" ? 0 : total,
      createdAt: (w.get("createdAt") as Timestamp | null) ?? null,
      loyalty: cw.loyaltyEvery > 0 && hasCard
        ? {
            count: Number(loyalty?.get("count") ?? 0),
            every: cw.loyaltyEvery,
            rewardsAvailable: Number(loyalty?.get("rewardsAvailable") ?? 0),
            pendingWelcome,
          }
        : null,
      membership: m,
      onlinePayment: { enabled: !!roki.get("enabled") && !!roki.get("secretKey") },
      banks: bankList(s),
      proof: latestProof(proofs.docs),
      active: !expired,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(db.doc(`${PUBLIC_WASHES}/${token}`), doc);
    return token;
  });
}

/** Rehace las páginas públicas de los lavados recientes de una placa (p. ej. tras ajustar sus sellos). */
export async function rebuildPlatePublicWashes(tid: string, plate: string, max = 5) {
  const snap = await db.collection(carwashCol.washes(tid)).where("plate", "==", plate).limit(100).get();
  const recent = snap.docs
    .filter((d) => d.get("payToken"))
    .sort((a, b) => toMs(b.get("createdAt")) - toMs(a.get("createdAt")))
    .slice(0, max);
  await Promise.all(recent.map((d) => buildPublicWash(tid, d.id).catch(() => null)));
}

/** Lavado de un link público (/lavado/:token). */
export async function loadWashByToken(token: string): Promise<{ tid: string; washId: string }> {
  const snap = await db.doc(`${PUBLIC_WASHES}/${token}`).get();
  if (!snap.exists || snap.get("active") === false) throw new HttpsError("not-found", "Este link no es válido o ya expiró.");
  return { tid: snap.get("tid") as string, washId: snap.get("washId") as string };
}
