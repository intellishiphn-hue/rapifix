import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, query, Timestamp, where, type QueryConstraint } from "firebase/firestore";
import { quoteCol, type Quote, type QuoteItem, type WorkOrder } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { toDate } from "@/lib/format";

/** Lee una colección completa con restricciones (sin tiempo real). */
export async function fetchAll<T>(path: string, ...constraints: QueryConstraint[]): Promise<T[]> {
  const snap = await getDocs(query(collection(db, path), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

/** Documentos cuyo campo de fecha está en [start, end). Un solo campo de rango: no requiere índices compuestos. */
export function fetchRange<T>(path: string, field: string, start: Date, end: Date, max = 5000): Promise<T[]> {
  return fetchAll<T>(path, where(field, ">=", Timestamp.fromDate(start)), where(field, "<", Timestamp.fromDate(end)), limit(max));
}

/**
 * Cotización aprobada que corresponde a cada orden (la activa si está aprobada; si no, la aprobada más reciente).
 * Consulta por orderId en bloques de 30 y filtra el estado en memoria.
 */
export async function fetchApprovedQuotes(orders: Array<Pick<WorkOrder, "id" | "activeQuoteId">>): Promise<Map<string, Quote>> {
  const ids = [...new Set(orders.map((o) => o.id))];
  const active = new Map(orders.map((o) => [o.id, o.activeQuoteId ?? null]));
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results = await Promise.all(chunks.map((c) => fetchAll<Quote>(quoteCol.quotes(TENANT_ID), where("orderId", "in", c))));
  const out = new Map<string, Quote>();
  for (const q of results.flat()) {
    if (q.status !== "approved" || !q.orderId) continue;
    const prev = out.get(q.orderId);
    const isActive = active.get(q.orderId) === q.id;
    if (!prev || isActive || (active.get(q.orderId) !== prev.id && (toDate(q.createdAt)?.getTime() ?? 0) > (toDate(prev.createdAt)?.getTime() ?? 0))) {
      out.set(q.orderId, q);
    }
  }
  return out;
}

export interface TechStats {
  id: string;
  name: string;
  open: number;
  delivered: number;
  /** horas de mano de obra facturadas (líneas "labor"), repartidas entre los técnicos de la orden */
  hours: number;
  laborIncome: number;
  serviceIncome: number;
  orders: Array<Pick<WorkOrder, "id" | "code" | "status" | "vehicle" | "customer">>;
}

const labor = (it: QuoteItem) => it.type === "labor";

/** Estadísticas por técnico. Horas e ingresos se reparten en partes iguales si la orden tiene varios técnicos. */
export function techStats(openOrders: WorkOrder[], delivered: WorkOrder[], quotes: Map<string, Quote>): Map<string, TechStats> {
  const map = new Map<string, TechStats>();
  const get = (id: string, name: string) => {
    let s = map.get(id);
    if (!s) {
      s = { id, name, open: 0, delivered: 0, hours: 0, laborIncome: 0, serviceIncome: 0, orders: [] };
      map.set(id, s);
    }
    if (!s.name && name) s.name = name;
    return s;
  };
  const nameOf = (o: WorkOrder, id: string) => o.technicians?.find((t) => t.id === id)?.name ?? "";

  for (const o of openOrders) {
    for (const id of o.technicianIds ?? []) {
      const s = get(id, nameOf(o, id));
      s.open++;
      s.orders.push({ id: o.id, code: o.code, status: o.status, vehicle: o.vehicle, customer: o.customer });
    }
  }
  for (const o of delivered) {
    const techs = o.technicianIds ?? [];
    if (!techs.length) continue;
    const q = quotes.get(o.id);
    const items = q?.items ?? [];
    const hours = items.filter(labor).reduce((a, it) => a + it.qty, 0);
    const laborIncome = items.filter(labor).reduce((a, it) => a + it.lineTotal, 0);
    const serviceIncome = items.filter((it) => it.type === "service").reduce((a, it) => a + it.lineTotal, 0);
    const n = techs.length;
    for (const id of techs) {
      const s = get(id, nameOf(o, id));
      s.delivered++;
      s.hours += hours / n;
      s.laborIncome += Math.round(laborIncome / n);
      s.serviceIncome += Math.round(serviceIncome / n);
    }
  }
  return map;
}

/** Carga asíncrona con estado, recarga cuando cambia `key`. */
export function useLoader<T>(loader: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const ref = useRef(loader);
  ref.current = loader;
  const run = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    ref
      .current()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((err) => {
        console.error("[Reporte]", key, err);
        if (alive) setState({ data: null, loading: false, error: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [key]);
  useEffect(() => run(), [run]);
  return state;
}

export const sumBy = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + (f(x) || 0), 0);
