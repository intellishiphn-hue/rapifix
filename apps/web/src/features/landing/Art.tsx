/**
 * Arte original en SVG para la landing (sin fotos de terceros ni marcas de autos).
 * Siluetas genéricas y estilizadas, pensadas para leerse como ilustración.
 */
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
