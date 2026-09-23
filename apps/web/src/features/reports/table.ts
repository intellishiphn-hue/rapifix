import { formatMoney } from "@rapifix/shared";

/** Tipo de columna: define cómo se muestra y cómo se exporta. */
export type ColKind = "text" | "money" | "number" | "hours" | "percent";

export interface ReportColumn {
  label: string;
  kind?: ColKind;
}

export type ReportCell = string | number | null;

/** Tabla de un reporte. Los montos van en CENTAVOS (kind "money"). */
export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** fila de totales opcional */
  total?: ReportCell[];
  empty?: string;
}

export function formatCell(v: ReportCell, kind: ColKind = "text"): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  switch (kind) {
    case "money":
      return formatMoney(v);
    case "hours":
      return `${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 }).format(v)} h`;
    case "percent":
      return `${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(v)} %`;
    case "number":
      return new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 }).format(v);
    default:
      return String(v);
  }
}

/** Nombre de archivo seguro: "RAPIFIX Resumen 2026-09-01 a 2026-09-30.xlsx" */
export function fileBase(title: string, range: string) {
  return `RAPIFIX ${title} ${range}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * Exporta las tablas a un libro de Excel (una hoja con todas las tablas, una debajo de otra).
 * Montos en Lempiras como número con 2 decimales.
 */
export async function exportToExcel(opts: { title: string; periodLabel: string; fileRange: string; tables: ReportTable[]; summary?: Array<[string, ReportCell, ColKind?]> }) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  type Cell = import("write-excel-file/browser").Cell;
  type Row = import("write-excel-file/browser").Row;

  const cell = (v: ReportCell, kind: ColKind = "text", bold = false): Cell => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "string") return { value: v, type: String, ...(bold ? { fontWeight: "bold" as const } : {}) };
    const base = bold ? { fontWeight: "bold" as const } : {};
    switch (kind) {
      case "money":
        return { value: Math.round(v) / 100, type: Number, format: "#,##0.00", ...base };
      case "hours":
      case "number":
        return { value: Math.round(v * 100) / 100, type: Number, format: "#,##0.##", ...base };
      case "percent":
        return { value: Math.round(v * 10) / 1000, type: Number, format: "0.0%", ...base };
      default:
        return { value: v, type: Number, ...base };
    }
  };

  const data: Row[] = [];
  data.push([{ value: `RAPIFIX · ${opts.title}`, type: String, fontWeight: "bold", fontSize: 14 }]);
  data.push([{ value: `Período: ${opts.periodLabel}`, type: String }]);
  data.push([{ value: "Montos en Lempiras (L)", type: String, textColor: "#64748B" }]);
  data.push([]);

  if (opts.summary?.length) {
    data.push([{ value: "Resumen", type: String, fontWeight: "bold", backgroundColor: "#E2E8F0" }, { value: "", type: String, backgroundColor: "#E2E8F0" }]);
    for (const [label, v, kind] of opts.summary) data.push([{ value: label, type: String }, cell(v, kind)]);
    data.push([]);
  }

  let maxCols = 2;
  for (const t of opts.tables) {
    maxCols = Math.max(maxCols, t.columns.length);
    data.push([{ value: t.title, type: String, fontWeight: "bold", fontSize: 12 }]);
    data.push(t.columns.map((c) => ({ value: c.label, type: String, fontWeight: "bold" as const, backgroundColor: "#E2E8F0", align: c.kind && c.kind !== "text" ? ("right" as const) : ("left" as const) })));
    if (!t.rows.length) data.push([{ value: t.empty ?? "Sin datos en este período", type: String, textColor: "#64748B" }]);
    for (const r of t.rows) data.push(r.map((v, i) => cell(v, t.columns[i]?.kind)));
    if (t.total) data.push(t.total.map((v, i) => cell(v, t.columns[i]?.kind, true)));
    data.push([]);
  }

  const columns = Array.from({ length: maxCols }, (_, i) => ({ width: i === 0 ? 34 : 18 }));
  await writeXlsxFile(data, { columns, sheet: opts.title.slice(0, 31) }).toFile(`${fileBase(opts.title, opts.fileRange)}.xlsx`);
}
