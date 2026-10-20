/**
 * Catálogo oficial de servicios de RAPIFIX (fuente: Catalogo_RapiFix.pdf, 4 páginas).
 *
 * Única fuente de verdad del catálogo público: la landing (tarjetas, buscador, detalle)
 * y la prueba de conteo leen de aquí. Para agregar o corregir un trabajo, edítelo solo
 * en este archivo y actualice el conteo esperado en
 * packages/shared/src/__tests__/landingCatalog.test.ts.
 *
 * Archivo puro (sin React, sin Firebase): contenido público y estático.
 */

export type CategoryId =
  | "mantenimiento"
  | "frenos"
  | "suspension"
  | "direccion"
  | "transmision"
  | "enfriamiento"
  | "electrico"
  | "combustible"
  | "escape"
  | "rodamientos"
  | "diagnostico"
  | "flotillas"
  | "aire";

export interface ServiceCategory {
  id: CategoryId;
  /** Número de la categoría en el catálogo oficial (1 a 13) */
  order: number;
  /** Nombre oficial de la categoría */
  name: string;
  /** Nombre corto para tarjetas pequeñas y filtros */
  short: string;
  /** Descripción breve (editorial, no agrega servicios) */
  blurb: string;
  /** Texto introductorio del catálogo, cuando existe */
  intro?: string;
  /** Palabras extra para el buscador (no se muestran) */
  keywords: string[];
  /** Destacada en la composición visual (decisión de diseño, no de ventas) */
  featured?: boolean;
  /** Trabajos, tal cual el catálogo oficial */
  jobs: string[];
}

export const CATALOG: readonly ServiceCategory[] = [
  {
    id: "mantenimiento",
    order: 1,
    name: "Mantenimiento preventivo general",
    short: "Mantenimiento preventivo",
    blurb: "Aceite, filtros, fluidos e inspección por kilometraje para que tu vehículo rinda como debe.",
    keywords: ["servicio", "afinado", "kilometraje", "lubricacion"],
    featured: true,
    jobs: [
      "Cambio de aceite de motor y filtro de aceite.",
      "Cambio de filtros de aire, combustible y cabina.",
      "Revisión y sustitución de lubricantes de transmisión y diferenciales.",
      "Cambio y revisión de líquido refrigerante.",
      "Cambio y revisión de líquido de frenos.",
      "Revisión y sustitución de líquido de dirección hidráulica.",
      "Engrase y lubricación de componentes mecánicos.",
      "Inspección de bandas, poleas, mangueras y conexiones, y reemplazo.",
      "Revisión de niveles de fluidos y detección de fugas.",
      "Mantenimiento preventivo por kilometraje y recomendaciones del fabricante.",
      "Inspección general de seguridad y funcionamiento del vehículo.",
    ],
  },
  {
    id: "frenos",
    order: 2,
    name: "Sistema de frenos",
    short: "Frenos",
    blurb: "Pastillas, discos, mordazas, bombas y diagnóstico ABS con escáner.",
    keywords: ["freno", "abs", "pastillas", "discos", "caliper"],
    featured: true,
    jobs: [
      "Cambio de pastillas y zapatas de freno.",
      "Cambio de discos y tambores de freno.",
      "Rectificación de discos de freno.",
      "Revisión y mantenimiento de mordazas (cálipers).",
      "Cambio de bombas de freno.",
      "Revisión y sustitución de mangueras y tuberías de freno.",
      "Limpieza, lubricación y ajuste del sistema de frenos.",
      "Revisión y mantenimiento del freno de estacionamiento.",
      "Diagnóstico de fallas del sistema de frenos ABS mediante escáner, según compatibilidad del vehículo.",
      "Cambio de cable de emergencia.",
    ],
  },
  {
    id: "suspension",
    order: 3,
    name: "Sistema de suspensión",
    short: "Suspensión",
    blurb: "Amortiguadores, rótulas, bujes y brazos para una marcha firme.",
    keywords: ["amortiguador", "rotula", "buje", "tijera"],
    jobs: [
      "Cambio de amortiguadores delanteros y traseros.",
      "Cambio de espirales y resortes.",
      "Cambio de rótulas superiores e inferiores.",
      "Cambio de bujes de suspensión.",
      "Cambio de brazos y bandejas de suspensión.",
      "Cambio de bieletas y barras estabilizadoras.",
      "Cambio de soportes y bases de amortiguadores.",
      "Revisión y reparación de componentes de suspensión.",
      "Diagnóstico de ruidos, vibraciones y desgaste de componentes.",
      "Cambio de tijeras.",
    ],
  },
  {
    id: "direccion",
    order: 4,
    name: "Sistema de dirección",
    short: "Dirección",
    blurb: "Terminales, barras axiales, cremallera y dirección hidráulica.",
    keywords: ["timon", "cremallera", "terminales", "hidraulica"],
    jobs: [
      "Cambio de terminales de dirección.",
      "Cambio de barras axiales.",
      "Cambio de componentes de dirección hidráulica.",
      "Revisión y reparación de fugas en el sistema de dirección.",
      "Cambio de mangueras y conexiones hidráulicas.",
      "Revisión de bombas de dirección.",
      "Inspección de cremalleras y cajas de dirección.",
      "Diagnóstico de holguras, ruidos y vibraciones del sistema.",
    ],
  },
  {
    id: "transmision",
    order: 5,
    name: "Sistema de transmisión y tren motriz",
    short: "Transmisión",
    blurb: "Aceites de caja y diferencial, semiejes, cardán y embrague.",
    keywords: ["caja", "embrague", "clutch", "cardan", "diferencial"],
    jobs: [
      "Cambio de aceite de transmisión manual y automática.",
      "Cambio de aceite de diferenciales y cajas de transferencia.",
      "Cambio de guardapolvos de transmisión.",
      "Cambio de flechas y semiejes.",
      "Cambio de crucetas y componentes de cardán.",
      "Revisión y sustitución de soportes de transmisión.",
      "Diagnóstico de ruidos y vibraciones del tren motriz.",
      "Cambio de kit de embrague (clutch), collarín y componentes relacionados.",
      "Revisión y sustitución de bombas de embrague.",
    ],
  },
  {
    id: "enfriamiento",
    order: 6,
    name: "Sistema de enfriamiento",
    short: "Enfriamiento",
    blurb: "Radiador, termostato, bomba de agua y control de temperatura.",
    keywords: ["radiador", "temperatura", "calentamiento", "refrigerante"],
    jobs: [
      "Cambio de radiadores.",
      "Cambio de termostatos.",
      "Cambio de bombas de agua.",
      "Cambio de mangueras y abrazaderas.",
      "Limpieza y mantenimiento del sistema de refrigeración.",
      "Cambio de depósitos de refrigerante.",
      "Revisión y cambio de ventilador.",
      "Diagnóstico de fugas y problemas de temperatura.",
      "Sustitución de sensores y componentes externos del sistema de enfriamiento.",
    ],
  },
  {
    id: "electrico",
    order: 7,
    name: "Sistema eléctrico y electrónico",
    short: "Eléctrico y electrónico",
    blurb: "Escáner, baterías, alternador, arranque, luces y sensores.",
    keywords: ["electricidad", "bateria", "alternador", "luces", "escaner", "sensor"],
    jobs: [
      "Diagnóstico computarizado mediante escáner automotriz.",
      "Lectura e interpretación de códigos de falla.",
      "Revisión de baterías y sistemas de carga.",
      "Cambio de baterías.",
      "Revisión y sustitución de alternadores.",
      "Revisión y sustitución de motores de arranque.",
      "Revisión de fusibles, relés y conexiones eléctricas.",
      "Cambio de bombillos y componentes de iluminación.",
      "Revisión de luces delanteras, traseras, direccionales y de freno.",
      "Diagnóstico de fallas en sensores y componentes electrónicos.",
      "Revisión del sistema de limpiaparabrisas.",
    ],
  },
  {
    id: "combustible",
    order: 8,
    name: "Sistema de combustible y admisión",
    short: "Combustible y admisión",
    blurb: "Filtros, cuerpo de aceleración y alimentación de combustible.",
    keywords: ["gasolina", "diesel", "inyeccion", "aceleracion"],
    jobs: [
      "Cambio de filtros de combustible.",
      "Limpieza de cuerpo de aceleración.",
      "Limpieza de componentes de admisión.",
      "Revisión de bombas de combustible.",
      "Revisión de mangueras y conexiones de combustible.",
      "Diagnóstico de fallas de alimentación de combustible.",
      "Aplicación de tratamientos y aditivos de mantenimiento, según especificaciones del fabricante.",
    ],
  },
  {
    id: "escape",
    order: 9,
    name: "Sistema de escape",
    short: "Escape",
    blurb: "Tuberías, silenciadores, empaques y sensores de oxígeno.",
    keywords: ["mofle", "silenciador", "tubo de escape"],
    jobs: [
      "Revisión de tuberías y componentes del sistema de escape.",
      "Diagnóstico de fugas y ruidos.",
      "Cambio de empaques y soportes del sistema.",
      "Revisión de silenciadores y conexiones.",
      "Sustitución de componentes deteriorados, según disponibilidad y capacidad técnica.",
      "Cambio de sensores de oxígeno.",
    ],
  },
  {
    id: "rodamientos",
    order: 10,
    name: "Rodamientos, ruedas y componentes relacionados",
    short: "Rodamientos y ruedas",
    blurb: "Balineras, espárragos, holguras y desgaste de neumáticos.",
    keywords: ["balinera", "rueda", "llanta", "neumatico"],
    jobs: [
      "Cambio de rodamientos (balineras) de rueda.",
      "Cambio de espárragos y tuercas.",
      "Revisión de holguras y ruidos en ruedas.",
      "Inspección visual del desgaste de neumáticos.",
    ],
  },
  {
    id: "diagnostico",
    order: 11,
    name: "Inspección y diagnóstico automotriz",
    short: "Diagnóstico",
    blurb: "Inspecciones antes de viajar, diagnóstico computarizado, informes técnicos y cotizaciones.",
    keywords: ["revision", "chequeo", "escaner", "informe", "viaje"],
    featured: true,
    jobs: [
      "Diagnóstico general de fallas mecánicas.",
      "Inspección de vehículos antes de viajes.",
      "Inspección de vehículos por kilometraje.",
      "Evaluación del estado del sistema de frenos.",
      "Evaluación de suspensión y dirección.",
      "Revisión de fugas de aceite y otros fluidos.",
      "Diagnóstico computarizado de sistemas compatibles.",
      "Revisión de componentes de seguridad.",
      "Elaboración de informes técnicos sobre el estado del vehículo.",
      "Elaboración de cotizaciones de reparaciones preventivas y correctivas.",
    ],
  },
  {
    id: "flotillas",
    order: 12,
    name: "Mantenimiento de flotillas institucionales",
    short: "Flotillas",
    blurb: "Mantenimiento programado, historial por vehículo e informes para instituciones públicas y privadas.",
    intro: "RAPIFIX ofrece servicios de mantenimiento para flotillas de vehículos pertenecientes a instituciones públicas y privadas.",
    keywords: ["flota", "empresa", "institucion", "corporativo"],
    featured: true,
    jobs: [
      "Programación de mantenimientos preventivos según kilometraje.",
      "Atención de reparaciones correctivas.",
      "Control del historial de mantenimiento por vehículo.",
      "Registro de trabajos realizados y repuestos sustituidos.",
      "Seguimiento de servicios y reparaciones.",
      "Emisión de diagnósticos, cotizaciones e informes técnicos.",
      "Recomendaciones de mantenimiento para reducir averías y tiempos fuera de servicio.",
    ],
  },
  {
    id: "aire",
    order: 13,
    name: "Aire acondicionado y climatización automotriz",
    short: "Aire acondicionado",
    blurb: "Diagnóstico, fugas, recarga de gas, compresor y todo el sistema de climatización.",
    keywords: ["ac", "clima", "climatizacion", "gas", "compresor"],
    featured: true,
    jobs: [
      "Diagnóstico general del sistema de aire acondicionado automotriz.",
      "Revisión del funcionamiento y rendimiento del sistema de climatización.",
      "Detección y diagnóstico de fugas de refrigerante.",
      "Recarga de gas refrigerante, según las especificaciones del fabricante.",
      "Revisión y sustitución de compresores de aire acondicionado.",
      "Cambio de condensadores y evaporadores.",
      "Cambio de válvulas de expansión.",
      "Cambio de filtros deshidratadores.",
      "Revisión y sustitución de mangueras y tuberías del sistema.",
      "Revisión y reparación de conexiones eléctricas del aire acondicionado.",
      "Revisión y sustitución de ventiladores y motores sopladores.",
      "Cambio de filtros de aire de cabina.",
      "Limpieza y mantenimiento de componentes del sistema de climatización.",
      "Diagnóstico de fallas en controles, sensores y componentes eléctricos.",
      "Revisión y reparación de problemas de enfriamiento insuficiente.",
      "Mantenimiento preventivo y correctivo del sistema de aire acondicionado.",
    ],
  },
];

export const TOTAL_JOBS = CATALOG.reduce((n, c) => n + c.jobs.length, 0);

export function categoryById(id: CategoryId): ServiceCategory {
  const c = CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`Categoría desconocida: ${id}`);
  return c;
}

/** "11 trabajos" / "1 trabajo" */
export const jobsLabel = (n: number) => `${n} ${n === 1 ? "trabajo" : "trabajos"}`;
