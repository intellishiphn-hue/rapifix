import { fmtPct, formatMoney, type TechPayEmployeeLine } from "@rapifix/shared";
import { hnDate, hnParts, keyToDate, type Period } from "@/features/reports/period";

/** "Cambio de aceite: 30 % de L 1,000.00 = L 300.00" / "Alineado: fijo por trabajo L 200.00" */
export function earningLineText(l: TechPayEmployeeLine): string {
  return l.mode === "percent"
    ? `${l.description}: ${fmtPct(l.percent)} de ${formatMoney(l.base)} = ${formatMoney(l.amount)}`
    : `${l.description}: fijo por trabajo ${formatMoney(l.amount)}`;
}

export const ruleText = (l: Pick<TechPayEmployeeLine, "mode" | "percent">) => (l.mode === "percent" ? fmtPct(l.percent) : "Fijo por trabajo");

export type TechPeriodKey = "week" | "fortnight" | "month" | "prevMonth" | "custom";
export const TECH_PERIODS: ReadonlyArray<readonly [TechPeriodKey, string]> = [
  ["week", "Esta semana"], ["fortnight", "Quincena actual"], ["month", "Este mes"], ["prevMonth", "Mes anterior"], ["custom", "Rango"],
];

const fmtDay = (d: Date) => new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", timeZone: "America/Tegucigalpa" }).format(d);

/** Períodos de pago en hora de Honduras: semana (lunes a domingo), quincena (1 a 15 o 16 a fin de mes), mes. */
export function techPeriod(key: TechPeriodKey, custom?: { from: string; to: string }): Period {
  const p = hnParts();
  switch (key) {
    case "week": {
      const back = (p.dow + 6) % 7;
      const start = hnDate(p.y, p.m, p.d - back);
      const end = hnDate(p.y, p.m, p.d - back + 7);
      return { start, end, label: `Semana del ${fmtDay(start)}` };
    }
    case "fortnight": {
      const first = p.d <= 15;
      const start = hnDate(p.y, p.m, first ? 1 : 16);
      const end = first ? hnDate(p.y, p.m, 16) : hnDate(p.y, p.m + 1, 1);
      return { start, end, label: `Quincena del ${fmtDay(start)} al ${fmtDay(new Date(end.getTime() - 86_400_000))}` };
    }
    case "month": {
      const start = hnDate(p.y, p.m, 1);
      const label = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "America/Tegucigalpa" }).format(start);
      return { start, end: hnDate(p.y, p.m + 1, 1), label: label.charAt(0).toUpperCase() + label.slice(1) };
    }
    case "prevMonth": {
      const start = hnDate(p.y, p.m - 1, 1);
      const label = new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "America/Tegucigalpa" }).format(start);
      return { start, end: hnDate(p.y, p.m, 1), label: label.charAt(0).toUpperCase() + label.slice(1) };
    }
    case "custom": {
      const today = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
      const from = custom?.from || today;
      const to = custom?.to && custom.to >= from ? custom.to : from;
      const start = keyToDate(from);
      const end = new Date(keyToDate(to).getTime() + 86_400_000);
      return { start, end, label: `Del ${fmtDay(start)} al ${fmtDay(keyToDate(to))}` };
    }
  }
}
