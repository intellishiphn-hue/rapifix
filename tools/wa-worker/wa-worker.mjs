#!/usr/bin/env node
/**
 * RAPIFIX - worker de WhatsApp automático.
 * Corre en la computadora del taller junto a OpenWA. Cada pocos segundos:
 *   1. pregunta a OpenWA cómo está la sesión de WhatsApp y se lo reporta a RAPIFIX (heartbeat),
 *   2. si WhatsApp está conectado, pide a RAPIFIX los mensajes en cola (pull),
 *   3. los manda por OpenWA, uno por uno y con pausas, y confirma cada uno (ack).
 * Solo hace llamadas salientes. No abre puertos. No usa dependencias: solo Node 22.
 *
 * Rutas de OpenWA que usa (openapi.json de OpenWA 0.24):
 *   GET  /api/sessions?name=<nombre>                      buscar la sesión por nombre
 *   GET  /api/sessions/{sessionId}                         estado de la sesión (status, phone)
 *   POST /api/sessions/{sessionId}/messages/send-text      { chatId, text } -> 201 { messageId, timestamp }
 * Autenticación de OpenWA: encabezado X-API-Key.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const VERSION = "1.0.0";
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, ".wa-worker-state.json");

// ---------- Configuración (.env) ----------
function loadEnv() {
  const file = join(HERE, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv();

const num = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const cfg = {
  workerUrl: (process.env.RAPIFIX_WORKER_URL ?? "").trim(),
  token: (process.env.RAPIFIX_WORKER_TOKEN ?? "").trim(),
  openwaUrl: (process.env.OPENWA_URL ?? "http://localhost:2785").trim().replace(/\/+$/, ""),
  apiKey: (process.env.OPENWA_API_KEY ?? "").trim(),
  session: (process.env.OPENWA_SESSION ?? "").trim(),
  // Ajustes finos (normalmente no se tocan)
  loopMs: num("WORKER_LOOP_MS", 8000),
  pauseMinMs: num("WORKER_PAUSE_MIN_MS", 3000),
  pauseMaxMs: num("WORKER_PAUSE_MAX_MS", 8000),
};

// ---------- Registro (nunca imprime la clave ni la API key) ----------
const secrets = () => [cfg.token, cfg.apiKey].filter((s) => s && s.length >= 6);
function clean(text) {
  let out = String(text);
  for (const s of secrets()) out = out.split(s).join("***");
  return out;
}
const stamp = () => new Date().toLocaleString("es-HN", { hour12: false });
const log = (...a) => console.log(`[${stamp()}]`, clean(a.join(" ")));
const warn = (...a) => console.warn(`[${stamp()}] AVISO:`, clean(a.join(" ")));
const maskPhone = (digits) => (digits.length > 4 ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}` : digits);

function requireConfig(needRapifix) {
  const missing = [];
  if (needRapifix && !cfg.workerUrl) missing.push("RAPIFIX_WORKER_URL");
  if (needRapifix && !cfg.token) missing.push("RAPIFIX_WORKER_TOKEN");
  if (!cfg.apiKey) missing.push("OPENWA_API_KEY");
  if (!cfg.session) missing.push("OPENWA_SESSION");
  if (missing.length) {
    console.error(`Falta configurar en el archivo .env: ${missing.join(", ")}.\nCopie .env.example como .env y llene los valores (ver docs/WHATSAPP-AUTOMATICO.md).`);
    process.exit(1);
  }
  if (needRapifix && !/^https:\/\//.test(cfg.workerUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(cfg.workerUrl)) {
    console.error("RAPIFIX_WORKER_URL debe empezar con https://");
    process.exit(1);
  }
}

// ---------- HTTP ----------
class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
/** connected = false cuando ni siquiera se pudo conectar (seguro que no se envió nada). */
class NetError extends Error {
  constructor(message, connected) {
    super(message);
    this.connected = connected;
  }
}

async function http(url, { method = "GET", headers = {}, body, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const code = err?.cause?.code ?? err?.code ?? "";
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    const neverConnected = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(code);
    throw new NetError(timeout ? "sin respuesta (tiempo agotado)" : `sin conexión${code ? ` (${code})` : ""}`, !neverConnected);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta que no es JSON */
  }
  if (!res.ok) {
    const raw = data?.message ?? data?.error ?? text.slice(0, 200);
    throw new HttpError(res.status, Array.isArray(raw) ? raw.join("; ") : String(raw || `HTTP ${res.status}`), data);
  }
  return { status: res.status, data };
}

// ---------- RAPIFIX ----------
const rapifix = async (action, payload = {}) =>
  (await http(cfg.workerUrl, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, body: { action, ...payload } })).data;

// ---------- OpenWA ----------
const openwa = (path, opts = {}) => http(`${cfg.openwaUrl}${path}`, { ...opts, headers: { "X-API-Key": cfg.apiKey } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let sessionId = UUID.test(cfg.session) ? cfg.session : null;

/** Estado real de la sesión: { status, phone }. status es el de OpenWA o un aviso propio del worker. */
async function sessionState() {
  try {
    if (!sessionId) {
      const { data } = await openwa(`/api/sessions?name=${encodeURIComponent(cfg.session)}`);
      const found = Array.isArray(data) ? data[0] : null;
      if (!found?.id) return { status: "session_not_found", phone: null };
      sessionId = found.id;
      return { status: String(found.status ?? "disconnected"), phone: found.phone ?? null };
    }
    const { data } = await openwa(`/api/sessions/${encodeURIComponent(sessionId)}`);
    return { status: String(data?.status ?? "disconnected"), phone: data?.phone ?? null };
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) return { status: "bad_api_key", phone: null };
      if (err.status === 404 || err.status === 400) {
        if (!UUID.test(cfg.session)) sessionId = null;
        return { status: "session_not_found", phone: null };
      }
    }
    return { status: "unreachable", phone: null };
  }
}

const STATUS_HELP = {
  ready: "WhatsApp conectado.",
  qr_ready: "WhatsApp desvinculado: abra http://localhost:2785 y escanee el código QR con el teléfono del taller.",
  initializing: "WhatsApp se está conectando...",
  authenticating: "WhatsApp se está conectando...",
  created: "La sesión de OpenWA está creada pero no iniciada: ábrala en http://localhost:2785 y presione Iniciar.",
  disconnected: "WhatsApp desconectado: abra http://localhost:2785 e inicie la sesión.",
  action_required: "WhatsApp pide una acción: revise http://localhost:2785 y el teléfono del taller.",
  failed: "La sesión de OpenWA falló: abra http://localhost:2785 y vuelva a iniciarla.",
  unreachable: "OpenWA no responde. Revise que Docker Desktop esté abierto y OpenWA encendido.",
  bad_api_key: "OpenWA rechazó la API key. Revise OPENWA_API_KEY en el archivo .env.",
  session_not_found: "No se encontró la sesión en OpenWA. Revise OPENWA_SESSION en el archivo .env.",
};

/**
 * Manda un texto. Devuelve { ok, waMessageId } o { ok:false, error, permanent?, release? }.
 * release = seguro que no salió (WhatsApp no estaba listo): vuelve a la cola sin gastar intento.
 * permanent = no se reintenta solo (número sin WhatsApp, o no se sabe si salió).
 */
async function sendText(chatId, text) {
  try {
    const { data } = await openwa(`/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
      method: "POST",
      body: { chatId, text },
      timeoutMs: 60000, // OpenWA simula "escribiendo..." antes de enviar
    });
    return { ok: true, waMessageId: String(data?.messageId ?? "") };
  } catch (err) {
    if (err instanceof HttpError) {
      const msg = `OpenWA ${err.status}: ${err.message}`.slice(0, 280);
      if (err.status === 409 || err.status === 429 || err.status === 401 || err.status === 403) return { ok: false, error: msg, release: true };
      if (err.status === 400 && /not active|not started/i.test(err.message)) return { ok: false, error: msg, release: true };
      if (err.status === 400) return { ok: false, error: `Número sin WhatsApp o mensaje no válido. ${msg}`.slice(0, 280), permanent: true };
      if (err.status === 404) return { ok: false, error: msg, release: true };
      return { ok: false, error: msg };
    }
    if (err instanceof NetError && !err.connected) return { ok: false, error: "OpenWA no responde", release: true };
    // Se cortó a medio envío: no se sabe si salió. No se reintenta solo para no mandar doble.
    return { ok: false, error: "No se pudo confirmar si el mensaje salió. Revise WhatsApp antes de reintentar.", permanent: true };
  }
}

// ---------- Memoria de enviados (evita mandar doble si falló la confirmación) ----------
let sent = {};
try {
  sent = JSON.parse(readFileSync(STATE_FILE, "utf8")).sent ?? {};
} catch {
  sent = {};
}
function rememberSent(id, waMessageId) {
  sent[id] = { waMessageId, at: Date.now() };
  const keep = Object.entries(sent).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
  sent = Object.fromEntries(keep);
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ sent }));
  } catch {
    /* si no se puede escribir, sigue en memoria */
  }
}

async function ack(payload) {
  for (let i = 0; i < 5; i++) {
    try {
      await rapifix("ack", payload);
      return true;
    } catch (err) {
      warn(`No se pudo confirmar el mensaje ${payload.id} (${err.message}). Reintento ${i + 1} de 5...`);
      await sleep(2000 * (i + 1));
    }
  }
  return false;
}

const randomPause = () => cfg.pauseMinMs + Math.random() * Math.max(0, cfg.pauseMaxMs - cfg.pauseMinMs);

// ---------- Bucle principal ----------
let stopping = false;
let lastStatus = "";
let lastReason = "";

async function cycle() {
  const state = await sessionState();
  if (state.status !== lastStatus) {
    log(STATUS_HELP[state.status] ?? `Estado de WhatsApp: ${state.status}`);
    lastStatus = state.status;
  }
  await rapifix("heartbeat", { sessionStatus: state.status, ...(state.phone ? { phone: String(state.phone) } : {}), version: VERSION });
  if (state.status !== "ready") return; // los mensajes se quedan en la cola

  const res = await rapifix("pull", { max: 5 });
  const reason = res?.reason ?? "";
  if (reason !== lastReason) {
    if (reason === "fuera_de_horario") log("Fuera de horario (7:00 a 20:00): los mensajes esperan en la cola.");
    if (reason === "apagado") log("El envío automático está apagado en RAPIFIX -> Configuración.");
    lastReason = reason;
  }
  const messages = Array.isArray(res?.messages) ? res.messages : [];
  for (let i = 0; i < messages.length && !stopping; i++) {
    const m = messages[i];
    const digits = String(m.to ?? "").replace(/\D/g, "");
    const chatId = `${digits}@c.us`;
    if (sent[m.id]) {
      log(`Mensaje ${m.id} ya se había enviado; solo se confirma.`);
      await ack({ id: m.id, ok: true, waMessageId: sent[m.id].waMessageId });
      continue;
    }
    if (i > 0) await sleep(randomPause());
    const r = await sendText(chatId, String(m.body ?? ""));
    if (r.ok) {
      rememberSent(m.id, r.waMessageId);
      log(`Enviado a ${maskPhone(digits)} (mensaje ${m.id}).`);
      await ack({ id: m.id, ok: true, waMessageId: r.waMessageId });
    } else {
      warn(`No se envió a ${maskPhone(digits)} (mensaje ${m.id}): ${r.error}`);
      await ack({ id: m.id, ok: false, error: r.error, ...(r.permanent ? { permanent: true } : {}), ...(r.release ? { release: true } : {}) });
      if (r.release) break; // WhatsApp no está listo: se deja el resto para la próxima vuelta
    }
  }
  if (messages.length) await sleep(randomPause());
}

async function main() {
  requireConfig(true);
  log(`RAPIFIX WhatsApp automático v${VERSION}. OpenWA en ${cfg.openwaUrl}, sesión "${cfg.session}".`);
  log("Deje esta ventana abierta. Para detener: Ctrl + C.");
  let failures = 0;
  while (!stopping) {
    let wait = cfg.loopMs;
    try {
      await cycle();
      if (failures) log("Conexión con RAPIFIX recuperada.");
      failures = 0;
    } catch (err) {
      failures += 1;
      if (err instanceof HttpError && err.status === 401) {
        warn("RAPIFIX rechazó la clave de conexión. Genere una nueva en Configuración -> WhatsApp automático y póngala en .env (RAPIFIX_WORKER_TOKEN).");
        wait = 60000;
      } else if (err instanceof HttpError && err.status === 429) {
        warn("RAPIFIX pide esperar (demasiadas llamadas).");
        wait = 60000;
      } else {
        wait = Math.min(60000, cfg.loopMs * 2 ** Math.min(failures, 4));
        warn(`Sin conexión con RAPIFIX (${err?.message ?? err}). Nuevo intento en ${Math.round(wait / 1000)} s.`);
      }
    }
    for (let t = 0; t < wait && !stopping; t += 500) await sleep(Math.min(500, wait - t));
  }
  log("Detenido.");
}

// ---------- Comandos de prueba ----------
async function check() {
  requireConfig(false);
  const s = await sessionState();
  log(STATUS_HELP[s.status] ?? s.status, s.phone ? `Número vinculado: ${maskPhone(String(s.phone))}` : "");
  process.exit(s.status === "ready" ? 0 : 1);
}

async function testSend(to, text) {
  requireConfig(false);
  const digits = String(to ?? "").replace(/\D/g, "");
  if (digits.length < 8 || !text) {
    console.error('Uso: npm run test-send -- +504XXXXXXXX "texto de prueba"');
    process.exit(1);
  }
  const s = await sessionState();
  if (s.status !== "ready") {
    console.error(clean(STATUS_HELP[s.status] ?? s.status));
    process.exit(1);
  }
  const r = await sendText(`${digits}@c.us`, text);
  if (r.ok) log(`Mensaje de prueba enviado a ${maskPhone(digits)}. Revise el teléfono.`);
  else console.error(clean(`No se pudo enviar: ${r.error}`));
  process.exit(r.ok ? 0 : 1);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; });
process.on("unhandledRejection", (err) => warn(`Error inesperado: ${err?.message ?? err}`));

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "test-send") await testSend(rest[0], rest.slice(1).join(" "));
else if (cmd === "check") await check();
else await main();
