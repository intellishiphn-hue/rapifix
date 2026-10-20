import { describe, expect, it } from "vitest";
// Catálogo público de la landing (archivo puro en apps/web, sin React ni Firebase)
import { CATALOG, TOTAL_JOBS } from "../../../../apps/web/src/features/landing/catalog";
import { highlightRanges, normalize, queryTerms, searchCatalog } from "../../../../apps/web/src/features/landing/search";

/** Conteo oficial por categoría según Catalogo_RapiFix.pdf (en orden 1 a 13) */
const EXPECTED: Array<[string, number]> = [
  ["Mantenimiento preventivo general", 11],
  ["Sistema de frenos", 10],
  ["Sistema de suspensión", 10],
  ["Sistema de dirección", 8],
  ["Sistema de transmisión y tren motriz", 9],
  ["Sistema de enfriamiento", 9],
  ["Sistema eléctrico y electrónico", 11],
  ["Sistema de combustible y admisión", 7],
  ["Sistema de escape", 6],
  ["Rodamientos, ruedas y componentes relacionados", 4],
  ["Inspección y diagnóstico automotriz", 10],
  ["Mantenimiento de flotillas institucionales", 7],
  ["Aire acondicionado y climatización automotriz", 16],
];

describe("catálogo de la landing", () => {
  it("tiene las 13 categorías en el orden oficial", () => {
    expect(CATALOG).toHaveLength(13);
    expect(CATALOG.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(CATALOG.map((c) => c.name)).toEqual(EXPECTED.map(([n]) => n));
  });

  it("cada categoría tiene el número exacto de trabajos", () => {
    expect(CATALOG.map((c) => c.jobs.length)).toEqual(EXPECTED.map(([, n]) => n));
    expect(TOTAL_JOBS).toBe(118);
  });

  it("no hay trabajos repetidos ni vacíos dentro de una categoría", () => {
    for (const c of CATALOG) {
      expect(new Set(c.jobs).size).toBe(c.jobs.length);
      for (const j of c.jobs) expect(j.trim().length).toBeGreaterThan(5);
    }
  });

  it("ids únicos", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(13);
  });
});

const jobsOf = (q: string) => searchCatalog(q).flatMap((r) => r.jobs);
const catsOf = (q: string) => searchCatalog(q).map((r) => r.category.id);

describe("buscador de la landing", () => {
  it("normaliza acentos y mayúsculas", () => {
    expect(normalize("BATERÍA Eléctrico")).toBe("bateria electrico");
  });

  it("aceite encuentra los trabajos con aceite", () => {
    const jobs = jobsOf("aceite");
    expect(jobs).toContain("Cambio de aceite de motor y filtro de aceite.");
    expect(jobs).toContain("Cambio de aceite de transmisión manual y automática.");
    expect(jobs.every((j) => /aceite/i.test(j))).toBe(true);
  });

  it("batería y bateria encuentran lo mismo", () => {
    expect(jobsOf("batería")).toEqual(jobsOf("bateria"));
    expect(jobsOf("baterias")).toContain("Cambio de baterías.");
  });

  it("frenos muestra la categoría completa", () => {
    const r = searchCatalog("frenos").find((x) => x.category.id === "frenos");
    expect(r?.categoryMatch).toBe(true);
    expect(r?.jobs).toHaveLength(10);
    expect(jobsOf("freno")).toEqual(jobsOf("frenos"));
  });

  it("aire acondicionado encuentra la categoría 13", () => {
    expect(catsOf("aire acondicionado")).toEqual(["aire"]);
    expect(jobsOf("aire acondicionado")).toHaveLength(16);
  });

  it("clutch encuentra embrague", () => {
    const jobs = jobsOf("clutch");
    expect(jobs).toContain("Revisión y sustitución de bombas de embrague.");
    expect(jobsOf("embrague")).toEqual(jobs);
  });

  it("balinera encuentra rodamientos", () => {
    expect(jobsOf("balineras")).toContain("Cambio de rodamientos (balineras) de rueda.");
    expect(jobsOf("rodamiento")).toContain("Cambio de rodamientos (balineras) de rueda.");
  });

  it("filtro por categoría y búsqueda vacía", () => {
    expect(searchCatalog("", null)).toHaveLength(13);
    expect(searchCatalog("", "escape")[0]?.jobs).toHaveLength(6);
    expect(searchCatalog("aceite", "frenos")).toHaveLength(0);
  });

  it("palabras clave solo amplían cuando ningún trabajo coincide", () => {
    expect(catsOf("mofle")).toEqual(["escape"]);
    expect(jobsOf("bateria")).toHaveLength(2);
  });

  it("sin resultados", () => {
    expect(searchCatalog("xyzxyz")).toHaveLength(0);
  });

  it("resalta respetando acentos del texto original", () => {
    const text = "Cambio de baterías.";
    const [r] = highlightRanges(text, queryTerms("bateria"));
    expect(r && text.slice(r[0], r[1])).toBe("batería");
  });
});
