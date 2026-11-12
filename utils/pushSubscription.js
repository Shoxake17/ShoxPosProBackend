// utils/pushSubscription.js
//
// Web Push obunasini tekshirish (2026-11-12). Server keyin `endpoint` manziliga
// POST yuboradi (web-push), shuning uchun mijoz bergan manzil ISHONCHSIZ:
// tekshirilmasa hujumchi `http://ondex-api-1:8080/...` kabi ICHKI manzil berib,
// server orqali ichki tarmoqqa so'rov yubora olardi (SSRF). Faqat HTTPS va
// brauzerlarning rasmiy push xizmatlari.
'use strict';

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge (Android), Opera
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/,                // Safari (macOS/iOS)
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge (Windows, WNS)
];

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_ENDPOINT = 1024;

/** Tozalangan obuna yoki `null` (yaroqsiz). Ortiqcha maydonlar tashlanadi. */
function normalizeSubscription(sub) {
  if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return null;
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  if (!keys || typeof keys !== 'object') return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (p256dh.length < 40 || p256dh.length > 200 || !B64URL.test(p256dh)) return null;
  if (auth.length < 8 || auth.length > 64 || !B64URL.test(auth)) return null;
  const out = { endpoint: u.toString(), keys: { p256dh, auth } };
  if (sub.expirationTime === null || Number.isFinite(sub.expirationTime)) out.expirationTime = sub.expirationTime ?? null;
  return out;
}

module.exports = { normalizeSubscription };
