#!/usr/bin/env node
/**
 * Genera la ilustración del hero de la landing: SUV moderno en vista de tres cuartos dentro de un taller.
 *
 * El vehículo se modela con curvas 3D sencillas (frente redondeado, capó con caída, techo tipo coupé,
 * guardafangos marcados) y se proyecta con una cámara en perspectiva, así ruedas, capó, parabrisas
 * y reflejo en el piso quedan coherentes. El resultado es SVG estático: el navegador no calcula nada.
 *
 * Uso:  node tools/hero-art/generate-suv.mjs [--preview ruta.svg]
 * Escribe: apps/web/src/features/landing/HeroScene.tsx
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../apps/web/src/features/landing/HeroScene.tsx");
const previewArg = process.argv.indexOf("--preview");
const PREVIEW = previewArg > 0 ? process.argv[previewArg + 1] : null;

/* ------------------------------------------------------------ Cámara (teleobjetivo suave) */
const W = 1600;
const H = 1000;
const CAM = { pos: [-3.6, -9.6, 1.75], target: [2.25, 0, 0.66] };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const f = norm(sub(CAM.target, CAM.pos));
const r = norm(cross(f, [0, 0, 1]));
const u = cross(r, f);
let MIRROR = false;
function rawProject(p) {
  const q = MIRROR ? [p[0], p[1], -p[2]] : p;
  const d = sub(q, CAM.pos);
  const z = dot(d, f);
  return [dot(d, r) / z, -dot(d, u) / z];
}
// La caja del vehículo ocupa este tramo horizontal del lienzo y apoya en yGround
const FIT = { x0: 700, x1: 1585, yGround: 848 };
let S = 1;
let TX = 0;
let TY = 0;
function calibrate(points) {
  const pr = points.map(rawProject);
  const xs = pr.map((p) => p[0]);
  const ys = pr.map((p) => p[1]);
  S = (FIT.x1 - FIT.x0) / (Math.max(...xs) - Math.min(...xs));
  TX = FIT.x0 - Math.min(...xs) * S;
  TY = FIT.yGround - Math.max(...ys) * S;
}
const P = (p) => {
  const [x, y] = rawProject(p);
  return [x * S + TX, y * S + TY];
};
const fmt = (n) => Math.round(n).toString();
const toPath = (pts, close) => "M" + pts.map((p) => P(p)).map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + (close ? "Z" : "");
const poly = (pts) => toPath(pts, true);
const line = (pts) => toPath(pts, false);

/* ------------------------------------------------------------ Utilidades geométricas */
const lerp = (a, b, t) => a + (b - a) * t;
/** Arco en un plano lateral (y fijo). 0° = hacia el frente, 90° = arriba */
function arcXZ(cx, cz, y, rad, a0, a1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx - Math.cos(a) * rad, y, cz + Math.sin(a) * rad]);
  }
  return out;
}
const circleXZ = (cx, cz, y, rad, n = 64) => arcXZ(cx, cz, y, rad, 0, 360, n).slice(0, -1);
/** Bézier cúbica en 3D */
function bez(a, b, c, d, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    out.push([0, 1, 2].map((k) => m * m * m * a[k] + 3 * m * m * t * b[k] + 3 * m * t * t * c[k] + t * t * t * d[k]));
  }
  return out;
}
const join = (...parts) => parts.reduce((acc, p) => (acc.length ? acc.concat(p.slice(1)) : p.slice()), []);
const mirrorY = (pts) => pts.map(([x, y, z]) => [x, -y, z]).reverse();
function hull2d(points) {
  const pts = points.map(P).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of pts) {
    while (lo.length >= 2 && cz(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up = [];
  for (const p of pts.slice().reverse()) {
    while (up.length >= 2 && cz(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return "M" + lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + "Z";
}

/* ------------------------------------------------------------ Modelo del SUV (metros aprox.) */
// x: frente 0 a cola 4.72 · y: lado cercano negativo · z: altura
const YS = -0.96; // costado
const FA = 0.98; // eje delantero
const RA = 3.82; // eje trasero
const WR = 0.41; // radio de llanta
const AR = 0.5; // radio del arco
const AZ = 0.42; // altura del centro del arco
const BELT_F = 1.04; // línea de cintura delante (base del parabrisas)
const BELT_R = 1.12; // línea de cintura detrás
const beltZ = (x) => lerp(BELT_F, BELT_R, Math.max(0, Math.min(1, (x - 1.5) / 3)));
const ROOF_F = 1.56;
const ROOF_M = 1.575;
const yGlass = (z) => -0.91 + ((z - 1.05) * 0.18) / 0.52;

// Borde delantero del capó (de esquina cercana a esquina lejana), con esquinas muy redondeadas
const HOOD_EDGE_NEAR = bez([0.5, -0.95, 0.9], [0.24, -0.93, 0.88], [0.15, -0.74, 0.86], [0.15, -0.5, 0.855], 10);
const HOOD_EDGE = join(HOOD_EDGE_NEAR, [[0.15, -0.5, 0.855], [0.15, 0.5, 0.855]], mirrorY(HOOD_EDGE_NEAR));
// Borde inferior del parachoques
const BUMP_NEAR = bez([0.42, -0.95, 0.32], [0.2, -0.93, 0.3], [0.1, -0.75, 0.29], [0.1, -0.5, 0.29], 10);
const BUMP = join(BUMP_NEAR, [[0.1, -0.5, 0.29], [0.1, 0.5, 0.29]], mirrorY(BUMP_NEAR));
// Perfil de la esquina delantera cercana (de arriba hacia abajo)
const CORNER_NEAR = bez([0.5, -0.955, 0.9], [0.33, -0.955, 0.78], [0.3, -0.955, 0.5], [0.42, -0.955, 0.32], 10);

function sidePanel() {
  const pts = [];
  pts.push(...CORNER_NEAR.slice().reverse()); // desde abajo hacia arriba
  // hombro: del capó a la base del parabrisas y la cintura hacia atrás
  pts.push(...bez([0.5, YS, 0.9], [0.9, YS, 0.95], [1.3, YS, 1.02], [1.55, YS, BELT_F], 8).slice(1));
  for (let i = 1; i <= 10; i++) {
    const x = lerp(1.55, 4.46, i / 10);
    pts.push([x, YS, beltZ(x)]);
  }
  // cola: portón inclinado y parachoques trasero
  pts.push(...bez([4.46, YS, BELT_R], [4.62, YS, 1.1], [4.72, YS, 0.98], [4.72, YS, 0.78], 8).slice(1));
  pts.push(...bez([4.72, YS, 0.78], [4.73, YS, 0.5], [4.7, YS, 0.38], [4.58, YS, 0.36], 6).slice(1));
  pts.push([RA + AR + 0.02, YS, 0.36]);
  pts.push(...arcXZ(RA, AZ, YS, AR, 172, 8, 28).slice(1));
  pts.push([FA + AR + 0.02, YS, 0.36]);
  pts.push(...arcXZ(FA, AZ, YS, AR, 172, 8, 28).slice(1));
  pts.push([0.42, YS, 0.33]);
  return pts;
}

function wheel(cx, near) {
  const s = near ? -1 : 1;
  const w = {};
  const outer = circleXZ(cx, WR, s * 1.0, WR);
  const inner = circleXZ(cx, WR, s * 0.84, WR);
  w.tread = hull2d([...outer, ...inner]);
  w.side = poly(outer);
  w.sideLine = poly(circleXZ(cx, WR, s * 1.003, WR * 0.94));
  w.rim = poly(circleXZ(cx, WR, s * 1.01, 0.315));
  w.lip = poly(circleXZ(cx, WR, s * 1.012, 0.305));
  w.dish = poly(circleXZ(cx, WR, s * 0.975, 0.29));
  w.disc = poly(circleXZ(cx, WR, s * 0.94, 0.235));
  w.discHub = poly(circleXZ(cx, WR, s * 0.945, 0.12, 32));
  w.caliper = poly([...arcXZ(cx, WR, s * 0.955, 0.245, 112, 168, 12), ...arcXZ(cx, WR, s * 0.955, 0.155, 168, 112, 12)]);
  const sp = [];
  const pt = (a, rad, y) => [cx - Math.cos(a) * rad, y, WR + Math.sin(a) * rad];
  for (let k = 0; k < 10; k++) {
    const a = ((k * 36 + 6) * Math.PI) / 180;
    // rayos finos, ligeramente torcidos (rin deportivo)
    sp.push(poly([pt(a - 0.045, 0.3, s * 1.012), pt(a + 0.045, 0.3, s * 1.012), pt(a + 0.16, 0.085, s * 1.018), pt(a + 0.07, 0.085, s * 1.018)]));
  }
  w.spokes = sp.join("");
  w.hub = poly(circleXZ(cx, WR, s * 1.02, 0.085, 28));
  w.cap = poly(circleXZ(cx, WR, s * 1.024, 0.042, 20));
  return w;
}

function car() {
  const c = {};
  c.side = poly(sidePanel());
  // Volumen: zona inferior del costado (cóncava, más oscura) y brillo del hombro
  c.lowerShade = poly([
    ...bez([0.45, YS - 0.002, 0.74], [1.6, YS - 0.002, 0.7], [3.2, YS - 0.002, 0.72], [4.7, YS - 0.002, 0.8], 12),
    [4.72, YS - 0.002, 0.4],
    [0.4, YS - 0.002, 0.36],
  ]);
  c.shoulder = line(bez([0.55, YS - 0.004, 0.875], [1.6, YS - 0.004, 0.94], [3.2, YS - 0.004, 0.99], [4.62, YS - 0.004, 1.03], 16));
  c.shoulderBand = poly([
    ...bez([0.55, YS - 0.003, 0.885], [1.6, YS - 0.003, 0.955], [3.2, YS - 0.003, 1.005], [4.6, YS - 0.003, 1.05], 16),
    ...bez([4.6, YS - 0.003, 1.0], [3.2, YS - 0.003, 0.95], [1.6, YS - 0.003, 0.9], [0.55, YS - 0.003, 0.84], 16),
  ]);
  // Guardafangos marcados (brillo en media luna sobre cada arco)
  const haunch = (cx) => poly([...arcXZ(cx, AZ, YS - 0.004, AR + 0.12, 160, 20, 22), ...arcXZ(cx, AZ, YS - 0.004, AR + 0.03, 20, 160, 22)]);
  c.haunches = haunch(FA) + haunch(RA);
  c.archLine = line(arcXZ(FA, AZ, YS - 0.005, AR + 0.01, 172, 8, 28)) + line(arcXZ(RA, AZ, YS - 0.005, AR + 0.01, 172, 8, 28));
  c.sill = poly([[FA + AR + 0.04, YS - 0.008, 0.36], [RA - AR - 0.04, YS - 0.008, 0.36], [RA - AR - 0.06, YS - 0.008, 0.47], [FA + AR + 0.06, YS - 0.008, 0.47]]);
  c.redLine = line([[FA + AR + 0.18, YS - 0.012, 0.49], [RA - AR - 0.18, YS - 0.012, 0.495]]);
  // Frente
  c.fascia = poly([...HOOD_EDGE, ...BUMP.slice().reverse()]);
  c.hood = poly([...HOOD_EDGE, [1.55, 0.86, 1.06], [1.55, -0.9, BELT_F]]);
  c.hoodLines =
    line(bez([0.2, -0.46, 0.862], [0.7, -0.47, 0.96], [1.2, -0.5, 1.03], [1.55, -0.52, 1.05], 10)) +
    line(bez([0.2, 0.46, 0.862], [0.7, 0.47, 0.96], [1.2, 0.5, 1.03], [1.55, 0.52, 1.05], 10));
  c.hoodShine = poly([[0.62, -0.88, 0.95], [0.78, 0.7, 0.965], [0.98, 0.7, 0.995], [0.82, -0.88, 0.98]]);
  // Faros LED rasgados: banda delgada bajo el borde del capó que envuelve hacia el costado
  const lampNear = bez([0.66, -0.957, 0.86], [0.3, -0.95, 0.83], [0.18, -0.8, 0.81], [0.17, -0.36, 0.81], 12);
  const lampNearLow = bez([0.17, -0.36, 0.785], [0.18, -0.78, 0.785], [0.3, -0.94, 0.8], [0.6, -0.957, 0.83], 12);
  c.lampNear = poly([...lampNear, ...lampNearLow]);
  c.ledNear = line(lampNear);
  const lampFar = mirrorY(lampNear);
  c.lampFar = poly([...lampFar, ...mirrorY(lampNearLow)]);
  c.ledFar = line(lampFar);
  c.ledBar = line([[0.16, -0.36, 0.83], [0.16, 0.36, 0.83]]);
  // Parrilla integrada (baja y ancha) y tomas laterales
  c.grille = poly([
    ...bez([0.12, -0.56, 0.66], [0.12, -0.2, 0.67], [0.12, 0.2, 0.67], [0.12, 0.56, 0.66], 8),
    [0.11, 0.5, 0.42],
    ...bez([0.11, 0.5, 0.42], [0.105, 0.2, 0.41], [0.105, -0.2, 0.41], [0.11, -0.5, 0.42], 8).slice(1),
  ]);
  const gl = [];
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const z = lerp(0.43, 0.65, t);
    const xx = lerp(0.112, 0.12, t);
    gl.push(line([[xx, -0.5, z], [xx, 0.5, z]]));
  }
  c.grilleLines = gl.join("");
  c.redAccent = line(bez([0.123, -0.54, 0.675], [0.123, -0.2, 0.685], [0.123, 0.2, 0.685], [0.123, 0.54, 0.675], 8));
  c.intakeNear = poly([[0.18, -0.82, 0.62], [0.25, -0.9, 0.62], [0.23, -0.9, 0.4], [0.15, -0.8, 0.4]]);
  c.lip = line(join(BUMP_NEAR.map(([x, y, z]) => [x + 0.01, y, z + 0.03]).slice(4), [[0.11, 0.5, 0.32]]));
  // Parabrisas e invernadero
  c.windshield = poly([[1.55, -0.86, BELT_F + 0.02], [1.55, 0.86, BELT_F + 0.02], [2.44, 0.72, 1.555], [2.44, -0.72, 1.555]]);
  c.wsShine = poly([[1.78, -0.82, 1.17], [1.95, -0.8, 1.26], [2.36, 0.7, 1.5], [2.19, 0.7, 1.41]]);
  c.greenhouse = poly([
    [1.55, -0.9, BELT_F],
    [2.44, -0.72, ROOF_F],
    ...bez([2.44, -0.72, ROOF_F], [3.3, -0.72, ROOF_M], [4.05, -0.73, 1.52], [4.46, -0.8, 1.34], 12).slice(1),
    [4.5, -0.9, BELT_R + 0.02],
    [4.46, YS, BELT_R],
  ]);
  const win = (pts) => pts.map(([x, z]) => [x, yGlass(z) - 0.005, z]);
  c.win1 = poly(win([[1.78, 1.085], [2.42, 1.505], [2.98, 1.52], [2.98, 1.09]]));
  c.win2 = poly(win([[3.08, 1.095], [3.08, 1.52], [3.72, 1.49], [3.84, 1.11]]));
  c.win3 = poly(win([[3.93, 1.115], [3.86, 1.45], [4.12, 1.39], [4.36, 1.14]]));
  c.dloTrim = line(win([[1.7, 1.06], [2.43, 1.535], [3.3, 1.548], [4.02, 1.47], [4.44, 1.16], [4.46, 1.1]])) + line(win([[1.7, 1.07], [4.45, 1.11]]));
  c.winShine = poly(win([[2.14, 1.09], [2.5, 1.51], [2.66, 1.515], [2.3, 1.09]])) + poly(win([[3.3, 1.1], [3.56, 1.5], [3.62, 1.5], [3.36, 1.1]]));
  // Espejo esculpido
  c.mirror = poly([[1.62, -0.94, 1.08], [1.76, -1.12, 1.09], [1.86, -1.13, 1.17], [1.72, -0.95, 1.18]]);
  c.mirrorTop = poly([[1.76, -1.12, 1.09], [1.86, -1.13, 1.17], [1.84, -1.07, 1.19], [1.72, -1.04, 1.1]]);
  // Puertas y manijas al ras
  c.doors =
    line([[1.6, YS - 0.004, 1.03], [1.66, YS - 0.004, 0.86], ...arcXZ(FA, AZ, YS - 0.004, AR + 0.16, 38, 8, 6)]) +
    line([[3.02, YS - 0.004, 1.085], [3.02, YS - 0.004, 0.46]]) +
    line([[3.9, YS - 0.004, 1.11], [3.86, YS - 0.004, 0.94], ...arcXZ(RA, AZ, YS - 0.004, AR + 0.16, 140, 172, 6)]);
  const handle = (x) => line([[x, YS - 0.01, 0.985], [x + 0.2, YS - 0.01, 0.992]]);
  c.handles = handle(2.55) + handle(3.48);
  // Calavera LED envolvente y alerón
  c.tail = poly([[4.4, YS - 0.006, 1.06], [4.68, YS - 0.006, 1.0], [4.7, YS - 0.006, 0.96], [4.42, YS - 0.006, 1.02]]);
  c.tailLed = line([[4.42, YS - 0.008, 1.045], [4.69, YS - 0.008, 0.985]]);
  c.spoiler = poly([[4.3, -0.78, 1.4], [4.56, -0.84, 1.33], [4.58, -0.84, 1.3], [4.34, -0.8, 1.36]]);
  // Ruedas
  c.wFL = wheel(FA, true);
  c.wRL = wheel(RA, true);
  c.wFR = wheel(FA, false);
  c.wRR = wheel(RA, false);
  return c;
}

/* ------------------------------------------------------------ Escenario (pocos elementos) */
function scene() {
  const s = {};
  // Luces lineales del techo: finas, paralelas al vehículo, en perspectiva
  const lines = [];
  for (const y of [0.6, 3.0, 5.4]) lines.push(line([[-2, y, 4.2], [16, y, 4.2]]));
  s.ceiling = lines.join("");
  // Reflejo de esas luces en el piso pulido
  const fl = [];
  for (const y of [-3.4, -2.2]) fl.push(line([[-1, y, 0.002], [10, y, 0.002]]));
  s.floorLines = fl.join("");
  // Muro del fondo con una tira LED baja y paneles verticales tenues
  s.wall = poly([[-14, 10, 0], [26, 10, 0], [26, 10, 16], [-14, 10, 16]]);
  s.wallLed = line([[-14, 9.98, 0.32], [26, 9.98, 0.32]]);
  const seams = [];
  for (let x = -8; x <= 22; x += 2.8) seams.push(line([[x, 9.99, 0.34], [x, 9.99, 3.4]]));
  s.seams = seams.join("");
  // Sombra de contacto y luz bajo el vehículo
  s.shadow = poly([[-0.1, -1.2, 0], [4.85, -1.2, 0], [4.85, 1.12, 0], [-0.1, 1.12, 0]]);
  const contact = (x) =>
    poly(
      Array.from({ length: 28 }, (_, i) => {
        const a = (i / 28) * Math.PI * 2;
        return [x + Math.cos(a) * 0.34, -0.88 + Math.sin(a) * 0.16, 0.001];
      }),
    );
  s.contact = contact(FA) + contact(RA);
  s.pool = poly(
    Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return [2.35 + Math.cos(a) * 4.6, 0.2 + Math.sin(a) * 3.0, 0];
    }),
  );
  return s;
}

/* ------------------------------------------------------------ Calibración */
calibrate(sidePanel().concat([...HOOD_EDGE, ...BUMP, [2.44, -0.72, 1.555], [3.3, -0.72, 1.575], [1.86, -1.13, 1.17], [FA, -1, 0], [RA, -1, 0], [FA, 1, 0]]));

const C = car();
const SC = scene();
MIRROR = true;
const R = car();
MIRROR = false;
const groundY = P([2.35, -1, 0])[1];

/* ------------------------------------------------------------ Marcado SVG */
const wheelSvg = (w, id, far) =>
  far
    ? `<path d="${w.tread}" fill="#02040b"/><path d="${w.side}" fill="#05070f"/>`
    : `
      <path d="${w.tread}" fill="#02040b"/>
      <path d="${w.side}" fill="url(#${id}-tire)"/>
      <path d="${w.sideLine}" fill="none" stroke="#202a48" stroke-width="1.2"/>
      <path d="${w.rim}" fill="url(#${id}-rim)"/>
      <path d="${w.dish}" fill="#04081a"/>
      <path d="${w.disc}" fill="url(#${id}-disc)"/>
      <path d="${w.discHub}" fill="#151c36"/>
      <path d="${w.caliper}" fill="#ea0101"/>
      <path d="${w.spokes}" fill="url(#${id}-spoke)"/>
      <path d="${w.lip}" fill="none" stroke="#dbe5fb" stroke-opacity=".6" stroke-width="1.5"/>
      <path d="${w.hub}" fill="#222c4c"/>
      <path d="${w.cap}" fill="#a9b8dc"/>`;

function carSvg(c, id, refl) {
  const hi = (s) => (refl ? "" : s);
  return `
    <g>
      ${wheelSvg(c.wFR, id, true)}
      ${wheelSvg(c.wRR, id, true)}
      <path d="${c.greenhouse}" fill="#02061a"/>
      <path d="${c.win1}" fill="url(#${id}-glass)"/>
      <path d="${c.win2}" fill="url(#${id}-glass)"/>
      <path d="${c.win3}" fill="url(#${id}-glass)"/>
      ${hi(`<path d="${c.winShine}" fill="#a9c8ff" opacity=".13"/>`)}
      ${hi(`<path d="${c.dloTrim}" fill="none" stroke="#b9c9ee" stroke-opacity=".55" stroke-width="1.3"/>`)}
      <path d="${c.spoiler}" fill="#02061a"/>
      <path d="${c.windshield}" fill="url(#${id}-ws)"/>
      ${hi(`<path d="${c.wsShine}" fill="#d6e4ff" opacity=".16"/>`)}
      <path d="${c.hood}" fill="url(#${id}-hood)"/>
      ${hi(`<path d="${c.hoodShine}" fill="#eef4ff" opacity=".16"/>
      <path d="${c.hoodLines}" fill="none" stroke="#7aa0ff" stroke-opacity=".35" stroke-width="1.2"/>`)}
      <clipPath id="${id}-sideclip"><path d="${c.side}"/></clipPath>
      <path d="${c.side}" fill="url(#${id}-side)"/>
      <g clip-path="url(#${id}-sideclip)">
      <path d="${c.lowerShade}" fill="url(#${id}-lower)"/>
      ${hi(`<path d="${c.shoulderBand}" fill="url(#${id}-band)" opacity=".55"/>
      <path d="${c.haunches}" fill="url(#${id}-haunch)" opacity=".5"/>`)}
      </g>
      ${hi(`
      <path d="${c.shoulder}" fill="none" stroke="url(#${id}-shine)" stroke-width="2" stroke-linecap="round"/>`)}
      <path d="${c.archLine}" fill="none" stroke="#01051a" stroke-width="2.4"/>
      <path d="${c.sill}" fill="#030820"/>
      <path d="${c.redLine}" stroke="#ea0101" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="${c.doors}" stroke="#020722" stroke-opacity=".7" stroke-width="1.3" fill="none"/>
      ${hi(`<path d="${c.handles}" stroke="#a9bce8" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round" fill="none"/>`)}
      <path d="${c.fascia}" fill="url(#${id}-fascia)"/>
      <path d="${c.grille}" fill="url(#${id}-grille)"/>
      <path d="${c.grilleLines}" stroke="#2c4fb0" stroke-opacity=".45" stroke-width="1" fill="none"/>
      <path d="${c.redAccent}" stroke="#ea0101" stroke-width="1.8" fill="none"/>
      <path d="${c.intakeNear}" fill="#020619"/>
      ${hi(`<path d="${c.lip}" stroke="#6f97ff" stroke-opacity=".35" stroke-width="1.2" fill="none"/>`)}
      <path d="${c.lampNear}" fill="#030a26"/>
      <path d="${c.lampFar}" fill="#030a26"/>
      <path class="lp-led" d="${c.ledNear}${c.ledFar}${c.ledBar}" stroke="#f4f9ff" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="${c.tail}" fill="#7a0000"/>
      <path d="${c.tailLed}" stroke="#ff2a2a" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <path d="${c.mirror}" fill="#02061a"/>
      <path d="${c.mirrorTop}" fill="url(#${id}-side)"/>
      ${wheelSvg(c.wFL, id, false)}
      ${wheelSvg(c.wRL, id, false)}
    </g>`;
}

const defs = (id) => `
    <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d6be0"/><stop offset=".3" stop-color="#1c43a8"/><stop offset=".62" stop-color="#0c287a"/><stop offset="1" stop-color="#030c34"/>
    </linearGradient>
    <linearGradient id="${id}-lower" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000a2b" stop-opacity="0"/><stop offset=".45" stop-color="#000a2b" stop-opacity=".35"/><stop offset="1" stop-color="#000a2b" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="${id}-band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#cfe0ff" stop-opacity=".1"/><stop offset=".3" stop-color="#cfe0ff" stop-opacity=".45"/><stop offset="1" stop-color="#7aa6ff" stop-opacity=".05"/>
    </linearGradient>
    <linearGradient id="${id}-haunch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9cc0ff" stop-opacity=".55"/><stop offset="1" stop-color="#9cc0ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-fascia" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#041240"/><stop offset=".6" stop-color="#0b2672"/><stop offset=".88" stop-color="#2b56c6"/><stop offset="1" stop-color="#173a96"/>
    </linearGradient>
    <linearGradient id="${id}-hood" x1="0" y1="1" x2=".25" y2="0">
      <stop offset="0" stop-color="#173a96"/><stop offset=".5" stop-color="#2f5cc9"/><stop offset="1" stop-color="#6d97f2"/>
    </linearGradient>
    <linearGradient id="${id}-ws" x1="0" y1="1" x2=".2" y2="0">
      <stop offset="0" stop-color="#030926"/><stop offset=".6" stop-color="#112a72"/><stop offset="1" stop-color="#3c6bd8"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a66d4"/><stop offset=".4" stop-color="#0c1d58"/><stop offset="1" stop-color="#030822"/>
    </linearGradient>
    <linearGradient id="${id}-grille" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#071444"/><stop offset="1" stop-color="#010412"/>
    </linearGradient>
    <radialGradient id="${id}-tire" cx=".5" cy=".5" r=".5">
      <stop offset=".72" stop-color="#0b1020"/><stop offset="1" stop-color="#03050c"/>
    </radialGradient>
    <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5d6f98"/><stop offset=".5" stop-color="#1d2746"/><stop offset="1" stop-color="#0a1026"/>
    </linearGradient>
    <linearGradient id="${id}-spoke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f2f6ff"/><stop offset=".5" stop-color="#a7b6d8"/><stop offset="1" stop-color="#4a5878"/>
    </linearGradient>
    <radialGradient id="${id}-disc" cx=".5" cy=".5" r=".5">
      <stop offset=".55" stop-color="#4a5576"/><stop offset="1" stop-color="#252d48"/>
    </radialGradient>
    <linearGradient id="${id}-shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#9cc3ff" stop-opacity=".7"/><stop offset="1" stop-color="#3b8cff" stop-opacity=".1"/>
    </linearGradient>`;

const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hs-wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000722"/><stop offset="1" stop-color="#03103c"/>
    </linearGradient>
    <radialGradient id="hs-pool" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#3b8cff" stop-opacity=".26"/><stop offset=".6" stop-color="#1b4fc4" stop-opacity=".07"/><stop offset="1" stop-color="#011955" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="hs-spot" cx=".72" cy=".42" r=".42">
      <stop offset="0" stop-color="#6d9bff" stop-opacity=".2"/><stop offset="1" stop-color="#6d9bff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="hs-shadow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset=".7" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hs-reffade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="hs-ceilfade" x1="0" y1="0" x2="1" y2="0">
      <stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="hs-ceilmask"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#hs-ceilfade)"/></mask>
    <linearGradient id="hs-topfade" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".1" stop-color="#fff" stop-opacity="0"/><stop offset=".26" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="hs-topmask"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#hs-topfade)"/></mask>
    <mask id="hs-refmask"><rect x="0" y="${fmt(groundY - 150)}" width="${W}" height="${fmt(H - groundY + 150)}" fill="url(#hs-reffade)"/></mask>
    <filter id="hs-glow" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="hs-led" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="hs-soft" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="hs-blur2"><feGaussianBlur stdDeviation="2.4"/></filter>
    ${defs("hc")}
    ${defs("hr")}
  </defs>
  <g class="lp-layer-bg">
    <path d="${SC.wall}" fill="url(#hs-wall)"/>
    <path d="${SC.seams}" stroke="#3b8cff" stroke-opacity=".06" stroke-width="1" fill="none"/>
    <path d="${SC.wallLed}" stroke="#3b8cff" stroke-opacity=".45" stroke-width="1.6" fill="none" filter="url(#hs-glow)" mask="url(#hs-ceilmask)"/>
    <path d="${SC.pool}" fill="url(#hs-pool)"/>
    <path d="${SC.floorLines}" stroke="#8fb4ff" stroke-opacity=".08" stroke-width="2" fill="none"/>
  </g>
  <g class="lp-layer-lights" mask="url(#hs-ceilmask)">
    <g mask="url(#hs-topmask)"><path d="${SC.ceiling}" stroke="#e6efff" stroke-opacity=".7" stroke-width="2" fill="none" filter="url(#hs-glow)"/></g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#hs-spot)"/>
  </g>
  <g class="lp-layer-car">
    <g mask="url(#hs-refmask)" filter="url(#hs-blur2)">${carSvg(R, "hr", true)}</g>
    <path d="${SC.shadow}" fill="url(#hs-shadow)" filter="url(#hs-soft)"/>
    <path d="${SC.contact}" fill="#000" opacity=".9" filter="url(#hs-blur2)"/>
    ${carSvg(C, "hc", false)}
    <g class="lp-led-glow" filter="url(#hs-led)" opacity=".85">
      <path d="${C.ledNear}${C.ledFar}${C.ledBar}" stroke="#dbe9ff" stroke-width="2.6" stroke-linecap="round" fill="none"/>
      <path d="${C.tailLed}" stroke="#ff3030" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    </g>
  </g>
</svg>`;

if (PREVIEW) writeFileSync(PREVIEW, svg);

const jsx = svg
  .replace(/<svg viewBox="0 0 (\d+) (\d+)" xmlns="http:\/\/www.w3.org\/2000\/svg">/, "")
  .replace(/<\/svg>$/, "")
  .replace(/class=/g, "className=")
  .replace(/stop-color=/g, "stopColor=")
  .replace(/stop-opacity=/g, "stopOpacity=")
  .replace(/stroke-width=/g, "strokeWidth=")
  .replace(/stroke-opacity=/g, "strokeOpacity=")
  .replace(/stroke-linecap=/g, "strokeLinecap=")
  .replace(/clip-path=/g, "clipPath=")
  .replace(/\n\s*\n/g, "\n");

const tsx = `/* Archivo generado por tools/hero-art/generate-suv.mjs. No editar a mano: modifique el generador y vuelva a ejecutarlo. */
/**
 * Ilustración original del hero: SUV moderno en vista de tres cuartos dentro de un taller.
 * Capas para el parallax: .lp-layer-bg (fondo), .lp-layer-car (vehículo), .lp-layer-lights (luces).
 */
export const HERO_VIEWBOX = "0 0 ${W} ${H}";
/** Recorte centrado en el vehículo para pantallas angostas */
export const HERO_VIEWBOX_CAR = "${fmt(FIT.x0 - 50)} ${fmt(FIT.yGround - 480)} ${fmt(FIT.x1 - FIT.x0 + 90)} ${fmt(590)}";

export function HeroScene({ className, viewBox = HERO_VIEWBOX, preserveAspectRatio }: { className?: string; viewBox?: string; preserveAspectRatio?: string }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} className={className} role="img" aria-label="Ilustración de un vehículo en un taller automotriz">
${jsx}
    </svg>
  );
}
`;
writeFileSync(OUT, tsx);
console.log("ok", OUT, Math.round(tsx.length / 1024) + " KB", "groundY", fmt(groundY));
