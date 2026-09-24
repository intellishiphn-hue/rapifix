import { useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import {
  catalogCol, formatMoney, importProductRowSchema, normalizeText, PRODUCT_UNITS,
  type ImportProductRow, type Product, type ProductCost,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

const importProducts = callable<{ rows: ImportProductRow[]; updateStock: boolean }, { created: number; updated: number; adjusted: number; errors: Array<{ row: number; message: string }> }>("importProducts");

/** Columnas de la plantilla (en este orden). * = obligatoria */
const COLUMNS = [
  { key: "sku", title: "Código", width: 14, help: "Opcional. Si lo pone, sirve para actualizar el producto después." },
  { key: "name", title: "Nombre *", width: 36, help: "Obligatorio." },
  { key: "category", title: "Categoría", width: 16, help: "Ej. Aceites, Frenos, Filtros." },
  { key: "brand", title: "Marca", width: 14, help: "" },
  { key: "supplier", title: "Proveedor", width: 18, help: "" },
  { key: "unit", title: "Unidad", width: 10, help: `Una de: ${PRODUCT_UNITS.join(", ")}. Si se deja vacío: unidad.` },
  { key: "price", title: "Precio de venta *", width: 16, help: "En Lempiras, ej. 450 o 1250.50." },
  { key: "cost", title: "Costo", width: 12, help: "Opcional, en Lempiras. Solo lo ve administración y bodega." },
  { key: "stock", title: "Existencia", width: 12, help: "Cantidad que hay hoy en bodega." },
  { key: "minStock", title: "Existencia mínima", width: 16, help: "Para la alerta de 'bajo mínimo'." },
  { key: "location", title: "Ubicación", width: 14, help: "Ej. Estante A-3." },
  { key: "taxable", title: "Lleva ISV", width: 10, help: "Sí o No. Si se deja vacío: Sí." },
  { key: "active", title: "Activo", width: 10, help: "Sí o No. Si se deja vacío: Sí." },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

const ALIASES: Record<ColKey, string[]> = {
  sku: ["codigo", "sku", "cod", "codigo de producto", "numero de parte", "no de parte"],
  name: ["nombre", "producto", "descripcion", "nombre del producto"],
  category: ["categoria", "tipo"],
  brand: ["marca"],
  supplier: ["proveedor"],
  unit: ["unidad", "unidad de medida", "medida"],
  price: ["precio de venta", "precio", "precio venta", "pvp"],
  cost: ["costo", "costo unitario", "precio de compra"],
  stock: ["existencia", "stock", "cantidad", "existencias", "inventario"],
  minStock: ["existencia minima", "minimo", "stock minimo", "min"],
  location: ["ubicacion", "estante", "lugar"],
  taxable: ["lleva isv", "isv", "impuesto", "gravado"],
  active: ["activo", "estado"],
};

const clean = (v: unknown) => normalizeText(String(v ?? "").replace(/\*/g, "")).trim();

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/[Ll]\.?|lps|HNL|\s/gi, "").replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function toBool(v: unknown, fallback = true): boolean {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "boolean") return v;
  const s = clean(v);
  if (["si", "s", "yes", "y", "1", "x", "verdadero", "true", "activo"].includes(s)) return true;
  if (["no", "n", "0", "falso", "false", "inactivo"].includes(s)) return false;
  return fallback;
}

interface Parsed {
  row: number;
  data: ImportProductRow | null;
  error: string | null;
  action: "create" | "update" | null;
}

async function loadExisting() {
  const snap = await getDocs(collection(db, catalogCol.products(TENANT_ID)));
  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product);
  let costs = new Map<string, number>();
  try {
    const cs = await getDocs(collection(db, catalogCol.productCosts(TENANT_ID)));
    costs = new Map(cs.docs.map((d) => [d.id, (d.data() as ProductCost).avgCost || (d.data() as ProductCost).cost || 0]));
  } catch {
    /* sin permiso para ver costos */
  }
  return { products, costs };
}

export function ImportProductsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Parsed[] | null>(null);
  const [updateStock, setUpdateStock] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const summary = useMemo(() => {
    const list = rows ?? [];
    return {
      create: list.filter((r) => r.action === "create").length,
      update: list.filter((r) => r.action === "update").length,
      errors: list.filter((r) => r.error).length,
    };
  }, [rows]);

  const reset = () => {
    setRows(null);
    setFileName("");
    setProgress(0);
    if (input.current) input.current.value = "";
  };

  const downloadTemplate = async (withProducts: boolean) => {
    setBusy(withProducts ? "export" : "template");
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const header = COLUMNS.map((c) => ({ value: c.title, fontWeight: "bold" as const, backgroundColor: "#DBEAFE" }));
      let data: Array<Array<{ value: string | number; type?: StringConstructor | NumberConstructor } | null>> = [];
      if (withProducts) {
        const { products, costs } = await loadExisting();
        data = products.sort((a, b) => a.name.localeCompare(b.name, "es")).map((p) => [
          p.sku ? { value: p.sku, type: String } : null,
          { value: p.name, type: String },
          p.category ? { value: p.category, type: String } : null,
          p.brand ? { value: p.brand, type: String } : null,
          p.supplier ? { value: p.supplier, type: String } : null,
          { value: p.unit || "unidad", type: String },
          { value: p.price / 100, type: Number },
          costs.has(p.id) ? { value: (costs.get(p.id) ?? 0) / 100, type: Number } : null,
          { value: p.stock ?? 0, type: Number },
          { value: p.minStock ?? 0, type: Number },
          p.location ? { value: p.location, type: String } : null,
          { value: p.taxable ? "Sí" : "No", type: String },
          { value: p.active ? "Sí" : "No", type: String },
        ]);
      } else {
        data = [
          [{ value: "ACE-5W30", type: String }, { value: "Aceite sintético 5W-30 (litro)", type: String }, { value: "Aceites", type: String }, { value: "Mobil", type: String }, { value: "Distribuidora XYZ", type: String }, { value: "litro", type: String }, { value: 280, type: Number }, { value: 190, type: Number }, { value: 24, type: Number }, { value: 6, type: Number }, { value: "Estante A-1", type: String }, { value: "Sí", type: String }, { value: "Sí", type: String }],
          [null, { value: "Filtro de aceite Toyota Hilux", type: String }, { value: "Filtros", type: String }, { value: "Toyota", type: String }, null, { value: "unidad", type: String }, { value: 350, type: Number }, null, { value: 10, type: Number }, { value: 3, type: Number }, null, null, null],
        ];
      }
      const help = [
        [{ value: "Cómo llenar la plantilla de productos", fontWeight: "bold" as const }],
        [{ value: "Llene la hoja 'Productos'. Una fila por producto. No cambie los títulos de la primera fila." }],
        [{ value: "Si el producto ya existe (mismo código, o mismo nombre si no tiene código), se actualiza. Si no existe, se crea." }],
        [{ value: "Puede borrar las filas de ejemplo." }],
        [null],
        ...COLUMNS.map((c) => [{ value: c.title, fontWeight: "bold" as const }, { value: c.help }]),
      ];
      await writeXlsxFile([
        { data: [header, ...data], sheet: "Productos", columns: COLUMNS.map((c) => ({ width: c.width })), stickyRowsCount: 1 },
        { data: help, sheet: "Instrucciones", columns: [{ width: 22 }, { width: 80 }] },
      ] as never).toFile(withProducts ? "RAPIFIX-productos.xlsx" : "RAPIFIX-plantilla-productos.xlsx");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Use un archivo de Excel .xlsx (en Excel: Archivo → Guardar como → Libro de Excel).");
      return;
    }
    setBusy("read");
    setFileName(file.name);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const [sheet, existing] = await Promise.all([readSheet(file), loadExisting()]);
      const headerIdx = sheet.findIndex((r) => r.some((c) => ALIASES.name.includes(clean(c))));
      if (headerIdx < 0) throw new Error("No se encontró la fila de títulos (debe tener al menos la columna 'Nombre').");
      const headers = sheet[headerIdx]!.map(clean);
      const colOf = (k: ColKey) => headers.findIndex((h) => ALIASES[k].includes(h));
      const idx = Object.fromEntries(COLUMNS.map((c) => [c.key, colOf(c.key)])) as Record<ColKey, number>;
      if (idx.price < 0) throw new Error("Falta la columna 'Precio de venta'.");

      const bySku = new Map(existing.products.filter((p) => p.sku).map((p) => [p.sku.toUpperCase(), p]));
      const byName = new Map(existing.products.map((p) => [normalizeText(p.name), p]));
      const parsed: Parsed[] = [];
      sheet.slice(headerIdx + 1).forEach((r, i) => {
        const get = (k: ColKey) => (idx[k] >= 0 ? r[idx[k]] : null);
        const str = (k: ColKey) => String(get(k) ?? "").trim();
        if (!str("name") && !str("sku") && get("price") == null) return; // fila vacía
        const rowNum = headerIdx + i + 2;
        const price = toNumber(get("price"));
        const cost = toNumber(get("cost"));
        const stock = toNumber(get("stock"));
        const minStock = toNumber(get("minStock"));
        const bad = [
          price === null ? "falta el precio" : Number.isNaN(price) || price < 0 ? "precio no válido" : "",
          Number.isNaN(cost) || (cost ?? 0) < 0 ? "costo no válido" : "",
          Number.isNaN(stock) || (stock ?? 0) < 0 ? "existencia no válida" : "",
          Number.isNaN(minStock) || (minStock ?? 0) < 0 ? "existencia mínima no válida" : "",
        ].filter(Boolean);
        const unitRaw = clean(get("unit"));
        const unit = (PRODUCT_UNITS as readonly string[]).find((u) => normalizeText(u) === unitRaw) ?? "unidad";
        const candidate = {
          row: rowNum,
          sku: str("sku").toUpperCase().slice(0, 40),
          name: str("name"),
          category: str("category"),
          brand: str("brand"),
          supplier: str("supplier"),
          unit,
          price: Math.round((price ?? 0) * 100),
          cost: cost === null || Number.isNaN(cost) ? null : Math.round(cost * 100),
          stock: stock === null || Number.isNaN(stock) ? null : stock,
          minStock: minStock === null || Number.isNaN(minStock) ? 0 : minStock,
          location: str("location"),
          taxable: toBool(get("taxable")),
          active: toBool(get("active")),
        };
        const check = importProductRowSchema.safeParse(candidate);
        const error = bad.length ? bad.join(", ") : check.success ? null : check.error.issues.map((x) => x.message).join(", ");
        const match = (candidate.sku && bySku.get(candidate.sku)) || byName.get(normalizeText(candidate.name));
        parsed.push({ row: rowNum, data: error ? null : check.data!, error, action: error ? null : match ? "update" : "create" });
      });
      if (!parsed.length) throw new Error("El archivo no tiene productos debajo de los títulos.");
      setRows(parsed);
    } catch (err) {
      toast.error(errorMessage(err));
      reset();
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    const valid = (rows ?? []).filter((r) => r.data).map((r) => r.data!);
    if (!valid.length) return;
    setBusy("import");
    setProgress(0);
    const total = { created: 0, updated: 0, adjusted: 0, errors: [] as Array<{ row: number; message: string }> };
    try {
      for (let i = 0; i < valid.length; i += 200) {
        const r = await importProducts({ rows: valid.slice(i, i + 200), updateStock });
        total.created += r.created;
        total.updated += r.updated;
        total.adjusted += r.adjusted;
        total.errors.push(...r.errors);
        setProgress(Math.min(100, Math.round(((i + 200) / valid.length) * 100)));
      }
      toast.success(`Listo: ${total.created} productos nuevos, ${total.updated} actualizados${total.adjusted ? `, ${total.adjusted} existencias ajustadas` : ""}.`);
      if (total.errors.length) toast.warning(`${total.errors.length} fila(s) no se importaron: ${total.errors.slice(0, 3).map((e) => `fila ${e.row} (${e.message})`).join("; ")}`);
      reset();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      size="lg"
      title="Subir productos desde Excel"
      description="Descargue la plantilla, llénela y súbala. Antes de guardar le mostramos qué se va a crear y qué se va a actualizar."
      footer={rows ? (
        <>
          <Button variant="ghost" onClick={reset} disabled={!!busy}>Elegir otro archivo</Button>
          <Button icon={<Upload className="h-4 w-4" />} loading={busy === "import"} disabled={!summary.create && !summary.update} onClick={() => void run()}>
            {busy === "import" ? `Importando ${progress}%` : `Importar ${summary.create + summary.update} producto(s)`}
          </Button>
        </>
      ) : undefined}
    >
      {!rows ? (
        <div className="space-y-4">
          <ol className="space-y-2 text-sm text-slate-700">
            <li><b>1.</b> Descargue la plantilla (trae 2 ejemplos y una hoja de instrucciones).</li>
            <li><b>2.</b> Llene una fila por producto. Solo <b>Nombre</b> y <b>Precio de venta</b> son obligatorios.</li>
            <li><b>3.</b> Súbala aquí. Si un producto ya existe (mismo código o mismo nombre), se actualiza en vez de duplicarse.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === "template"} onClick={() => void downloadTemplate(false)}>Descargar plantilla</Button>
            <Button variant="ghost" icon={<Download className="h-4 w-4" />} loading={busy === "export"} onClick={() => void downloadTemplate(true)}>Descargar mis productos (para editarlos)</Button>
          </div>
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!busy}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-slate-600 hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-60"
          >
            <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
            <span className="font-semibold">{busy === "read" ? "Leyendo el archivo..." : "Toque para elegir el archivo de Excel (.xlsx)"}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-slate-600">Archivo: <b>{fileName}</b></div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-emerald-50 p-3"><div className="tabular text-2xl font-bold text-emerald-700">{summary.create}</div><div className="text-xs text-emerald-800">nuevos</div></div>
            <div className="rounded-xl bg-brand-50 p-3"><div className="tabular text-2xl font-bold text-brand-700">{summary.update}</div><div className="text-xs text-brand-800">se actualizan</div></div>
            <div className={cn("rounded-xl p-3", summary.errors ? "bg-red-50" : "bg-slate-50")}><div className={cn("tabular text-2xl font-bold", summary.errors ? "text-red-700" : "text-slate-400")}>{summary.errors}</div><div className="text-xs text-slate-600">con errores (no se suben)</div></div>
          </div>
          {summary.update > 0 && (
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>
                <b>Actualizar también la existencia</b> de los productos que ya existen, con la cantidad del Excel.
                <span className="block text-xs text-slate-500">Queda registrado como "ajuste por conteo". Si no lo marca, solo se actualizan nombre, precios y demás datos.</span>
              </span>
            </label>
          )}
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Fila</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Precio</th><th className="px-3 py-2 text-right">Exist.</th><th className="px-3 py-2">Resultado</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.row} className={r.error ? "bg-red-50/50" : undefined}>
                    <td className="tabular px-3 py-2 text-slate-500">{r.row}</td>
                    <td className="px-3 py-2"><div className="font-medium text-slate-900">{r.data?.name || "(sin nombre)"}</div>{r.data?.sku && <div className="text-xs text-slate-500">{r.data.sku}</div>}</td>
                    <td className="tabular px-3 py-2 text-right">{r.data ? formatMoney(r.data.price) : ""}</td>
                    <td className="tabular px-3 py-2 text-right">{r.data?.stock ?? ""}</td>
                    <td className="px-3 py-2">
                      {r.error ? <span className="flex items-center gap-1 text-xs text-red-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{r.error}</span>
                        : r.action === "create" ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" />Nuevo</Badge>
                        : <Badge tone="blue">Actualizar</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <p className="p-3 text-center text-xs text-slate-500">Mostrando 300 de {rows.length} filas. Se importan todas.</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
