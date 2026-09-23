import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, hnDayKey, type Payment } from "@rapifix/shared";
import { toDate } from "@/lib/format";
import { shortDayLabel } from "./period";

export interface DayPoint {
  key: string;
  label: string;
  /** centavos */
  amount: number;
}

/** Suma pagos válidos por día (hora de Honduras). */
export function paymentsByDay(payments: Payment[], keys: string[]): DayPoint[] {
  const map = new Map(keys.map((k) => [k, 0]));
  for (const p of payments) {
    if (p.status !== "valid") continue;
    const d = toDate(p.at);
    if (!d) continue;
    const k = hnDayKey(d);
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + p.amount);
  }
  return keys.map((k) => ({ key: k, label: shortDayLabel(k), amount: map.get(k) ?? 0 }));
}

const compact = (cents: number) => {
  const l = cents / 100;
  if (Math.abs(l) >= 1000) return `${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(l / 1000)}k`;
  return new Intl.NumberFormat("es-HN", { maximumFractionDigits: 0 }).format(l);
};

/** Gráfico de barras de cobrado por día. */
export function DailyAmountChart({ data, height = 240 }: { data: DayPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke="#EEF1F6" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#94A3B8", fontSize: 11 }} tickFormatter={(v: number) => compact(v)} width={48} />
        <Tooltip
          cursor={{ fill: "#EEF3FF" }}
          contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 13, boxShadow: "0 8px 24px -8px rgb(15 23 42 / .2)" }}
          formatter={(v) => [formatMoney(Number(v)), "Cobrado"]}
        />
        <Bar dataKey="amount" fill="#1447E6" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
