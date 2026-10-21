/**
 * Camioneta 4x4 original de RAPIFIX en vista lateral (perfil), para la "Revisión multipuntos".
 * Diseño propio: no reproduce ningún modelo ni marca. Cada parte es un grupo con clase propia
 * (.mp-hood, .mp-wheel, .mp-lights, .mp-cabin, .mp-exhaust, .mp-under) para animarla con CSS
 * (transform/opacity) según la zona activa.
 */

export const TRUCK_W = 1400;
export const TRUCK_H = 650;

/** Coordenadas (en el viewBox) de cada zona interactiva */
export const ZONE_POINTS = {
  hood: { x: 1095, y: 300 },
  wheels: { x: 1060, y: 500 },
  lights: { x: 1252, y: 352 },
  cabin: { x: 760, y: 262 },
  exhaust: { x: 214, y: 486 },
  under: { x: 705, y: 500 },
} as const;

const GROUND = 600;
const RW = 100; // radio de llanta
const RIM = 64;
const AR = 124; // radio del arco
const REAR = { x: 360, y: 500 };
const FRONT = { x: 1060, y: 500 };

const f = (n: number) => Math.round(n * 10) / 10;
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 28): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy - Math.sin(a) * r]);
  }
  return out;
}
const pts = (p: Array<[number, number]>) => p.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L");

// Contorno del costado (de la cola baja, en sentido horario) con los arcos de rueda recortados
const archY = 470;
const ARCH_DX = Math.sqrt(AR * AR - (archY - REAR.y) ** 2);
const BODY = [
  `M206 ${archY}`,
  "L199 432 L198 324",
  "L938 318", // línea de cintura (el invernadero se dibuja aparte)
  "L1236 324 Q1254 326 1256 344", // capó y esquina frontal
  "L1258 436 L1250 452",
  `L${f(FRONT.x + ARCH_DX)} ${archY}`,
  `L${pts(arc(FRONT.x, FRONT.y, AR, 14, 166))}`,
  `L${f(REAR.x + ARCH_DX)} ${archY}`,
  `L${pts(arc(REAR.x, REAR.y, AR, 14, 166))}`,
  "Z",
].join(" ");

const flare = (cx: number, cy: number) => {
  const outer = arc(cx, cy, AR + 22, 6, 174);
  const inner = arc(cx, cy, AR, 174, 6);
  return `M${pts(outer)} L${pts(inner)} Z`;
};

function Wheel({ cx, cy, id, front }: { cx: number; cy: number; id: string; front?: boolean }) {
  const spokes = Array.from({ length: 6 }, (_, k) => {
    const a = (k * 60 * Math.PI) / 180;
    const p = (ang: number, r: number) => `${f(cx + Math.cos(ang) * r)} ${f(cy + Math.sin(ang) * r)}`;
    return `M${p(a - 0.17, RIM - 4)} L${p(a + 0.17, RIM - 4)} L${p(a + 0.24, 20)} L${p(a - 0.24, 20)} Z`;
  }).join("");
  const lugs = Array.from({ length: 6 }, (_, k) => {
    const a = ((k * 60 + 30) * Math.PI) / 180;
    return <circle key={k} cx={f(cx + Math.cos(a) * 13)} cy={f(cy + Math.sin(a) * 13)} r="2.6" fill="#0a1226" />;
  });
  // Tacos del neumático todoterreno
  const lugsTread = Array.from({ length: 30 }, (_, k) => {
    const a = (k * 12 * Math.PI) / 180;
    const p = (ang: number, r: number) => `${f(cx + Math.cos(ang) * r)} ${f(cy + Math.sin(ang) * r)}`;
    return `M${p(a - 0.07, RW)} L${p(a + 0.07, RW)} L${p(a + 0.06, RW - 9)} L${p(a - 0.06, RW - 9)} Z`;
  }).join("");
  return (
    <g className={front ? "mp-wheel mp-wheel-front" : "mp-wheel mp-wheel-rear"}>
      <circle cx={cx} cy={cy} r={RW} fill={`url(#${id}-tire)`} />
      <path d={lugsTread} fill="#1a2238" />
      <circle cx={cx} cy={cy} r={RW - 22} fill="none" stroke="#232c46" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={RIM + 3} fill="#0b1124" />
      {/* disco y caliper (el caliper se ilumina al activar la zona) */}
      <circle cx={cx} cy={cy} r={RIM - 10} fill={`url(#${id}-disc)`} />
      <path className="mp-caliper" d={`M${pts(arc(cx, cy, RIM - 8, 20, 78, 10))} L${pts(arc(cx, cy, RIM - 30, 78, 20, 10))} Z`} fill="#ea0101" />
      <g className="mp-rim" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={RIM} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="7" />
        <path d={spokes} fill={`url(#${id}-spoke)`} />
        <circle cx={cx} cy={cy} r="21" fill={`url(#${id}-rim)`} />
        {lugs}
        <circle cx={cx} cy={cy} r="6" fill="#c9d6f2" />
      </g>
    </g>
  );
}

export function TruckArt({ className, viewBox = `0 0 ${TRUCK_W} ${TRUCK_H}` }: { className?: string; viewBox?: string }) {
  const id = "mp";
  const front = FRONT;
  const rear = REAR;
  return (
    <svg viewBox={viewBox} className={className} role="img" aria-label="Ilustración de una camioneta 4x4 con las zonas que revisamos">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a68dc" />
          <stop offset=".28" stopColor="#1c43a8" />
          <stop offset=".62" stopColor="#0c287a" />
          <stop offset="1" stopColor="#04103e" />
        </linearGradient>
        <linearGradient id={`${id}-hood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7aa2f4" />
          <stop offset="1" stopColor="#1f47ad" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4573dc" />
          <stop offset=".45" stopColor="#0d205e" />
          <stop offset="1" stopColor="#040b28" />
        </linearGradient>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#cfe0ff" stopOpacity=".05" />
          <stop offset=".6" stopColor="#cfe0ff" stopOpacity=".5" />
          <stop offset="1" stopColor="#cfe0ff" stopOpacity=".1" />
        </linearGradient>
        <radialGradient id={`${id}-tire`} cx=".5" cy=".5" r=".5">
          <stop offset=".72" stopColor="#0d1222" />
          <stop offset="1" stopColor="#04060d" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8eefc" />
          <stop offset=".5" stopColor="#8495bb" />
          <stop offset="1" stopColor="#36425f" />
        </linearGradient>
        <linearGradient id={`${id}-spoke`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f7ff" />
          <stop offset=".55" stopColor="#a5b4d6" />
          <stop offset="1" stopColor="#4a5878" />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx=".5" cy=".5" r=".5">
          <stop offset=".5" stopColor="#56617f" />
          <stop offset="1" stopColor="#262e4a" />
        </radialGradient>
        <radialGradient id={`${id}-shadow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#011955" stopOpacity=".45" />
          <stop offset="1" stopColor="#011955" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dcebff" stopOpacity=".9" />
          <stop offset="1" stopColor="#3b8cff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-scan`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b8cff" stopOpacity="0" />
          <stop offset=".7" stopColor="#3b8cff" stopOpacity=".35" />
          <stop offset="1" stopColor="#9cc3ff" stopOpacity=".95" />
        </linearGradient>
        <linearGradient id={`${id}-reflect`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-refmask`}>
          <rect x="0" y={GROUND} width={TRUCK_W} height={TRUCK_H - GROUND} fill={`url(#${id}-reflect)`} />
        </mask>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${id}-blur`}>
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${id}-mist`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Sombra y reflejo en el piso pulido */}
      <ellipse cx="730" cy={GROUND + 4} rx="620" ry="26" fill={`url(#${id}-shadow)`} />
      <g mask={`url(#${id}-refmask)`} filter={`url(#${id}-blur)`} transform={`translate(0 ${GROUND * 2}) scale(1 -1)`} opacity=".9">
        <path d={BODY} fill={`url(#${id}-body)`} />
        <circle cx={rear.x} cy={rear.y} r={RW} fill="#0b1020" />
        <circle cx={front.x} cy={front.y} r={RW} fill="#0b1020" />
      </g>

      <g className="mp-truck">
        {/* Rueda de repuesto en el portón */}
        <circle cx="178" cy="330" r="74" fill="#070c1d" />
        <circle cx="178" cy="330" r="52" fill="none" stroke="#1d2744" strokeWidth="10" />
        <circle cx="178" cy="330" r="30" fill="#0e1630" />

        {/* Bajos: tren motriz (se resalta al activar la zona) */}
        <g className="mp-under">
          <path d="M470 494 L948 488" stroke="#152043" strokeWidth="12" strokeLinecap="round" />
          <rect x="742" y="468" width="70" height="36" rx="8" fill="#101a3a" />
          <path d="M240 500 L470 494 M948 488 L1170 496" stroke="#101a3a" strokeWidth="8" strokeLinecap="round" />
          <g className="mp-under-glow">
            <path d="M470 494 L948 488" stroke="#3b8cff" strokeWidth="4" strokeLinecap="round" filter={`url(#${id}-glow)`} />
            <rect x="742" y="468" width="70" height="36" rx="8" fill="none" stroke="#3b8cff" strokeWidth="3" />
            <path d="M960 490 L1150 496" stroke="#3b8cff" strokeWidth="3" strokeLinecap="round" opacity=".8" />
          </g>
        </g>

        {/* Escape y bruma */}
        <g className="mp-exhaust">
          <path d="M214 482 L330 486" stroke="#121a34" strokeWidth="9" strokeLinecap="round" />
          <rect x="198" y="476" width="22" height="13" rx="4" fill="#9aa7c4" />
          <g className="mp-mist" filter={`url(#${id}-mist)`}>
            <circle className="mp-puff mp-puff-1" cx="186" cy="482" r="12" fill="#b9c7e4" />
            <circle className="mp-puff mp-puff-2" cx="176" cy="478" r="16" fill="#c9d4ec" />
            <circle className="mp-puff mp-puff-3" cx="166" cy="474" r="20" fill="#dbe3f4" />
          </g>
        </g>

        {/* Motor estilizado (se ve al levantar el capó) */}
        <g className="mp-engine">
          <path d="M960 330 L968 300 L1150 300 L1170 330 Z" fill="#141d3a" />
          <rect x="985" y="292" width="150" height="20" rx="6" fill="#2a3968" />
          <path d="M1000 292 L1000 284 M1030 292 L1030 284 M1060 292 L1060 284 M1090 292 L1090 284 M1120 292 L1120 284" stroke="#ea0101" strokeWidth="5" strokeLinecap="round" />
          <circle cx="1185" cy="306" r="12" fill="#0e1630" stroke="#5f86e8" strokeWidth="2" />
          <rect x="1205" y="296" width="24" height="34" rx="4" fill="#1b2a5e" stroke="#5f86e8" strokeWidth="1.5" />
        </g>

        {/* Cabina: estructura oscura, vidrios y techo */}
        <path d="M940 316 L836 196 L222 200 Q198 206 198 236 L198 322 Z" fill="#030822" />
        <path d="M222 188 L838 184 L836 197 L222 200 Z" fill={`url(#${id}-body)`} />
        <path d="M904 318 L826 214 L668 214 L668 318 Z" fill={`url(#${id}-glass)`} />
        <path d="M650 318 L650 214 L470 214 L470 318 Z" fill={`url(#${id}-glass)`} />
        <path d="M450 318 L450 214 L238 216 Q216 220 216 244 L216 318 Z" fill={`url(#${id}-glass)`} />
        <path d="M720 318 L790 214 L812 214 L742 318 Z M540 318 L590 214 L600 214 L550 318 Z" fill="#a9c8ff" opacity=".12" />
        {/* Parrilla de techo */}
        <path d="M262 172 L800 170" stroke="#1a2650" strokeWidth="6" strokeLinecap="round" />
        <path d="M290 172 L290 186 M480 171 L480 186 M640 171 L640 185 M780 170 L780 185" stroke="#1a2650" strokeWidth="5" />

        {/* Aire acondicionado: ondas frías dentro de la cabina */}
        <g className="mp-air">
          <path className="mp-wave mp-wave-1" d="M720 250 C750 236 780 264 810 250" stroke="#bfe0ff" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path className="mp-wave mp-wave-2" d="M690 276 C724 262 758 290 792 276" stroke="#bfe0ff" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path className="mp-wave mp-wave-3" d="M560 262 C590 248 620 276 650 262" stroke="#bfe0ff" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </g>

        {/* Pasos de rueda oscuros */}
        <circle cx={front.x} cy={front.y} r={AR} fill="#040919" />
        <circle cx={rear.x} cy={rear.y} r={AR} fill="#040919" />
        {/* Carrocería */}
        <path d={BODY} fill={`url(#${id}-body)`} />
        <path d="M210 336 L1240 342 L1240 356 L210 350 Z" fill={`url(#${id}-band)`} />
        <path d="M206 420 L1250 426" stroke="#000a2b" strokeOpacity=".35" strokeWidth="2" />
        <path d={flare(front.x, front.y)} fill="#050a1c" />
        <path d={flare(rear.x, rear.y)} fill="#050a1c" />
        {/* Estribo con línea roja RAPIFIX */}
        <rect x="486" y="466" width="440" height="20" rx="6" fill="#070d22" />
        <path d="M500 472 L912 472" stroke="#ea0101" strokeWidth="3" strokeLinecap="round" />
        {/* Puertas, manijas y espejo */}
        <path d="M921 322 L938 466 M660 322 L660 466 M470 322 L470 420 Q470 446 486 462" stroke="#020722" strokeOpacity=".7" strokeWidth="2" fill="none" />
        <path d="M790 362 L840 362 M565 362 L615 362" stroke="#a9bce8" strokeOpacity=".7" strokeWidth="5" strokeLinecap="round" />
        <path d="M884 300 L918 296 L926 318 L892 322 Z" fill="#030822" />
        {/* Calavera trasera */}
        <rect x="196" y="244" width="10" height="80" rx="3" fill="#ea0101" filter={`url(#${id}-glow)`} opacity=".9" />
        {/* Defensa delantera con gancho de remolque */}
        <path d="M1226 440 L1290 440 Q1300 440 1300 450 L1300 476 Q1300 486 1290 486 L1226 486 Z" fill="#0a1230" />
        <path d="M1240 452 L1294 452" stroke="#3b5aa8" strokeOpacity=".6" strokeWidth="2" />
        <circle cx="1284" cy="472" r="7" fill="none" stroke="#ea0101" strokeWidth="4" />
        <rect x="1250" y="372" width="8" height="58" rx="3" fill="#060c24" />

        {/* Capó (gira en la bisagra junto al parabrisas) */}
        <g className="mp-hood">
          <path d="M940 314 L1236 324 Q1254 326 1256 340 L1252 344 L944 330 Z" fill={`url(#${id}-hood)`} />
          <path d="M960 318 L1230 327" stroke="#e6efff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* Faros LED (se encienden al activar la zona) */}
        <g className="mp-lights">
          <path className="mp-beam" d="M1258 346 L1400 300 L1400 420 Z" fill={`url(#${id}-beam)`} opacity="0" />
          <rect x="1226" y="346" width="32" height="12" rx="4" fill="#0a1436" />
          <path className="mp-led" d="M1228 352 L1256 352" stroke="#f4f9ff" strokeWidth="4" strokeLinecap="round" />
          <path className="mp-led-halo" d="M1228 352 L1256 352" stroke="#dbe9ff" strokeWidth="8" strokeLinecap="round" filter={`url(#${id}-glow)`} opacity=".35" />
        </g>

        <Wheel cx={rear.x} cy={rear.y} id={id} />
        <Wheel cx={front.x} cy={front.y} id={id} front />
      </g>

      {/* Línea de escáner que recorre el vehículo */}
      <g className="mp-scan" aria-hidden>
        <rect x="-120" y="120" width="120" height="500" fill={`url(#${id}-scan)`} />
        <rect x="-3" y="120" width="3" height="500" fill="#cfe2ff" />
      </g>
    </svg>
  );
}
