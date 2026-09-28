import type { Period, PeriodKey } from "@/features/reports/period";

export interface FinTabProps {
  periodKey: PeriodKey;
  period: Period;
  /** período anterior de igual duración (para comparar) */
  prev: Period;
  /** "2026-09-01 a 2026-09-30", para el nombre del archivo */
  fileRange: string;
  /** cambia al presionar Actualizar */
  refresh: number;
}

export const finKey = (name: string, p: FinTabProps, extra = "") =>
  `fin-${name}|${p.period.start.getTime()}|${p.period.end.getTime()}|${p.prev.start.getTime()}|${p.refresh}|${extra}`;
