// services/oidcClient.js
'use strict';

/**
 * OnDex OIDC klienti (A4c.4, ChustApp `internal/identity/oidc.go`).
 *
 * ShoxPos = OnDex Merchant web paneli. U foydalanuvchini O'ZI TEKSHIRMAYDI:
 * kirish sahifasi faqat OnDex'da (`api.ondex.uz/v2/oauth/login`), parol,
 * Telegram kodi va TOTP bu serverdan HECH QACHON o'tmaydi. ShoxPos —
 * konfidensial klient (BFF): Authorization Code + PKCE S256, kod klient
 * siri bilan almashtiriladi, OnDex tokenlari faqat serverda (shifrlangan).
 *
 * JWT tekshiruvi (id_token, logout_token) — Node `crypto` bilan Ed25519,
 * kalitlar OnDex JWKS'dan (`kid` bo'yicha, kesh). Faqat `EdDSA`: `none`,
 * HS256 va boshqa algoritmlar rad etiladi (algoritm almashtirish hujumi yo'q).
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const TIMEOUT_MS = 8000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_S = 30;

function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

function isConfigured() {
  return Boolean(config.ONDEX_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET &&
    config.OIDC_REDIRECT_URI && config.BFF_SESSION_KEY);
}

const issuer = () => trimSlash(config.ONDEX_ISSUER);
// Server-server so'rovlar uchun ichki manzil (prod'da shu VPS'dagi API
// konteyneri) — bo'lmasa issuer. Brauzer yo'naltirishlari DOIM issuer'ga.
const backend = () => trimSlash(config.ONDEX_API_INTERNAL_URL || config.ONDEX_ISSUER);

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

/** PKCE juftligi va state/nonce. */
function newLoginParams() {
  const verifier = b64url(crypto.randomBytes(48));                    // 64 belgi
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(crypto.randomBytes(24)), nonce: b64url(crypto.randomBytes(24)) };
}

function authorizeUrl({ state, nonce, challenge, prompt }) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: config.OIDC_CLIENT_ID, redirect_uri: config.OIDC_REDIRECT_URI,
    scope: 'openid profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (prompt) q.set('prompt', prompt);
  return `${issuer()}/v2/oauth/authorize?${q.toString()}`;
}

function endSessionUrl(idToken, state) {
  const q = new URLSearchParams();
  if (idToken) q.set('id_token_hint', idToken);
  if (config.OIDC_POST_LOGOUT_URI) q.set('post_logout_redirect_uri', config.OIDC_POST_LOGOUT_URI);
  if (state) q.set('state', state);
  q.set('client_id', config.OIDC_CLIENT_ID);
  return `${issuer()}/v2/oauth/logout?${q.toString()}`;
}

class OidcError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function request(method, path, { form, bearer, ip } = {}) {
  const headers = { Accept: 'application/json' };
  let data;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const id = encodeURIComponent(config.OIDC_CLIENT_ID);
    const secret = encodeURIComponent(config.OIDC_CLIENT_SECRET);
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
    data = new URLSearchParams(form).toString();
  } else if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  // Haqiqiy mijoz IP'si: OnDex cheklovlari IP bo'yicha (TRUSTED_PROXIES ShoxPos'ni qamrashi SHART).
  if (ip) headers['X-Forwarded-For'] = ip;
  try {
    return await axios({ method, url: `${backend()}${path}`, data, headers, timeout: TIMEOUT_MS,
      validateStatus: () => true, maxRedirects: 0 });
  } catch (err) {
    throw new OidcError('unavailable', `OnDex bilan bog'lanib bo'lmadi: ${err.code || err.message}`);
  }
}

function tokenResult(res, what) {
  if (res.status === 200 && res.data && typeof res.data.access_token === 'string') return res.data;
  if (res.status === 400 || res.status === 401) {
    const code = (res.data && res.data.error) || 'invalid_grant';
    // invalid_client — bizning sozlama xatosi (sir mos emas): foydalanuvchi aybdor emas.
    throw new OidcError(code === 'invalid_client' ? 'misconfig' : 'invalid', `${what}: ${code}`);
  }
  if (res.status === 429) throw new OidcError('rate', `${what}: limit`);
  throw new OidcError('unavailable', `${what}: HTTP ${res.status}`);
}

async function exchangeCode(code, verifier, ip) {
  const res = await request('POST', '/v2/oauth/token', { ip, form: {
    grant_type: 'authorization_code', code, redirect_uri: config.OIDC_REDIRECT_URI, code_verifier: verifier } });
  return tokenResult(res, 'token');
}

async function refresh(refreshToken, ip) {
  const res = await request('POST', '/v2/oauth/token', { ip, form: {
    grant_type: 'refresh_token', refresh_token: refreshToken } });
  return tokenResult(res, 'refresh');
}

async function userinfo(accessToken) {
  const res = await request('GET', '/v2/oauth/userinfo', { bearer: accessToken });
  if (res.status === 200 && res.data && typeof res.data.sub === 'string') return res.data;
  if (res.status === 401) throw new OidcError('invalid', 'userinfo: 401');
  throw new OidcError('unavailable', `userinfo: HTTP ${res.status}`);
}

/** Markaziy sessiyani yopadi (OnDex `/v2/auth/logout`). Xato — jim (sessiya baribir o'chiriladi). */
async function revoke(accessToken) {
  try { await request('POST', '/v2/auth/logout', { bearer: accessToken }); } catch { /* jim */ }
}

async function listSessions(accessToken) {
  const res = await request('GET', '/v2/auth/sessions', { bearer: accessToken });
  if (res.status === 200 && res.data) return res.data;
  throw new OidcError(res.status === 401 ? 'invalid' : 'unavailable', `sessions: HTTP ${res.status}`);
}

async function deleteSession(accessToken, id) {
  const res = await request('DELETE', `/v2/auth/sessions/${encodeURIComponent(id)}`, { bearer: accessToken });
  if (res.status === 204 || res.status === 200) return;
  throw new OidcError(res.status === 404 ? 'not_found' : 'unavailable', `sessions/delete: HTTP ${res.status}`);
}

// ── JWKS + JWT ──────────────────────────────────────────────────────────
let jwksCache = { at: 0, keys: new Map() };

async function loadJwks(force) {
  if (!force && Date.now() - jwksCache.at < JWKS_TTL_MS && jwksCache.keys.size) return jwksCache.keys;
  const res = await request('GET', '/.well-known/jwks.json');
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.keys)) {
    throw new OidcError('unavailable', `jwks: HTTP ${res.status}`);
  }
  const keys = new Map();
  for (const k of res.data.keys) {
    if (k.kty !== 'OKP' || k.crv !== 'Ed25519' || typeof k.kid !== 'string' || k.d) continue;
    keys.set(k.kid, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x }, format: 'jwk' }));
  }
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** Testlar uchun: tayyor kalitlar (tarmoqsiz). */
function _setJwksForTest(map) { jwksCache = { at: Date.now() + 1e12, keys: map }; }

/**
 * EdDSA JWT tekshiruvi. `aud` — bizning client_id, `iss` — OnDex.
 * `opts.expRequired` (id_token) / `opts.typ` (logout_token).
 */
async function verifyJwt(raw, opts = {}) {
  const parts = String(raw || '').split('.');
  if (parts.length !== 3 || raw.length > 8192) throw new OidcError('invalid', 'jwt: format');
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new OidcError('invalid', 'jwt: json'); }
  if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') throw new OidcError('invalid', 'jwt: alg');
  if (opts.typ && header.typ !== opts.typ) throw new OidcError('invalid', 'jwt: typ');
  let keys = await loadJwks(false);
  if (!keys.has(header.kid)) keys = await loadJwks(true); // kalit rotatsiyasi
  const pub = keys.get(header.kid);
  if (!pub) throw new OidcError('invalid', 'jwt: kid');
  const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new OidcError('invalid', 'jwt: imzo');

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer() || aud.length !== 1 || aud[0] !== config.OIDC_CLIENT_ID) {
    throw new OidcError('invalid', 'jwt: iss/aud');
  }
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < now) throw new OidcError('invalid', 'jwt: exp');
  if (typeof claims.iat !== 'number' || claims.iat - LEEWAY_S > now) throw new OidcError('invalid', 'jwt: iat');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('invalid', 'jwt: sub');
  return claims;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function verifyIdToken(raw, nonce) {
  const c = await verifyJwt(raw);
  if (!safeEqual(c.nonce, nonce)) throw new OidcError('invalid', 'id_token: nonce');
  if (typeof c.sid !== 'string' || !c.sid) throw new OidcError('invalid', 'id_token: sid');
  return c;
}

const BCL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

async function verifyLogoutToken(raw) {
  const c = await verifyJwt(raw, { typ: 'logout+jwt' });
  if (!c.events || typeof c.events !== 'object' || !(BCL_EVENT in c.events)) throw new OidcError('invalid', 'logout: events');
  if ('nonce' in c) throw new OidcError('invalid', 'logout: nonce');                  // OIDC BCL 2.6
  if (typeof c.sid !== 'string' || !c.sid) throw new OidcError('invalid', 'logout: sid');
  if (typeof c.jti !== 'string' || !c.jti) throw new OidcError('invalid', 'logout: jti');
  return c;
}

module.exports = {
  OidcError, isConfigured, newLoginParams, authorizeUrl, endSessionUrl, exchangeCode, refresh,
  userinfo, revoke, listSessions, deleteSession, verifyIdToken, verifyLogoutToken, safeEqual,
  _setJwksForTest,
};
