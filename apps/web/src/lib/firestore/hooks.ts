import { useEffect, useState } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";
import { errorMessage } from "@/lib/errors";

export interface ListState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

/**
 * Suscripción en tiempo real a una consulta. key debe cambiar cuando cambia la consulta.
 * Si query es null no consulta (útil para condiciones).
 */
export function useQueryData<T>(query: Query | null, key: string): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ data: [], loading: !!query, error: null });

  useEffect(() => {
    if (!query) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const unsub = onSnapshot(
      query,
      (snap) => {
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T),
          loading: false,
          error: null,
        });
      },
      (err) => {
        console.error("[Firestore]", key, err);
        setState({ data: [], loading: false, error: errorMessage(err) });
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  exists: boolean;
}

export function useDocData<T>(ref: DocumentReference | null, key: string): DocState<T> {
  const [state, setState] = useState<DocState<T>>({ data: null, loading: !!ref, error: null, exists: false });

  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null, exists: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setState({
          data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null,
          loading: false,
          error: null,
          exists: snap.exists(),
        });
      },
      (err) => {
        console.error("[Firestore]", key, err);
        setState({ data: null, loading: false, error: errorMessage(err), exists: false });
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Valor con retraso (para búsquedas mientras se escribe) */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
