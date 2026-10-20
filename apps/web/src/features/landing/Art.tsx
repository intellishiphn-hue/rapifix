/**
 * Arte original en SVG para la landing (sin fotos de terceros ni marcas de autos).
 * Siluetas genéricas y estilizadas, pensadas para leerse como ilustración.
 */
import { useId } from "react";

/** Vehículo del hero: silueta de estudio con reflejo, línea de luz roja y barrido de escaneo */
export function HeroCar({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const body = `M112 334 C100 318 98 296 104 282 C110 262 124 248 150 242 L238 226 C292 214 332 196 380 168 C424 142 458 128 520 122 L700 120 C764 122 806 140 852 176 C878 196 900 208 940 214 L1040 228 C1076 234 1100 250 1108 276 C1114 296 1112 318 1100 334 L1010 334 A80 80 0 0 0 850 334 L380 334 A80 80 0 0 0 220 334 Z`;
  return (
    <svg viewBox="0 0 1200 470" className={className} role="img" aria-label="Ilustración de un vehículo en un estudio con iluminación">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a4fb8" />
          <stop offset="0.38" stopColor="#0d2470" />
          <stop offset="0.7" stopColor="#051447" />
          <stop offset="1" stopColor="#010822" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#cfe0ff" stopOpacity="0.55" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fb0ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0b1d5c" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#dfe6f5" />
          <stop offset="0.55" stopColor="#8e9bb8" />
          <stop offset="0.8" stopColor="#3a4766" />
          <stop offset="1" stopColor="#141c33" />
        </radialGradient>
        <radialGradient id={`${id}f`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#3b8cff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#1b4fc4" stopOpacity="0.18" />
          <stop offset="1" stopColor="#011955" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}scan`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b8cff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#9cc3ff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#3b8cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}m`}>
          <rect x="0" y="334" width="1200" height="136" fill={`url(#${id}fade)`} />
        </mask>
        <clipPath id={`${id}c`}>
          <path d={body} />
        </clipPath>
        <g id={`${id}w`}>
          <circle r="64" fill="#03060f" />
          <circle r="60" fill="none" stroke="#1d2640" strokeWidth="3" />
          <circle r="44" fill={`url(#${id}r)`} />
          <g stroke="#0b1226" strokeWidth="7" strokeLinecap="round">
            <path d="M0 -12 L0 -40" />
            <path d="M11.4 -3.7 L38 -12.4" />
            <path d="M7 9.7 L23.5 32.4" />
            <path d="M-7 9.7 L-23.5 32.4" />
            <path d="M-11.4 -3.7 L-38 -12.4" />
          </g>
          <path d="M-30 -24 A38 38 0 0 1 4 -38" stroke="#EA0101" strokeWidth="7" fill="none" strokeLinecap="round" />
          <circle r="10" fill="#0b1226" />
          <circle r="4" fill="#9aa6c2" />
        </g>
      </defs>

      {/* Luz del piso */}
      <ellipse cx="610" cy="352" rx="560" ry="46" fill={`url(#${id}f)`} />

      {/* Reflejo en el piso */}
      <g mask={`url(#${id}m)`} opacity="0.9">
        <g transform="translate(0 668) scale(1 -1)">
          <path d={body} fill={`url(#${id}b)`} />
          <use href={`#${id}w`} x="300" y="334" />
          <use href={`#${id}w`} x="930" y="334" />
        </g>
      </g>

      <g className="lp-car-body">
        {/* Carrocería */}
        <path d={body} fill={`url(#${id}b)`} />
        {/* Ventanas */}
        <path d="M352 210 C404 182 444 158 486 146 C506 141 528 139 552 139 L694 138 C744 140 780 156 820 186 L838 202 Z" fill={`url(#${id}g)`} opacity="0.95" />
        <path d="M640 139 L652 139 L660 205 L646 205 Z" fill="#06123d" />
        {/* Reflejo especular superior */}
        <g clipPath={`url(#${id}c)`}>
          <path d="M150 250 C330 222 420 176 520 150 C600 130 720 128 820 160 C880 180 930 214 1060 236 L1060 246 C930 226 860 196 800 176 C700 146 600 150 520 168 C430 190 330 236 150 262 Z" fill={`url(#${id}s)`} opacity="0.32" />
          <rect className="lp-car-scan" x="-220" y="80" width="200" height="300" fill={`url(#${id}scan)`} />
        </g>
        {/* Línea de luz (hombro) */}
        <path className="lp-car-line" pathLength={1} d="M126 270 C330 258 560 248 760 246 C900 246 1000 252 1094 272" fill="none" stroke="#EA0101" strokeWidth="3.5" strokeLinecap="round" />
        {/* Faros y calaveras */}
        <path d="M1046 246 C1070 248 1090 256 1100 268" stroke="#bfe0ff" strokeWidth="6" strokeLinecap="round" fill="none" className="lp-car-lamp" />
        <path d="M104 268 C112 258 124 252 140 250" stroke="#ff2a2a" strokeWidth="6" strokeLinecap="round" fill="none" />
        {/* Línea de puertas */}
        <path d="M520 214 L524 318 M760 210 L758 318" stroke="#000a2b" strokeOpacity="0.7" strokeWidth="2" />
        <path d="M352 212 L840 204" stroke="#6f97ff" strokeOpacity="0.35" strokeWidth="1.5" />
        {/* Ruedas */}
        <use href={`#${id}w`} x="300" y="334" />
        <use href={`#${id}w`} x="930" y="334" />
      </g>
    </svg>
  );
}

/** Tres vehículos de trabajo en línea (flotilla), trazo fino */
export function FleetLineup({ className }: { className?: string }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const wheel = (x: number, y: number) => (
    <g>
      <circle cx={x} cy={y} r="17" {...stroke} />
      <circle cx={x} cy={y} r="6" {...stroke} />
    </g>
  );
  return (
    <svg viewBox="0 0 720 200" className={className} aria-hidden>
      {/* Pick-up */}
      <g transform="translate(10 40)">
        <path d="M8 112 L8 84 L30 80 L58 48 L118 46 L124 80 L210 80 L212 112 Z" {...stroke} />
        <path d="M66 54 L112 52 L116 78 L44 80 Z" {...stroke} opacity="0.6" />
        {wheel(52, 114)}
        {wheel(176, 114)}
      </g>
      {/* Panel */}
      <g transform="translate(250 22)">
        <path d="M6 130 L6 44 C6 30 16 22 30 22 L150 22 C164 22 172 30 176 44 L200 92 L206 130 Z" {...stroke} />
        <path d="M150 34 L170 46 L188 88 L150 88 Z" {...stroke} opacity="0.6" />
        <path d="M100 30 L100 124" {...stroke} opacity="0.4" />
        {wheel(50, 132)}
        {wheel(164, 132)}
      </g>
      {/* Sedán */}
      <g transform="translate(486 58)">
        <path d="M6 94 C4 84 6 74 16 70 L60 62 C82 46 102 34 130 32 L176 32 C196 34 210 46 222 62 L236 90 L234 96 Z" {...stroke} />
        <path d="M74 62 C92 48 108 42 128 40 L172 40 C186 42 196 50 206 62 Z" {...stroke} opacity="0.6" />
        {wheel(56, 96)}
        {wheel(190, 96)}
      </g>
      <path d="M0 172 L720 172" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="2 8" />
    </svg>
  );
}

/** Motivos para las tarjetas destacadas del catálogo */
export function Motif({ kind, className }: { kind: "mantenimiento" | "frenos" | "diagnostico" | "aire" | "flotillas"; className?: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "mantenimiento") {
    // Tacómetro: el engrane del logo convertido en indicador de kilometraje
    const ticks = Array.from({ length: 23 }, (_, i) => -210 + i * 11.8);
    return (
      <svg viewBox="0 0 240 240" className={className} aria-hidden>
        <circle cx="120" cy="120" r="96" {...s} strokeWidth="1.5" opacity="0.35" />
        {ticks.map((a, i) => {
          const r1 = i % 4 === 0 ? 72 : 80;
          const rad = (a * Math.PI) / 180;
          return <line key={i} x1={120 + Math.cos(rad) * r1} y1={120 + Math.sin(rad) * r1} x2={120 + Math.cos(rad) * 88} y2={120 + Math.sin(rad) * 88} {...s} strokeWidth={i % 4 === 0 ? 3 : 1.5} opacity={i > 17 ? 1 : 0.55} className={i > 17 ? "text-[var(--lp-red)]" : undefined} />;
        })}
        <path d="M120 120 L170 74" {...s} strokeWidth="5" className="lp-needle" />
        <circle cx="120" cy="120" r="9" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "frenos") {
    const holes = Array.from({ length: 12 }, (_, i) => (i * 30 * Math.PI) / 180);
    return (
      <svg viewBox="0 0 240 240" className={className} aria-hidden>
        <circle cx="120" cy="120" r="92" {...s} strokeWidth="2" />
        <circle cx="120" cy="120" r="70" {...s} strokeWidth="1.5" opacity="0.5" />
        <circle cx="120" cy="120" r="30" {...s} strokeWidth="2" />
        {holes.map((a, i) => <circle key={i} cx={120 + Math.cos(a) * 82} cy={120 + Math.sin(a) * 82} r="3.2" fill="currentColor" opacity="0.6" />)}
        {[0, 72, 144, 216, 288].map((d) => {
          const a = (d * Math.PI) / 180;
          return <circle key={d} cx={120 + Math.cos(a) * 18} cy={120 + Math.sin(a) * 18} r="4" fill="currentColor" />;
        })}
        <path d="M168 40 C206 58 226 92 226 130 L196 130 C196 104 184 82 160 66 Z" fill="#EA0101" />
      </svg>
    );
  }
  if (kind === "diagnostico") {
    return (
      <svg viewBox="0 0 320 140" className={className} aria-hidden>
        {[20, 50, 80, 110].map((y) => <line key={y} x1="0" x2="320" y1={y} y2={y} {...s} strokeWidth="1" opacity="0.18" />)}
        <path className="lp-wave" pathLength={1} d="M0 82 L40 82 L56 82 L66 40 L78 118 L90 64 L100 82 L150 82 L162 70 L172 94 L182 82 L232 82 L244 30 L256 124 L268 82 L320 82" {...s} strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "aire") {
    return (
      <svg viewBox="0 0 320 140" className={className} aria-hidden>
        {[28, 58, 88, 118].map((y, i) => (
          <path key={y} d={`M0 ${y} C60 ${y - 18} 110 ${y + 18} 170 ${y} S280 ${y - 14} 320 ${y}`} {...s} strokeWidth={i === 1 ? 3 : 1.6} opacity={i === 1 ? 1 : 0.45} />
        ))}
      </svg>
    );
  }
  return <FleetLineup className={className} />;
}
