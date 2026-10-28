import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { limit, where } from "firebase/firestore";
import { toast } from "sonner";
import { ArrowRight, HandCoins, HardHat, Info, Pencil, Phone, RefreshCw, UserPlus, Users, Wrench } from "lucide-react";
import {
  EMPLOYEE_COLORS, formatMoney, formatPhone, NO_TECH_PAY, orderCol, ROLE_LABELS, saveEmployeeSchema, saveStaffMemberSchema, isRole, techPayDefaultLabel, techPayDefaultSchema,
  type EmployeeProfile, type Role, type SaveStaffMemberInput, type StaffEntry, type TechPayDefault, type WorkOrder,
} from "@rapifix/shared";
import { TENANT_ID } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { useStaffDirectory } from "@/features/work-orders/api";
import { StatusBadge } from "@/features/work-orders/StatusBadge";
import { PlateTag } from "@/features/vehicles/VehicleCard";
import { fetchAll, fetchApprovedQuotes, fetchRange, techStats, useLoader, type TechStats } from "@/features/reports/data";
import { hnDate, hnParts } from "@/features/reports/period";
import { saveEmployeeProfile, useEmployeeProfiles } from "./api";
import { saveStaffMember, useTechPayConfig } from "@/features/tech-pay/api";
import { PercentInput } from "@/features/tech-pay/TechPayLineEditor";
import { MoneyInput } from "@/features/quotes/MoneyInput";

type Profile = Partial<EmployeeProfile> & { id: string };

interface Row {
  staff: StaffEntry;
  profile: Profile | undefined;
  stats: TechStats | undefined;
  /** pago por trabajo por defecto (solo si quien mira tiene permiso) */
  techPay?: TechPayDefault | null;
}

/** Roles que puede tener un empleado sin acceso al panel. */
const NO_ACCESS_ROLES: SaveStaffMemberInput["role"][] = ["technician", "washer", "warehouse", "seller", "reception"];

const ROLE_ORDER: Role[] = ["technician", "washer", "reception", "warehouse", "seller", "manager", "admin"];

/** Órdenes abiertas + entregadas en el mes (hora de Honduras) + horas facturadas por técnico. */
async function loadStats() {
  const p = hnParts();
  const start = hnDate(p.y, p.m, 1);
  const end = hnDate(p.y, p.m + 1, 1);
  const path = orderCol.workOrders(TENANT_ID);
  const [open, delivered] = await Promise.all([
    fetchAll<WorkOrder>(path, where("isOpen", "==", true), limit(1000)),
    fetchRange<WorkOrder>(path, "deliveredAt", start, end).then((l) => l.filter((o) => o.status === "DELIVERED")),
  ]);
  const quotes = await fetchApprovedQuotes(delivered);
  return techStats(open, delivered, quotes);
}

export function EmployeesPage() {
  const { can } = useAuth();
  const canEdit = can("employees.manage");
  const showMoney = can("reports.financial");
  const canTechPay = can("techpay.manage");
  const staff = useStaffDirectory();
  const profiles = useEmployeeProfiles();
  const payConfig = useTechPayConfig(canTechPay);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const stats = useLoader(loadStats, `employees-stats|${refresh}`);
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(profiles.data.map((p) => [p.id, p]));
    return staff.data
      .filter((s) => showInactive || s.active)
      .filter((s) => roleFilter === "all" || s.role === roleFilter)
      .map((s) => ({ staff: s, profile: byId.get(s.id), stats: stats.data?.get(s.id), techPay: canTechPay ? payConfig.map.get(s.id) ?? null : undefined }))
      .sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(isRole(a.staff.role) ? a.staff.role : "admin");
        const rb = ROLE_ORDER.indexOf(isRole(b.staff.role) ? b.staff.role : "admin");
        return Number(b.staff.active) - Number(a.staff.active) || ra - rb || a.staff.displayName.localeCompare(b.staff.displayName);
      });
  }, [staff.data, profiles.data, stats.data, roleFilter, showInactive, canTechPay, payConfig.map]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of staff.data) if (showInactive || s.active) m.set(s.role, (m.get(s.role) ?? 0) + 1);
    return m;
  }, [staff.data, showInactive]);

  const monthLabel = new Intl.DateTimeFormat("es-HN", { month: "long", timeZone: "America/Tegucigalpa" }).format(new Date());

  return (
    <>
      <PageHeader
        title="Técnicos y empleados"
        description="Personal del taller, carga de trabajo y productividad del mes."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefresh((n) => n + 1)} loading={stats.loading}>Actualizar</Button>
            {canEdit && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>Empleado sin acceso</Button>}
          </>
        }
      />

      <div className="mb-5 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Los usuarios (nombre, correo, rol y acceso) se crean y se desactivan en{" "}
          {can("users.manage") ? <Link to="/usuarios" className="font-semibold underline">Usuarios y permisos</Link> : <b>Usuarios y permisos</b>}.
          Aquí se completa el perfil de cada persona: teléfono, especialidad y color en la agenda{canTechPay ? ", y su pago por trabajo" : ""}.
          {canEdit && <> Si alguien no usa el sistema (por ejemplo un técnico que solo trabaja en el taller), regístrelo con <b>Empleado sin acceso</b>: aparece en las órdenes y en el pago a técnicos, pero no puede entrar al panel.</>}
        </p>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          <div className="flex rounded-[10px] bg-slate-200/70 p-1">
            {(["all", ...ROLE_ORDER] as const).filter((r) => r === "all" || counts.get(r)).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", roleFilter === r ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {r === "all" ? "Todos" : ROLE_LABELS[r]}
                <span className="ml-1 text-xs text-slate-400">{r === "all" ? [...counts.values()].reduce((a, b) => a + b, 0) : counts.get(r)}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:ml-auto">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Mostrar inactivos
        </label>
      </div>

      {stats.error && <p className="mb-3 text-sm text-amber-700">No se pudieron cargar las estadísticas: {stats.error}</p>}

      {staff.error ? (
        <Card><ErrorState message={staff.error} /></Card>
      ) : staff.loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : !rows.length ? (
        <Card><EmptyState icon={<Users className="h-7 w-7" />} title="No hay personal en este filtro" description="Cree los usuarios del taller en Usuarios y permisos." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <EmployeeCard
              key={row.staff.id}
              row={row}
              statsLoading={stats.loading}
              showMoney={showMoney}
              monthLabel={monthLabel}
              onEdit={canEdit ? () => setEditing(row) : undefined}
              onView={() => setViewing(row)}
            />
          ))}
        </div>
      )}

      <p className="mt-5 text-xs text-slate-500">
        Horas facturadas = cantidad de las líneas de "Mano de obra" en la cotización aprobada de las órdenes entregadas este mes. Si una orden tiene varios técnicos, se reparten en partes iguales.
      </p>

      <EditEmployeeDialog row={editing} onClose={() => setEditing(null)} canTechPay={canTechPay} />
      {creating && <EditForm row={null} onClose={() => setCreating(false)} canTechPay={canTechPay} />}
      <OrdersDialog row={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function EmployeeCard({ row, statsLoading, showMoney, monthLabel, onEdit, onView }: {
  row: Row; statsLoading: boolean; showMoney: boolean; monthLabel: string; onEdit?: () => void; onView: () => void;
}) {
  const { staff: s, profile: p, stats: st } = row;
  const isTech = s.role === "technician";
  const color = p?.color || "#94a3b8";
  const hours = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 }).format(st?.hours ?? 0);
  return (
    <Card className={cn("flex flex-col", !s.active && "opacity-60")}>
      <div className="flex items-start gap-3 p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: color }}>
          {initials(s.displayName) || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-slate-900">{s.displayName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={isTech ? "blue" : "gray"}>{isRole(s.role) ? ROLE_LABELS[s.role] : s.role}</Badge>
            {s.noAccess && <Badge tone="amber">Sin acceso al panel</Badge>}
            {!s.active && <Badge tone="red">Inactivo</Badge>}
          </div>
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            {p?.specialty ? <div className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-slate-400" />{p.specialty}</div> : null}
            {p?.phone ? (
              <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 hover:text-brand-700"><Phone className="h-3.5 w-3.5 text-slate-400" />{formatPhone(p.phone)}</a>
            ) : null}
            {!p?.specialty && !p?.phone && <div className="text-xs text-slate-400">Perfil sin completar</div>}
            {row.techPay !== undefined && (isTech || (row.techPay && row.techPay.mode !== "none")) && (
              <div className="flex items-center gap-1.5" data-testid="employee-techpay"><HandCoins className="h-3.5 w-3.5 text-slate-400" /><span className={row.techPay && row.techPay.mode !== "none" ? "font-medium text-slate-800" : "text-slate-400"}>{techPayDefaultLabel(row.techPay)}</span></div>
            )}
          </div>
        </div>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar perfil" className="-mr-2 -mt-2">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
      {(isTech || st) && (
        <div className="mt-auto border-t border-slate-100">
          <div className={cn("grid divide-x divide-slate-100 text-center", showMoney ? "grid-cols-4" : "grid-cols-3")}>
            <Stat label="Abiertas" value={statsLoading ? null : String(st?.open ?? 0)} />
            <Stat label={`Entregadas (${monthLabel})`} value={statsLoading ? null : String(st?.delivered ?? 0)} />
            <Stat label="Horas MO" value={statsLoading ? null : `${hours} h`} />
            {showMoney && <Stat label="Mano de obra" value={statsLoading ? null : formatMoney(st?.laborIncome ?? 0)} />}
          </div>
          <button onClick={onView} className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-2.5 text-sm font-semibold text-brand-700 hover:bg-slate-50">
            Ver órdenes asignadas <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 px-2 py-3">
      {value === null ? <Skeleton className="mx-auto h-5 w-10" /> : <div className="tabular truncate text-sm font-bold text-slate-900">{value}</div>}
      <div className="truncate text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function OrdersDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const orders = row?.stats?.orders ?? [];
  return (
    <Dialog open={!!row} onClose={onClose} title={row ? `Órdenes de ${row.staff.displayName}` : ""} description="Órdenes abiertas asignadas">
      {!orders.length ? (
        <EmptyState icon={<HardHat className="h-7 w-7" />} title="Sin órdenes abiertas" description="No tiene órdenes asignadas en este momento." />
      ) : (
        <ul className="-mx-5 -my-5 divide-y divide-slate-100">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/ordenes/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{o.code} · {o.vehicle.make} {o.vehicle.model}</div>
                  <div className="truncate text-xs text-slate-500">{o.customer.fullName}</div>
                </div>
                <PlateTag plate={o.vehicle.plate} />
                <StatusBadge status={o.status} short />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function EditEmployeeDialog({ row, onClose, canTechPay }: { row: Row | null; onClose: () => void; canTechPay: boolean }) {
  return row ? <EditForm key={row.staff.id} row={row} onClose={onClose} canTechPay={canTechPay} /> : null;
}

/**
 * Editar el perfil de un empleado, o registrar uno nuevo SIN acceso al panel (row = null).
 * En un empleado sin acceso también se cambian nombre, rol y si está activo; en un usuario del panel eso se
 * cambia en Usuarios y permisos. El pago por trabajo solo lo ven y cambian administración y gerencia.
 */
function EditForm({ row, onClose, canTechPay }: { row: Row | null; onClose: () => void; canTechPay: boolean }) {
  const isNew = !row;
  const noAccess = isNew || !!row?.staff.noAccess;
  const [name, setName] = useState(row?.staff.displayName ?? "");
  const [role, setRole] = useState<SaveStaffMemberInput["role"]>(() => (row && (NO_ACCESS_ROLES as string[]).includes(row.staff.role) ? (row.staff.role as SaveStaffMemberInput["role"]) : "technician"));
  const [active, setActive] = useState(row?.staff.active ?? true);
  const [phone, setPhone] = useState(row?.profile?.phone ?? "");
  const [specialty, setSpecialty] = useState(row?.profile?.specialty ?? "");
  const [color, setColor] = useState(row?.profile?.color || EMPLOYEE_COLORS[0]);
  const [pay, setPay] = useState<TechPayDefault>(row?.techPay ?? NO_TECH_PAY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const staffParsed = noAccess ? saveStaffMemberSchema.safeParse({ employeeId: row?.staff.id ?? null, displayName: name, role, active }) : null;
    if (staffParsed && !staffParsed.success) for (const i of staffParsed.error.issues) errs[i.path[0] === "displayName" ? "name" : String(i.path[0])] = i.message;
    const payParsed = canTechPay ? techPayDefaultSchema.safeParse(pay) : null;
    if (payParsed && !payParsed.success) errs.techPay = payParsed.error.issues[0]?.message ?? "Revise el pago por trabajo";
    const profile = saveEmployeeSchema.safeParse({ uid: row?.staff.id ?? "nuevo", phone, specialty, color, ...(canTechPay ? { techPay: pay } : {}) });
    if (!profile.success) for (const i of profile.error.issues) errs[String(i.path[0])] = i.message;
    if (Object.keys(errs).length) return setErrors(errs);
    setSaving(true);
    try {
      let uid = row?.staff.id ?? "";
      if (staffParsed?.success) uid = (await saveStaffMember(staffParsed.data)).employeeId;
      await saveEmployeeProfile({ ...profile.data!, uid });
      toast.success(isNew ? `${name.trim()} quedó registrado (sin acceso al panel)` : "Perfil actualizado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? "Empleado sin acceso al panel" : "Editar perfil"}
      description={isNew ? "Para quien trabaja en el taller pero no usa el sistema. No tiene correo ni contraseña." : `${row!.staff.displayName} · ${isRole(row!.staff.role) ? ROLE_LABELS[row!.staff.role] : row!.staff.role}${row!.staff.noAccess ? " · sin acceso al panel" : ""}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="employee-form" loading={saving}>{isNew ? "Registrar" : "Guardar"}</Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="space-y-4">
        {noAccess && (
          <>
            <Field label="Nombre" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} maxLength={80} autoFocus={isNew} placeholder="Ej. Anthony Martínez" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Puesto" error={errors.role}>
                <Select value={role} onChange={(e) => setRole(e.target.value as SaveStaffMemberInput["role"])}>
                  {NO_ACCESS_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </Field>
              {!isNew && (
                <Field label="Estado">
                  <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Activo</label>
                </Field>
              )}
            </div>
          </>
        )}
        <Field label="Teléfono" error={errors.phone} hint={canTechPay ? "Para mandarle por WhatsApp el resumen de sus pagos." : undefined}>
          <PhoneInput value={phone} onChange={setPhone} invalid={!!errors.phone} />
        </Field>
        <Field label="Especialidad" error={errors.specialty} hint="Ej.: Motor y transmisión, electricidad, frenos">
          <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} invalid={!!errors.specialty} />
        </Field>
        <Field label="Color en la agenda" error={errors.color}>
          <div className="flex flex-wrap gap-2 pt-1">
            {EMPLOYEE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={cn("h-9 w-9 rounded-full ring-offset-2 transition", color === c ? "ring-2 ring-slate-900" : "hover:scale-105")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>
        {canTechPay && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-3" data-testid="techpay-default">
            <div>
              <div className="text-sm font-semibold text-slate-900">Pago por trabajo</div>
              <p className="text-xs text-slate-500">Se propone en cada mano de obra y servicio de sus órdenes. Se gana cuando la orden se cobra completa. El técnico no ve estos montos.</p>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-slate-200/70 p-1">
              {([["none", "Sin pago"], ["percent", "Porcentaje"], ["fixed", "Monto fijo"]] as const).map(([m, l]) => (
                <button key={m} type="button" onClick={() => setPay((p) => ({ ...p, mode: m }))} className={cn("rounded-lg px-2 py-1.5 text-sm font-medium", pay.mode === m ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>{l}</button>
              ))}
            </div>
            {pay.mode === "percent" && (
              <Field label="Porcentaje de cada trabajo" hint="Del monto que paga el cliente por la línea, sin ISV y después de descuentos. Admite decimales (12.5).">
                <PercentInput value={pay.percent} onChange={(v) => setPay((p) => ({ ...p, percent: v }))} className="max-w-[140px]" ariaLabel="Porcentaje por defecto" />
              </Field>
            )}
            {pay.mode === "fixed" && (
              <Field label="Monto fijo por trabajo" hint="Por cada línea de trabajo, no por unidad.">
                <MoneyInput value={pay.fixedAmount} onChange={(v) => setPay((p) => ({ ...p, fixedAmount: v }))} className="max-w-[180px]" />
              </Field>
            )}
            {errors.techPay && <p className="text-xs text-red-600">{errors.techPay}</p>}
          </div>
        )}
        {!noAccess && <p className="text-xs text-slate-500">El nombre, el correo y el rol se cambian en Usuarios y permisos.</p>}
      </form>
    </Dialog>
  );
}
