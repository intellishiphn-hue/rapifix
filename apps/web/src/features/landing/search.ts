/**
 * Buscador del catálogo público. Puro y sin dependencias: sin acentos ni mayúsculas,
 * con plurales simples y sinónimos mínimos. Busca en nombres de categoría y en cada trabajo.
 */
import { CATALOG, type CategoryId, type ServiceCategory } from "./catalog";

/** minúsculas, sin acentos (NFD) y sin signos */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ/]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "para", "mi", "en", "a", "al", "con", "por", "un", "una", "que", "se", "me"]);

/**
 * Sinónimos: cada palabra buscada se amplía con estas alternativas (basta con que una aparezca).
 * Claves y valores ya normalizados (sin acentos).
 */
const SYNONYMS: Record<string, string[]> = {
  aire: ["aire acondicionado", "climatizacion"],
  ac: ["aire acondicionado", "climatizacion"],
  "a/c": ["aire acondicionado", "climatizacion"],
  clima: ["climatizacion", "aire acondicionado"],
  clutch: ["embrague", "clutch"],
  embrague: ["embrague", "clutch"],
  balinera: ["rodamiento", "balinera"],
  rodamiento: ["rodamiento", "balinera"],
  freno: ["freno", "frenos"],
  llanta: ["neumatico", "rueda"],
  neumatico: ["neumatico", "llanta"],
  mofle: ["silenciador", "escape"],
  caja: ["transmision", "caja"],
  scanner: ["escaner", "computarizado"],
  scan: ["escaner", "computarizado"],
  escaner: ["escaner", "computarizado"],
  computadora: ["computarizado", "escaner"],
  luz: ["luces", "iluminacion", "bombillo"],
  foco: ["bombillo", "iluminacion"],
  caliper: ["caliper", "mordaza"],
  mordaza: ["mordaza", "caliper"],
  chequeo: ["inspeccion", "revision", "diagnostico"],
  temperatura: ["temperatura", "enfriamiento", "refrigeracion"],
  calentamiento: ["temperatura", "enfriamiento"],
  flota: ["flotilla"],
  timon: ["direccion"],
  gas: ["gas refrigerante", "refrigerante"],
};

/** Quita plurales simples: frenos → freno, baterias → bateria, luces → luc */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("es") && !t.endsWith("ies")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/** Grupos de alternativas: todos los grupos deben coincidir (AND); dentro del grupo basta una (OR). */
export function queryTerms(query: string): string[][] {
  const tokens = normalize(query).split(" ").filter((t) => t && !STOPWORDS.has(t));
  return tokens.map((t) => {
    const base = stem(t);
    const alts = new Set<string>([t, base, ...(SYNONYMS[t] ?? []), ...(SYNONYMS[base] ?? [])]);
    return [...alts].map((a) => normalize(a)).filter(Boolean);
  });
}

const matchesAll = (hay: string, groups: string[][]) => groups.every((g) => g.some((a) => hay.includes(a)));

export interface CategoryResult {
  category: ServiceCategory;
  /** La búsqueda coincide con la categoría misma (se muestran todos sus trabajos) */
  categoryMatch: boolean;
  jobs: string[];
}

export function searchCatalog(query: string, only: CategoryId | null = null, catalog: readonly ServiceCategory[] = CATALOG): CategoryResult[] {
  const groups = queryTerms(query);
  const out: CategoryResult[] = [];
  for (const c of catalog) {
    if (only && c.id !== only) continue;
    if (!groups.length) {
      out.push({ category: c, categoryMatch: true, jobs: [...c.jobs] });
      continue;
    }
    // La categoría coincide por su nombre: se muestran todos sus trabajos
    let categoryMatch = matchesAll(normalize(`${c.name} ${c.short}`), groups);
    // Cada trabajo se busca junto con el nombre de su categoría ("aire acondicionado" + "compresores")
    let jobs = categoryMatch ? [...c.jobs] : c.jobs.filter((j) => matchesAll(normalize(`${j} ${c.name}`), groups));
    // Palabras clave extra (ej. "mofle"): solo si ningún trabajo coincidió directamente
    if (!categoryMatch && !jobs.length && matchesAll(normalize(c.keywords.join(" ")), groups)) {
      categoryMatch = true;
      jobs = [...c.jobs];
    }
    if (categoryMatch || jobs.length) out.push({ category: c, categoryMatch, jobs });
  }
  return out;
}

/** Rangos [inicio, fin) del texto original que coinciden con algún término (para resaltar). */
export function highlightRanges(text: string, groups: string[][]): Array<[number, number]> {
  // Texto normalizado carácter a carácter, recordando la posición original
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i]!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
  }
  const ranges: Array<[number, number]> = [];
  for (const term of groups.flat()) {
    if (term.length < 2) continue;
    let from = 0;
    for (;;) {
      const at = norm.indexOf(term, from);
      if (at < 0) break;
      ranges.push([map[at]!, map[at + term.length - 1]! + 1]);
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
