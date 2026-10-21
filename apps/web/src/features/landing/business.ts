/**
 * Datos públicos del negocio para la landing. Todos los campos opcionales: la interfaz
 * muestra solo los que tienen valor. Para completar o corregir un dato, edítelo aquí
 * (ver docs/LANDING.md). No ponga aquí datos privados.
 */

export interface DayHours {
  /** Texto visible, ej. "Lunes a viernes" */
  days: string;
  /** Texto visible, ej. "8:00 a.m. a 5:00 p.m."; omitir si está cerrado */
  hours?: string;
  /** Para datos estructurados (schema.org) */
  schemaDays: string[];
  opens?: string;
  closes?: string;
}

export interface SocialLink {
  label: string;
  url: string;
  enabled: boolean;
}

export interface BusinessInfo {
  brand: string;
  /** Nombre con el que aparece en Google */
  googleName?: string;
  tagline?: string;
  /** Teléfono visible, ej. "9285-4852" */
  phoneDisplay?: string;
  /** Teléfono en formato internacional sin signos, ej. "50492854852" */
  phoneIntl?: string;
  /** WhatsApp internacional sin signos */
  whatsappIntl?: string;
  email?: string;
  address?: {
    street: string;
    postalCode?: string;
    city: string;
    region?: string;
    country: string;
    countryCode: string;
  };
  mapsUrl?: string;
  hours?: DayHours[];
  social?: SocialLink[];
  /** URL pública del sitio (canonical, sitemap, datos estructurados) */
  siteUrl?: string;
  /** Logo oficial (el mismo que usan el login y el portal) */
  logoUrl?: string;
  /**
   * Foto real para el hero (ruta en apps/web/public, ej. "/img/hero.webp", o URL).
   * Mientras esté vacío se usa la ilustración original en SVG.
   */
  heroImage?: string;
  heroImageAlt?: string;
  /** Aviso de privacidad (ruta o URL). Vacío: no se muestra enlace. */
  privacyUrl?: string;
}

export const BUSINESS: BusinessInfo = {
  brand: "RAPIFIX Centro Automotriz",
  googleName: "Rapifix Tecnicentro",
  tagline: "Mantenimiento, diagnóstico y reparación automotriz",
  phoneDisplay: "9285-4852",
  phoneIntl: "50492854852",
  whatsappIntl: "50492854852",
  // Correo: pendiente de mostrar (decisión del dueño)
  email: undefined,
  address: {
    street: "Blvd. Comunidad Económica Europea",
    postalCode: "11101",
    city: "Tegucigalpa",
    region: "Francisco Morazán",
    country: "Honduras",
    countryCode: "HN",
  },
  mapsUrl: "https://www.google.com/maps/place/Rapifix+Tecnicentro/data=!4m2!3m1!1s0x0:0x3ad9448fc8372c31",
  hours: [
    { days: "Lunes a viernes", hours: "8:00 a.m. a 5:00 p.m.", schemaDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "17:00" },
    { days: "Sábado", hours: "8:00 a.m. a 3:00 p.m.", schemaDays: ["Saturday"], opens: "08:00", closes: "15:00" },
    { days: "Domingo", schemaDays: ["Sunday"] },
  ],
  social: [
    { label: "Facebook", url: "https://www.facebook.com/rapifixhn", enabled: true },
    { label: "Instagram", url: "https://www.instagram.com/rapifixhn", enabled: true },
    // TikTok: activar cuando se confirme la cuenta
    { label: "TikTok", url: "https://www.tiktok.com/@rapifixhn", enabled: false },
  ],
  // Dominio de Firebase Hosting (firebase.json / .firebaserc). Cambiar al conectar dominio propio.
  siteUrl: "https://rapifix-prod-a1b2c.web.app",
  // Mismo logo que index.html (og:image) y el login. Si no carga, se muestra el engrane del favicon y el nombre.
  logoUrl:
    "https://firebasestorage.googleapis.com/v0/b/rapifix-prod-a1b2c.firebasestorage.app/o/tenants%2Frapifix%2Fbranding%2Flogo.png?alt=media&token=ac922590-e336-4b2b-94ae-876cf424c93a",
  heroImage: undefined,
  heroImageAlt: undefined,
  privacyUrl: undefined,
};

/** Mensajes prellenados de WhatsApp, uno por botón */
export const WA_MESSAGES = {
  general: "Hola RAPIFIX, quisiera información sobre sus servicios.",
  services: "Hola RAPIFIX, quisiera consultar por un servicio para mi vehículo.",
  fleet: "Hola RAPIFIX, quisiera información sobre el mantenimiento de flotillas para mi empresa o institución.",
  contact: "Hola RAPIFIX, quisiera hacer una consulta.",
  tracking: "Hola RAPIFIX, tengo un vehículo con ustedes y quisiera el enlace de seguimiento de mi orden.",
  carwash: "Hola, RAPIFIX. Quiero información sobre el servicio de Carwash.",
  carwashPrices: "Hola, RAPIFIX. Quiero consultar los precios de Carwash.",
  carwashPlans: "Hola, RAPIFIX. Quiero conocer las membresías disponibles de Carwash.",
  carwashLink: "Hola, RAPIFIX. No encuentro el enlace de mi lavado, ¿me lo pueden reenviar?",
} as const;

export function waLink(text?: string): string | null {
  if (!BUSINESS.whatsappIntl) return null;
  const base = `https://wa.me/${BUSINESS.whatsappIntl}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export const waCategory = (name: string) => waLink(`Hola RAPIFIX, quisiera consultar por el servicio de ${name.toLowerCase()} para mi vehículo.`);

export const telLink = () => (BUSINESS.phoneIntl ? `tel:+${BUSINESS.phoneIntl}` : null);

export const activeSocial = () => (BUSINESS.social ?? []).filter((s) => s.enabled && s.url);

export function addressLines(): string[] {
  const a = BUSINESS.address;
  if (!a) return [];
  return [a.street, [a.postalCode, a.city].filter(Boolean).join(" ") + (a.region ? `, ${a.region}` : ""), a.country];
}

/** Datos estructurados schema.org (AutoRepair) a partir de los datos reales anteriores */
export function structuredData(): Record<string, unknown> {
  const a = BUSINESS.address;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: BUSINESS.brand,
    ...(BUSINESS.googleName ? { alternateName: BUSINESS.googleName } : {}),
    ...(BUSINESS.siteUrl ? { url: `${BUSINESS.siteUrl}/` } : {}),
    ...(BUSINESS.logoUrl ? { logo: BUSINESS.logoUrl, image: BUSINESS.logoUrl } : {}),
    ...(BUSINESS.phoneIntl ? { telephone: `+${BUSINESS.phoneIntl}` } : {}),
    ...(a
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: a.street,
            addressLocality: a.city,
            ...(a.region ? { addressRegion: a.region } : {}),
            ...(a.postalCode ? { postalCode: a.postalCode } : {}),
            addressCountry: a.countryCode,
          },
        }
      : {}),
    ...(BUSINESS.mapsUrl ? { hasMap: BUSINESS.mapsUrl } : {}),
  };
  const open = (BUSINESS.hours ?? []).filter((h) => h.opens && h.closes);
  if (open.length) {
    data.openingHoursSpecification = open.map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: h.schemaDays, opens: h.opens, closes: h.closes }));
  }
  const same = activeSocial().map((s) => s.url);
  if (same.length) data.sameAs = same;
  return data;
}
