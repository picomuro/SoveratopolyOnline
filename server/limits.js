/**
 * Limiti anti-abuso: secchiello di gettoni per connessione e contatori per indirizzo IP.
 */
import { EVENT_BURST, EVENT_RATE, IP_LIMITS, IP_WINDOW_MS } from './config.js';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Indirizzo del client: dietro il proxy di Render è il primo di X-Forwarded-For.
 * null per le connessioni dirette da questa macchina (sviluppo e test), che non hanno limiti per IP.
 */
export function clientIp(handshake) {
  const fwd = handshake.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return LOCAL.has(handshake.address) ? null : handshake.address;
}

/** Conteggio a finestra fissa per indirizzo IP: kind è una chiave di IP_LIMITS. */
const ipHits = new Map(); // `${kind}:${ip}` -> { count, since }
export function ipAllowed(kind, ip, now = Date.now()) {
  if (ip === null) return true; // sviluppo in locale: nessun limite
  const key = `${kind}:${ip}`;
  const hit = ipHits.get(key);
  if (!hit || now - hit.since >= IP_WINDOW_MS) {
    ipHits.set(key, { count: 1, since: now });
    return true;
  }
  return ++hit.count <= IP_LIMITS[kind];
}

/** Dimentica i contatori scaduti (chiamata dalla pulizia periodica). */
export function sweepIpHits(now = Date.now()) {
  for (const [key, hit] of ipHits) if (now - hit.since >= IP_WINDOW_MS) ipHits.delete(key);
}

/** Secchiello di gettoni: EVENT_BURST eventi di fila, poi EVENT_RATE al secondo. */
export function createBucket(burst = EVENT_BURST, rate = EVENT_RATE) {
  let tokens = burst;
  let at = Date.now();
  return function take(now = Date.now()) {
    tokens = Math.min(burst, tokens + ((now - at) / 1000) * rate);
    at = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}
