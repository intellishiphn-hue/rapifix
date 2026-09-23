import type { Period } from "../period";

export interface TabProps {
  period: Period;
  /** "2026-09-01 a 2026-09-30", para el nombre del archivo */
  fileRange: string;
  /** cambia al presionar Actualizar */
  refresh: number;
}

export const loaderKey = (name: string, p: TabProps, extra = "") => `${name}|${p.period.start.getTime()}|${p.period.end.getTime()}|${p.refresh}|${extra}`;
