import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Info, Minus, TriangleAlert } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMoney } from "@rapifix/shared";
import { cn } from "@/lib/cn";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatCell, type ColKind, type ReportCell, type ReportTable } from "@/features/reports/table";

// ---------------- Formatos ----------------
const nf1 = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 });
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf1.format(v)} %`);
export const fmtNum = (v: number) => new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 }).format(v);

// ---------------- Comparación ----------------
/**
 * Variación contra el período anterior.
 * mode "money": % de cambio. mode "points": diferencia en puntos porcentuales (para márgenes).
 * `goodWhenUp` false para gastos (subir es malo).
 */
export function Delta({ current, previous, mode = "money", goodWhenUp = true, label = "vs período anterior" }: {
  current: number | null;
  previous: number | null | undefined;
  mode?: "money" | "points";
  goodWhenUp?: boolean;
  label?: string;
}) {
  if (previous === undefined || previous === null || current === null) return null;
  let text: string;
  let dir: -1 | 0 | 1;
  if (mode === "points") {
    const d = current - previous;
    dir = Math.abs(d) < 0.05 ? 0 : d > 0 ? 1 : -1;
    text = `${nf1.format(Math.abs(d))} pts`;
  } else {
    if (previous === 0) {
      if (current === 0) {
        dir = 0;
        text = "sin cambio";
      } else {
        return <div className="mt-1 text-xs text-slate-400">Sin datos en el período anterior</div>;
      }
    } else {
      const d = ((current - previous) / Math.abs(previous)) * 100;
      dir = Math.abs(d) < 0.05 ? 0 : d > 0 ? 1 : -1;
      text = `${nf1.format(Math.abs(d))} %`;
    }
  }
  const good = dir === 0 ? null : (dir > 0) === goodWhenUp;
  const Icon = dir > 0 ? ArrowUp : dir < 0 ? ArrowDown : Minus;
  return (
    <div className="mt-1 flex items-center gap-1 text-xs">
      <span className={cn("inline-flex items-center gap-0.5 font-semibold", good === null ? "text-slate-500" : good ? "text-emerald-700" : "text-red-700")}>
        <Icon className="h-3.5 w-3.5" />
        {text}
      </span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

export function KpiCard({ label, value, sub, hint, tone = "text-slate-900", delta, className }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: ReactNode;
  tone?: string;
  delta?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("report-card flex flex-col p-4", className)}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("tabular mt-1 text-xl font-bold tracking-tight sm:text-2xl", tone)}>{value}</div>
      {sub && <div className="text-xs font-medium text-slate-600">{sub}</div>}
      {delta}
      {hint && <div className="mt-auto pt-2 text-[11px] leading-snug text-slate-400">{hint}</div>}
    </Card>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const warn = tone === "warn";
  const Icon = warn ? TriangleAlert : Info;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-4 py-3 text-sm", warn ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
      {label && <span className="text-slate-500">{label}</span>}
      <div className="flex max-w-full overflow-x-auto rounded-[10px] bg-slate-200/70 p-1">
        {options.map(([k, l]) => (
          <button key={k} onClick={() => onChange(k)} className={cn("whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium", value === k ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Tabla con definición única (pantalla + Excel) ----------------
export interface Col<T> {
  label: string;
  kind?: ColKind;
  value: (r: T) => ReportCell;
  /** contenido personalizado en pantalla (el Excel usa `value`) */
  render?: (r: T) => ReactNode;
  /** clases extra para la celda (ej. resaltar en ámbar) */
  tone?: (r: T) => string | undefined;
  /** no exportar a Excel (ej. botones) */
  screenOnly?: boolean;
}

export function toReportTable<T>(title: string, cols: Col<T>[], rows: T[], total?: ReportCell[], empty?: string): ReportTable {
  const idx = cols.map((c, i) => (c.screenOnly ? -1 : i)).filter((i) => i >= 0);
  return {
    title,
    columns: idx.map((i) => ({ label: cols[i]!.label, kind: cols[i]!.kind })),
    rows: rows.map((r) => idx.map((i) => cols[i]!.value(r))),
    total: total ? idx.map((i) => total[i] ?? null) : undefined,
    empty,
  };
}

const right = (k?: ColKind) => !!k && k !== "text";

export function RichTable<T>({ title, description, cols, rows, total, maxRows, empty, action, rowKey }: {
  title: ReactNode;
  description?: ReactNode;
  cols: Col<T>[];
  rows: T[];
  total?: ReportCell[];
  maxRows?: number;
  empty?: string;
  action?: ReactNode;
  rowKey: (r: T, i: number) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = maxRows && !all ? rows.slice(0, maxRows) : rows;
  const hidden = rows.length - shown.length;
  const cellContent = (c: Col<T>, r: T) => (c.render ? c.render(r) : formatCell(c.value(r), c.kind));
  return (
    <Card className="report-card overflow-hidden">
      <CardHeader title={title} description={description} action={action} />
      {!rows.length ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">{empty ?? "Sin datos en este período."}</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block print:block">
            <table className="report-table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                  {cols.map((c, i) => (
                    <th key={i} className={cn("whitespace-nowrap px-3 py-2.5 font-semibold first:pl-4 last:pr-4", right(c.kind) ? "text-right" : "text-left", c.screenOnly && "print:hidden")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r, ri) => (
                  <tr key={rowKey(r, ri)} className="hover:bg-slate-50/60">
                    {cols.map((c, i) => (
                      <td
                        key={i}
                        className={cn(
                          "px-3 py-2.5 first:pl-4 last:pr-4",
                          right(c.kind) ? "tabular whitespace-nowrap text-right" : "text-slate-700",
                          i === 0 && "font-medium text-slate-900",
                          c.screenOnly && "print:hidden",
                          c.tone?.(r),
                        )}
                      >
                        {cellContent(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    {cols.map((c, i) => (
                      <td key={i} className={cn("px-3 py-2.5 first:pl-4 last:pr-4", right(c.kind) && "tabular whitespace-nowrap text-right", c.screenOnly && "print:hidden")}>{formatCell(total[i] ?? null, c.kind)}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <ul className="divide-y divide-slate-100 sm:hidden print:hidden">
            {shown.map((r, ri) => (
              <li key={rowKey(r, ri)} className="px-4 py-3">
                <div className={cn("text-sm font-semibold text-slate-900", cols[0]?.tone?.(r))}>{cols[0] && cellContent(cols[0], r)}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {cols.slice(1).map((c, i) => {
                    const v = c.value(r);
                    if (!c.render && (v === null || v === "")) return null;
                    return (
                      <MobilePair key={i} label={c.label} className={c.tone?.(r)}>
                        {cellContent(c, r)}
                      </MobilePair>
                    );
                  })}
                </div>
              </li>
            ))}
            {total && (
              <li className="bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold">{formatCell(total[0] ?? "Total")}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {cols.slice(1).map((c, i) => {
                    const v = total[i + 1];
                    return v === null || v === undefined || v === "" ? null : (
                      <MobilePair key={i} label={c.label} bold>
                        {formatCell(v, c.kind)}
                      </MobilePair>
                    );
                  })}
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

function MobilePair({ label, children, bold, className }: { label: string; children: ReactNode; bold?: boolean; className?: string }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className={cn("tabular text-right text-slate-800", bold && "font-semibold", className)}>{children}</span>
    </>
  );
}

// ---------------- Gráficos ----------------
export const compactMoney = (cents: number) => {
  const l = cents / 100;
  if (Math.abs(l) >= 1_000_000) return `${nf1.format(l / 1_000_000)}M`;
  if (Math.abs(l) >= 1000) return `${nf1.format(l / 1000)}k`;
  return new Intl.NumberFormat("es-HN", { maximumFractionDigits: 0 }).format(l);
};

const tooltipStyle = { borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 13, boxShadow: "0 8px 24px -8px rgb(15 23 42 / .2)" };

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  type?: "bar" | "line";
}

/** Barras (y líneas opcionales) con montos en centavos. */
export function MoneyChart({ data, series, height = 260 }: { data: Array<Record<string, number | string>>; series: SeriesDef[]; height?: number }) {
  const hasLine = series.some((s) => s.type === "line");
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="#EEF1F6" />
      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} interval="preserveStartEnd" minTickGap={10} />
      <YAxis tickLine={false} axisLine={false} tick={{ fill: "#94A3B8", fontSize: 11 }} tickFormatter={(v: number) => compactMoney(v)} width={52} />
      <Tooltip cursor={{ fill: "#EEF3FF" }} contentStyle={tooltipStyle} formatter={(v, name) => [formatMoney(Number(v)), String(name)]} />
      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
    </>
  );
  return (
    <ResponsiveContainer width="100%" height={height}>
      {hasLine ? (
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }} barCategoryGap="20%">
          {common}
          {series.map((s) =>
            s.type === "line" ? (
              <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            ) : (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      ) : (
        <BarChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }} barCategoryGap="20%">
          {common}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export const PALETTE = ["#1447E6", "#10B981", "#F59E0B", "#8B5CF6", "#0EA5E9", "#64748B", "#EF4444"];

/** Dona con leyenda propia (monto y %). */
export function DonutChart({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [formatMoney(Number(v)), String(name)]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="flex-1 text-slate-700">{d.name}</span>
            <span className="tabular font-medium text-slate-900">{formatMoney(d.value)}</span>
            <span className="tabular w-14 text-right text-xs text-slate-500">{fmtPct(total ? (d.value / total) * 100 : null)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tono para márgenes: rojo si pierde, ámbar si es bajo. */
export const marginTone = (m: number | null, low = 20) => (m === null ? undefined : m < 0 ? "text-red-700 font-semibold" : m < low ? "text-amber-700 font-semibold bg-amber-50/70" : undefined);
