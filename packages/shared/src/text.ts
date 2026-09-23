/** Normaliza texto para búsqueda: minúsculas, sin tildes, sin espacios extra. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Placa normalizada: mayúsculas sin espacios ni guiones. "abc-123" -> "ABC123" */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Prefijos de una palabra desde minLen: "toyota" -> ["to","toy","toyo","toyot","toyota"] */
function prefixes(word: string, minLen = 2): string[] {
  const out: string[] = [];
  for (let i = minLen; i <= word.length; i++) out.push(word.slice(0, i));
  return out;
}

/**
 * Construye las palabras clave de búsqueda (campo searchKeywords).
 * Firestore no tiene búsqueda de texto completo; se consulta con array-contains.
 */
export function buildSearchKeywords(values: Array<string | number | null | undefined>, maxTerms = 150): string[] {
  const set = new Set<string>();
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === "") continue;
    const text = normalizeText(String(raw));
    const compact = text.replace(/[^a-z0-9]/g, "");
    for (const word of text.split(/[\s,.\-/]+/)) {
      const clean = word.replace(/[^a-z0-9@]/g, "");
      if (clean.length >= 2) prefixes(clean.slice(0, 20)).forEach((p) => set.add(p));
    }
    if (compact.length >= 2 && compact !== text) prefixes(compact.slice(0, 20)).forEach((p) => set.add(p));
  }
  return Array.from(set).slice(0, maxTerms);
}

/** Término de búsqueda listo para array-contains. */
export function searchToken(query: string): string {
  const t = normalizeText(query).replace(/[^a-z0-9@\s]/g, "");
  const words = t.split(" ").filter((w) => w.length >= 2);
  // Usamos la palabra más larga para mayor precisión
  const longest = words.sort((a, b) => b.length - a.length)[0] ?? "";
  return longest.slice(0, 20);
}
