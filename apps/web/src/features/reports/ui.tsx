import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { exportToExcel, formatCell, type ColKind, type ReportCell, type ReportTable } from "./table";

/**
 * Estilos de impresión: el AppShell no oculta el menú al imprimir, así que se ocultan aquí
 * (menú lateral, barra superior y todo lo marcado con print:hidden).
 */
export function ReportPrintStyles() {
  return (
    <style>{`
      @page { size: letter; margin: 12mm; }
      @media print {
        body { background: #fff !important; }
        aside, header.sticky, .fixed.inset-0 { display: none !important; }
        .lg\\:pl-64, .lg\\:pl-\\[76px\\] { padding-left: 0 !important; }
        main { max-width: none !important; padding: 0 !important; }
        .report-card { box-shadow: none !important; break-inside: avoid; }
        .report-table tr { break-inside: avoid; }
      }
    `}</style>
  );
}

export function StatCard({ label, value, hint, tone = "text-slate-900", className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; className?: string }) {
  return (
    <Card className={cn("report-card p-4", className)}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("tabular mt-1 text-xl font-bold tracking-tight sm:text-2xl", tone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

const alignRight = (k?: ColKind) => k && k !== "text";

/** Tabla en escritorio / lista en celular (en impresión siempre tabla). */
export function DataTable({ table, maxRows, description }: { table: ReportTable; maxRows?: number; description?: ReactNode }) {
  const [all, setAll] = useState(false);
  const rows = maxRows && !all ? table.rows.slice(0, maxRows) : table.rows;
  const hidden = table.rows.length - rows.length;
  const cols = table.columns;
  return (
    <Card className="report-card overflow-hidden">
      <CardHeader title={table.title} description={description} />
      {!table.rows.length ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">{table.empty ?? "Sin datos en este período."}</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block print:block">
            <table className="report-table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                  {cols.map((c, i) => (
                    <th key={i} className={cn("whitespace-nowrap px-4 py-2.5 font-semibold", alignRight(c.kind) ? "text-right" : "text-left")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, ri) => (
                  <tr key={ri} className="hover:bg-slate-50/60">
                    {r.map((v, i) => (
                      <td key={i} className={cn("px-4 py-2.5", alignRight(cols[i]?.kind) ? "tabular whitespace-nowrap text-right" : "text-slate-700", i === 0 && "font-medium text-slate-900")}>
                        {formatCell(v, cols[i]?.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.total && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    {table.total.map((v, i) => (
                      <td key={i} className={cn("px-4 py-2.5", alignRight(cols[i]?.kind) && "tabular whitespace-nowrap text-right")}>{formatCell(v, cols[i]?.kind)}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <ul className="divide-y divide-slate-100 sm:hidden print:hidden">
            {rows.map((r, ri) => (
              <li key={ri} className="px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{formatCell(r[0] ?? "", cols[0]?.kind)}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {r.slice(1).map((v, i) =>
                    v === null || v === "" ? null : (
                      <MobilePair key={i} label={cols[i + 1]?.label ?? ""} value={formatCell(v, cols[i + 1]?.kind)} />
                    ),
                  )}
                </div>
              </li>
            ))}
            {table.total && (
              <li className="bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold">{formatCell(table.total[0] ?? "Total")}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {table.total.slice(1).map((v, i) => (v === null || v === "" ? null : <MobilePair key={i} label={cols[i + 1]?.label ?? ""} value={formatCell(v, cols[i + 1]?.kind)} bold />))}
                </div>
              </li>
            )}
          </ul>
          {hidden > 0 && (
            <button onClick={() => setAll(true)} className="w-full border-t border-slate-100 py-2.5 text-sm font-semibold text-brand-700 hover:bg-slate-50 print:hidden">
              Ver {hidden} más
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function MobilePair({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className={cn("tabular text-right text-slate-800", bold && "font-semibold")}>{value}</span>
    </>
  );
}

/** Barra de acciones de cada pestaña: Exportar a Excel e Imprimir / PDF. */
export function TabActions({
  title,
  periodLabel,
  fileRange,
  tables,
  summary,
  disabled,
}: {
  title: string;
  periodLabel: string;
  fileRange: string;
  tables: ReportTable[];
  summary?: Array<[string, ReportCell, ColKind?]>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const onExport = async () => {
    setBusy(true);
    try {
      await exportToExcel({ title, periodLabel, fileRange, tables, summary });
    } catch (err) {
      toast.error(`No se pudo exportar: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={onExport} loading={busy} disabled={disabled}>
        Exportar a Excel
      </Button>
      <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={disabled}>
        Imprimir / PDF
      </Button>
    </div>
  );
}

export function TabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function TabError({ message }: { message: string }) {
  return <Card><ErrorState message={message} /></Card>;
}

/** Encabezado de la pestaña: título (visible también al imprimir) y acciones. */
export function TabHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
