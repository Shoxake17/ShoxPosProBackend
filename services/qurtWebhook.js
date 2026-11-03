// services/qurtWebhook.js
'use strict';

/**
 * OnDex -> ShoxPos imzolangan xabarni tekshirish (qurt buyurtmasi jonli signali).
 *
 * Imzo: HMAC-SHA256(secret, `${timestamp}.${xomTana}`) hex, sarlavha
 * `X-Ondex-Signature: sha256=<hex>`; vaqt tamg'asi `X-Ondex-Timestamp` (unix soniya).
 * OnDex tomoni: `internal/qurtorders/webhook.go` — formula BIR XIL bo'lishi shart.
 *
 * Himoya: imzo (soxta xabar), vaqt oynasi (eskirgan xabarni qayta yuborish) va
 * `event_id` takrori (bir xabarni ikki marta qayta ishlamaslik).
 */

const crypto = require('crypto');

const MIN_SECRET_LEN = 32;
const MAX_SKEW_SECONDS = 300;
const SEEN_TTL_MS = 15 * 60 * 1000;
const SEEN_MAX = 5000;

/** `event_id` -> ko'rilgan vaqt. Xotirada (bitta server); qayta yonsa vaqt oynasi baribir himoya qiladi. */
const seen = new Map();

function sign(secret, ts, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
}

/**
 * @returns {{ok: true} | {ok: false, status: number, reason: string}}
 */
function verify({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || secret.length < MIN_SECRET_LEN) return { ok: false, status: 503, reason: 'webhook sozlanmagan' };
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return { ok: false, status: 400, reason: 'tana yo\'q' };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: 'vaqt tamg\'asi yaroqsiz' };
  }
  const m = /^sha256=([0-9a-f]{64})$/.exec(String(signature || ''));
  if (!m) return { ok: false, status: 401, reason: 'imzo yaroqsiz' };

  const want = Buffer.from(sign(secret, String(ts), rawBody), 'hex');
  const got = Buffer.from(m[1], 'hex');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    return { ok: false, status: 401, reason: 'imzo yaroqsiz' };
  }
  return { ok: true };
}

/** Xabar avval ko'rilganmi (ko'rilmagan bo'lsa belgilaydi). */
function alreadySeen(eventId, now = Date.now()) {
  for (const [id, at] of seen) {
    if (now - at > SEEN_TTL_MS) seen.delete(id);
    else break; // Map kiritish tartibida: qolganlari yangiroq
  }
  if (seen.has(eventId)) return true;
  if (seen.size >= SEEN_MAX) seen.delete(seen.keys().next().value);
  seen.set(eventId, now);
  return false;
}

/** Ishlov muvaffaqiyatsiz bo'lsa xabar qayta kelishi mumkin bo'lishi uchun belgini olib tashlaydi. */
function forget(eventId) {
  seen.delete(eventId);
}

module.exports = { sign, verify, alreadySeen, forget, MIN_SECRET_LEN, MAX_SKEW_SECONDS, _seen: seen };
