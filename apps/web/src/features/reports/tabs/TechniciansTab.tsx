import { useMemo } from "react";
import { limit, where } from "firebase/firestore";
import { formatMoney, orderCol, type StaffEntry, type WorkOrder } from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { fetchAll, fetchApprovedQuotes, fetchRange, techStats, useLoader, type TechStats } from "../data";
import type { ColKind, ReportCell, ReportTable } from "../table";
import { DataTable, StatCard, TabActions, TabError, TabHeader, TabSkeleton } from "../ui";
import { loaderKey, type TabProps } from "./common";

async function load(p: TabProps) {
  const path = orderCol.workOrders(TENANT_ID);
  const [staff, open, delivered] = await Promise.all([
    fetchAll<StaffEntry>(orderCol.staff(TENANT_ID)),
    fetchAll<WorkOrder>(path, where("isOpen", "==", true), limit(1000)),
    fetchRange<WorkOrder>(path, "deliveredAt", p.period.start, p.period.end).then((l) => l.filter((o) => o.status === "DELIVERED")),
  ]);
  const quotes = await fetchApprovedQuotes(delivered);
  return { staff, stats: techStats(open, delivered, quotes), delivered };
}

export function TechniciansTab(props: TabProps) {
  const { data, loading, error } = useLoader(() => load(props), loaderKey("techs", props));

  const r = useMemo(() => {
    if (!data) return null;
    const list: TechStats[] = [];
    const seen = new Set<string>();
    for (const s of data.staff) {
      const st = data.stats.get(s.id);
      if (s.role !== "technician" && !st) continue;
      if (!s.active && !st) continue;
      seen.add(s.id);
      list.push(st ? { ...st, name: s.displayName || st.name } : { id: s.id, name: s.displayName, open: 0, delivered: 0, hours: 0, laborIncome: 0, serviceIncome: 0, orders: [] });
    }
    for (const st of data.stats.values()) if (!seen.has(st.id)) list.push({ ...st, name: st.name || "Usuario eliminado" });
    list.sort((a, b) => b.laborIncome + b.serviceIncome - (a.laborIncome + a.serviceIncome) || b.delivered - a.delivered || a.name.localeCompare(b.name));

    const sum = (f: (t: TechStats) => number) => list.reduce((a, t) => a + f(t), 0);
    const table: ReportTable = {
      title: "Productividad por técnico",
      columns: [
        { label: "Técnico" }, { label: "Órdenes abiertas", kind: "number" }, { label: "Entregadas", kind: "number" },
        { label: "Horas MO facturadas", kind: "hours" }, { label: "Ingreso mano de obra", kind: "money" }, { label: "Ingreso servicios", kind: "money" },
      ],
      rows: list.map((t) => [t.name, t.open, t.delivered, Math.round(t.hours * 100) / 100, t.laborIncome, t.serviceIncome]),
      total: ["Total", null, null, Math.round(sum((t) => t.hours) * 100) / 100, sum((t) => t.laborIncome), sum((t) => t.serviceIncome)],
      empty: "No hay técnicos registrados. Créelos en Usuarios y permisos.",
    };
    return { table, hours: sum((t) => t.hours), labor: sum((t) => t.laborIncome), techs: list.length };
  }, [data]);

  if (error) return <TabError message={error} />;
  if (loading || !r || !data) return <TabSkeleton />;
  const unassigned = data.delivered.filter((o) => !o.technicianIds?.length).length;
  const summary: Array<[string, ReportCell, ColKind]> = [
    ["Órdenes entregadas en el período", data.delivered.length, "number"],
    ["Horas de mano de obra facturadas", r.hours, "hours"],
    ["Ingreso de mano de obra", r.labor, "money"],
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title="Técnicos"
        subtitle={`${props.period.label} · las órdenes abiertas son al día de hoy`}
        actions={<TabActions title="Técnicos" periodLabel={props.period.label} fileRange={props.fileRange} tables={[r.table]} summary={summary} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Órdenes entregadas" value={data.delivered.length} hint={unassigned ? `${unassigned} sin técnico asignado` : undefined} />
        <StatCard label="Horas de mano de obra" value={`${new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(r.hours)} h`} />
        <StatCard label="Ingreso de mano de obra" value={formatMoney(r.labor)} tone="text-emerald-700" />
      </div>
      <DataTable table={r.table} />
      <p className="text-xs text-slate-500">
        Horas facturadas = cantidad de las líneas de tipo "Mano de obra" en la cotización aprobada de cada orden entregada. Si una orden tiene varios técnicos, las horas y los ingresos se reparten en partes iguales. Montos sin ISV.
      </p>
    </div>
  );
}
