import { collection, doc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  catalogCol, col, companyCol, opsCol, orderCol, orderDueKey, deliveredMs,
  type AssignVehicleInput, type Company, type CompanyPayment, type Maintenance, type Payment, type RegisterCompanyPaymentInput,
  type Sale, type SaveCompanyInput, type SetReferralInput, type Vehicle, type WorkOrder,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

// ---------- Cloud Functions ----------
export const saveCompany = callable<SaveCompanyInput, { companyId: string }>("saveCompany");
export const assignVehicleToCompany = callable<AssignVehicleInput, { ok: boolean; openOrdersUpdated: number }>("assignVehicleToCompany");
export const setReferral = callable<SetReferralInput, { ok: boolean }>("setReferral");
export const registerCompanyPayment = callable<RegisterCompanyPaymentInput, { companyPaymentId: string; code: string; amount: number; receipts: string[] }>("registerCompanyPayment");

const companiesCol = () => collection(db, companyCol.companies(TENANT_ID));
export const companyRef = (id: string) => doc(db, companyCol.companies(TENANT_ID), id);

/** Todas las empresas (son pocas): orden por nombre, filtros en memoria. */
export function useCompanies(enabled = true) {
  return useQueryData<Company>(enabled ? query(companiesCol(), orderBy("name"), limit(500)) : null, `companies|${enabled}`);
}

export function useCompany(id: string | null | undefined, enabled = true) {
  return useDocData<Company>(id && enabled ? companyRef(id) : null, `company-${id}-${enabled}`);
}

/** Vehículos de la flota (un solo campo: sin índice compuesto). */
export function useCompanyVehicles(companyId: string | undefined) {
  return useQueryData<Vehicle>(
    companyId ? query(collection(db, col.vehicles(TENANT_ID)), where("companyId", "==", companyId), limit(1000)) : null,
    `company-vehicles-${companyId}`,
  );
}

/** Órdenes de la empresa (todas). Se ordenan en memoria: no requiere índice compuesto. */
export function useCompanyOrders(companyId: string | undefined) {
  const state = useQueryData<WorkOrder>(
    companyId ? query(collection(db, orderCol.workOrders(TENANT_ID)), where("companyId", "==", companyId), limit(2000)) : null,
    `company-orders-${companyId}`,
  );
  const data = useMemo(() => [...state.data].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)), [state.data]);
  return { ...state, data };
}

/** Recibos de pago de órdenes de la empresa. */
export function useCompanyPaymentsReceived(companyId: string | undefined, enabled = true) {
  const state = useQueryData<Payment>(
    companyId && enabled ? query(collection(db, catalogCol.payments(TENANT_ID)), where("companyId", "==", companyId), limit(3000)) : null,
    `company-receipts-${companyId}-${enabled}`,
  );
  const data = useMemo(() => [...state.data].sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0)), [state.data]);
  return { ...state, data };
}

/** Pagos de empresa (repartidos entre varias órdenes). */
export function useCompanyPayments(companyId: string | undefined) {
  const state = useQueryData<CompanyPayment>(
    companyId ? query(collection(db, companyCol.companyPayments(TENANT_ID)), where("companyId", "==", companyId), limit(500)) : null,
    `company-payments-${companyId}`,
  );
  const data = useMemo(() => [...state.data].sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0)), [state.data]);
  return { ...state, data };
}

/** Ventas (carwash y mostrador) de vehículos de la empresa. */
export function useCompanySales(companyId: string | undefined, enabled = true) {
  return useQueryData<Sale>(
    companyId && enabled ? query(collection(db, catalogCol.sales(TENANT_ID)), where("companyId", "==", companyId), limit(2000)) : null,
    `company-sales-${companyId}-${enabled}`,
  );
}

/** Mantenimientos de los vehículos de la flota (consultas `in` de 30, sin tiempo real). */
export function useFleetMaintenance(vehicleIds: string[]) {
  const key = useMemo(() => [...new Set(vehicleIds)].sort().join(","), [vehicleIds]);
  const [state, setState] = useState<{ data: Maintenance[]; loading: boolean }>({ data: [], loading: false });
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!ids.length) {
      setState({ data: [], loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    Promise.all(chunks.map((c) => getDocs(query(collection(db, opsCol.maintenance(TENANT_ID)), where("vehicleId", "in", c)))))
      .then((snaps) => alive && setState({ data: snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as Maintenance)), loading: false }))
      .catch(() => alive && setState({ data: [], loading: false }));
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

// ---------- Vencimientos y estado de cuenta ----------
export interface DueOrder {
  order: WorkOrder;
  dueKey: string | null;
  deliveredAt: number | null;
}

/** Órdenes con su vencimiento según la forma de pago de la empresa. */
export function withDue(company: Company | null | undefined, orders: WorkOrder[]): DueOrder[] {
  return orders.map((o) => {
    const at = o.status === "DELIVERED" ? deliveredMs(o) : null;
    return { order: o, deliveredAt: at, dueKey: orderDueKey(company ?? null, at) };
  });
}

export const keyLabel = (key: string | null | undefined) => {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};
