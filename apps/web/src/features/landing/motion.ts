import { useEffect, useRef, useState, type RefObject } from "react";

const mq = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

/** true si el usuario pidió reducir el movimiento (se actualiza en vivo) */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => !!mq("(prefers-reduced-motion: reduce)")?.matches);
  useEffect(() => {
    const m = mq("(prefers-reduced-motion: reduce)");
    if (!m) return;
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Puntero preciso (mouse/trackpad) y sin movimiento reducido: habilita tilt y parallax */
export const finePointer = () => !!mq("(hover: hover) and (pointer: fine)")?.matches && !mq("(prefers-reduced-motion: reduce)")?.matches;

/**
 * Revela los elementos [data-reveal] dentro del contenedor cuando entran en pantalla.
 * Un solo IntersectionObserver por página. Sin JS o con movimiento reducido, el CSS los muestra igual.
 */
export function useRevealAll(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    el.classList.add("lp-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/**
 * Progreso de desplazamiento (0 a 1) de un elemento a través de la ventana, con rAF.
 * Solo escucha el scroll mientras el elemento está visible.
 */
export function useScrollProgress<T extends HTMLElement>(onProgress: (p: number) => void, deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onProgress);
  cb.current = onProgress;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let listening = false;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 cuando el inicio del elemento llega al 70% de la ventana; 1 cuando su final pasa ese punto
      const start = vh * 0.7;
      const p = (start - r.top) / Math.max(1, r.height);
      cb.current(Math.min(1, Math.max(0, p)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !listening) {
        listening = true;
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        onScroll();
      } else if (!e?.isIntersecting && listening) {
        listening = false;
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        measure();
      }
    });
    io.observe(el);
    measure();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/**
 * Inclinación suave de una tarjeta siguiendo el puntero (solo puntero preciso).
 * Escribe --rx/--ry/--mx/--my en el elemento; el CSS decide cuánto usar.
 */
export function tiltHandlers() {
  let raf = 0;
  return {
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType !== "mouse" || !finePointer()) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${(x - 0.5) * 5}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * 4}deg`);
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
      });
    },
    onPointerLeave(e: React.PointerEvent<HTMLElement>) {
      if (raf) cancelAnimationFrame(raf);
      const el = e.currentTarget;
      el.style.removeProperty("--ry");
      el.style.removeProperty("--rx");
    },
  };
}
