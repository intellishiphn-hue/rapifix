import { useCallback, useEffect, useRef, useState } from "react";
import { getCountFromServer, getDocs, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import type { WorkOrder } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { ordersCol, useScope } from "./api";

/** Órdenes por consulta. Si el período trae más, se avisa y se ofrece "Cargar más". */
export const HISTORY_PAGE = 500;

interface HistoryState {
  orders: WorkOrder[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** El período tiene más órdenes de las cargadas */
  hasMore: boolean;
  loadedAt: Date | null;
}

/**
 * Órdenes entregadas con fecha de entrega en [start, end), de la más reciente a la más vieja.
 * Un solo campo de rango (deliveredAt): no necesita índice compuesto para el personal.
 * El estado (por si una orden fue reabierta) y los demás filtros se aplican en memoria.
 * Sin tiempo real: se recarga con `reload`.
 */
export function useDeliveredHistory(start: Date, end: Date) {
  const scope = useScope();
  const key = `${scope.key}|${start.getTime()}|${end.getTime()}`;
  const [state, setState] = useState<HistoryState>({ orders: [], loading: true, loadingMore: false, error: null, hasMore: false, loadedAt: null });
  const run = useRef(0);
  const cursor = useRef<Timestamp | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const fetchPage = useCallback(async (before: Timestamp) => {
    const snap = await getDocs(query(
      ordersCol(), ...scopeRef.current.constraints,
      where("deliveredAt", ">=", Timestamp.fromDate(start)), where("deliveredAt", "<", before),
      orderBy("deliveredAt", "desc"), limit(HISTORY_PAGE),
    ));
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder);
    return { docs, last: docs.at(-1)?.deliveredAt as Timestamp | undefined, full: docs.length >= HISTORY_PAGE };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchPage(Timestamp.fromDate(end))
      .then((p) => {
        if (id !== run.current) return;
        cursor.current = p.last ?? null;
        setState({ orders: p.docs.filter((o) => o.status === "DELIVERED"), loading: false, loadingMore: false, error: null, hasMore: p.full, loadedAt: new Date() });
      })
      .catch((err) => {
        console.error("[Historial]", err);
        if (id === run.current) setState({ orders: [], loading: false, loadingMore: false, error: errorMessage(err), hasMore: false, loadedAt: null });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage]);

  useEffect(() => reload(), [reload]);

  const loadMore = useCallback(() => {
    if (!cursor.current) return;
    const id = run.current;
    setState((s) => ({ ...s, loadingMore: true }));
    fetchPage(cursor.current)
      .then((p) => {
        if (id !== run.current) return;
        cursor.current = p.last ?? cursor.current;
        setState((s) => {
          const seen = new Set(s.orders.map((o) => o.id));
          return { ...s, orders: [...s.orders, ...p.docs.filter((o) => o.status === "DELIVERED" && !seen.has(o.id))], loadingMore: false, hasMore: p.full };
        });
      })
      .catch((err) => {
        console.error("[Historial]", err);
        if (id === run.current) setState((s) => ({ ...s, loadingMore: false, error: errorMessage(err) }));
      });
  }, [fetchPage]);

  return { ...state, reload, loadMore };
}

/**
 * Cantidad de órdenes entregadas desde `since` (para el enlace del tablero). Usa el índice
 * status + deliveredAt que ya existe. null si no aplica (técnico) o si falla: el enlace se muestra sin número.
 */
export function useDeliveredCount(since: Date, refreshKey: string | number) {
  const scope = useScope();
  const [count, setCount] = useState<number | null>(null);
  const staff = scope.key === "all";
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    getCountFromServer(query(ordersCol(), where("status", "==", "DELIVERED"), where("deliveredAt", ">=", Timestamp.fromDate(since))))
      .then((snap) => alive && setCount(snap.data().count))
      .catch(() => alive && setCount(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, since.getTime(), refreshKey]);
  return staff ? count : null;
}
