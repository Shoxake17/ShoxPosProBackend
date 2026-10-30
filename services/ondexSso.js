// services/ondexSso.js
'use strict';

/**
 * OnDex klienti: ShoxPos'da KIRISH FAQAT OnDex orqali (ikkilamchi auth YO'Q).
 *
 * ShoxPos o'zi hech narsani tekshirmaydi — telefon, Telegram kodi va parolni
 * OnDex API tekshiradi. Oqim (hammasi server-server, brauzer OnDex tokenini
 * HECH QACHON ko'rmaydi):
 *
 *   1) startTelegram(phone)        — OnDex botga havola beradi
 *   2) verifyCode(phone, code)     — YOKI passwordLogin(login, password)
 *                                    OnDex tekshiradi va vaqtincha token beradi
 *   3) identityFromToken(token)    — shu token bilan OnDex'dan bir martalik
 *                                    kod olinib, `/sso/token` orqali KIMLIKKA
 *                                    almashtiriladi (rol, muassasa ID, nom)
 *   4) token tashlab yuboriladi    — ShoxPos o'z sessiyasini beradi
 *
 * Nega 3-qadam: `/auth/verify` javobida restoran NOMI yo'q (u Mongo
 * katalogida), `/sso/token` esa uni beradi va klient SIRI bilan himoyalangan.
 * Kimlikda faqat { user_id, phone, name, role, entity_id, entity_name } bor.
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

const TIMEOUT_MS = 8000;

function isConfigured() {
  return Boolean(
    config.ONDEX_API_URL && config.SSO_CLIENT_ID &&
    config.SSO_CLIENT_SECRET && config.SSO_REDIRECT_URI
  );
}

function trimSlash(url) {
  return String(url).replace(/\/+$/, '');
}

/** "+998 90 123-45-67" -> "998901234567" */
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * OnDex API'ga so'rov. `ip` — HAQIQIY mijoz manzili: OnDex tezlik cheklovlari
 * IP bo'yicha ishlaydi, uni uzatmasak BARCHA foydalanuvchilar bitta IP
 * (ShoxPos serveri) bo'lib ko'rinadi va bittasining urinishlari hammani
 * bloklaydi. OnDex `X-Forwarded-For` ga FAQAT ishonchli proksidan (u
 * `TRUSTED_PROXIES` da) kelgandagina ishonadi.
 */
async function call(path, body, { token, ip } = {}) {
  if (!isConfigured()) {
    throw Object.assign(new Error('OnDex sozlanmagan'), { kind: 'unavailable' });
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Forwarded-For'] = ip;
  try {
    return await axios.post(`${trimSlash(config.ONDEX_API_URL)}${path}`, body, {
      timeout: TIMEOUT_MS,
      headers,
      validateStatus: () => true,
    });
  } catch (err) {
    // Tarmoq xatosi/timeout. Xabar sirni o'z ichiga olmaydi (axios so'rov tanasini yozmaydi).
    throw Object.assign(
      new Error(`OnDex bilan bog'lanib bo'lmadi: ${err.code || err.message}`),
      { kind: 'unavailable' }
    );
  }
}

/**
 * OnDex javobini xato turiga aylantiradi. Foydalanuvchiga FAQAT tur
 * ko'rsatiladi (xabar matni emas): noto'g'ri raqam, noto'g'ri kod va
 * noto'g'ri parol bir xil `invalid` — raqam mavjudligi sezilmaydi.
 */
function failure(res, what) {
  if (res.status === 429) return Object.assign(new Error(`${what}: limit`), { kind: 'rate' });
  if (res.status >= 400 && res.status < 500) {
    return Object.assign(new Error(`${what}: rad etildi (${res.status})`), { kind: 'invalid' });
  }
  return Object.assign(new Error(`${what}: kutilmagan javob ${res.status}`), { kind: 'unavailable' });
}

/** Telegram bot havolasini oladi. */
async function startTelegram(phone, ip) {
  const res = await call('/auth/telegram/start', { phone: `+${phone}` }, { ip });
  if (res.status === 200 && res.data && typeof res.data.deep_link === 'string') {
    return res.data.deep_link;
  }
  throw failure(res, 'telegram/start');
}

/** Telegram/SMS kodini tekshiradi; OnDex'ning vaqtincha tokenini qaytaradi. */
async function verifyCode(phone, code, ip) {
  const res = await call('/auth/verify', { phone: `+${phone}`, code }, { ip });
  if (res.status === 200 && res.data && typeof res.data.token === 'string') return res.data.token;
  throw failure(res, 'verify');
}

/** Telefon + parol. */
async function passwordLogin(phone, password, ip) {
  const res = await call('/auth/login', { login: `+${phone}`, password }, { ip });
  if (res.status === 200 && res.data && typeof res.data.token === 'string') return res.data.token;
  throw failure(res, 'login');
}

/**
 * `/sso/token` va `/sso/identity` javobini kimlikka aylantiradi (yoki `null`).
 * `role`/`entityId` faqat hamkor akkauntlari (restoran, do'kon) uchun keladi;
 * ularni OnDex'da faqat superadmin yaratadi.
 */
function parseIdentity(res) {
  if (!(res.status === 200 && res.data && typeof res.data.user_id === 'string' &&
        typeof res.data.phone === 'string')) {
    return null;
  }
  const role = ['store', 'restaurant'].includes(res.data.role) ? res.data.role : '';
  return {
    userId: res.data.user_id,
    phone: res.data.phone,
    name: res.data.name || '',
    partnerRole: role,
    entityId: role && typeof res.data.entity_id === 'string' ? res.data.entity_id : '',
    entityName: role && typeof res.data.entity_name === 'string' ? res.data.entity_name : '',
    // Faqat do'kon uchun; qiymatni ro'yxat bilan `services/partnerProfile.js`
    // tekshiradi (kelmasa/noma'lum bo'lsa kirish rad etiladi).
    storeCategory: role === 'store' && typeof res.data.store_category === 'string' ? res.data.store_category : '',
  };
}

/**
 * OnDex tokenini KIMLIKKA almashtiradi (yuqoridagi 3-qadam). Token shu
 * yerda ishlatilib tashlanadi, ShoxPos uni saqlamaydi.
 */
async function identityFromToken(token, ip) {
  const state = crypto.randomBytes(16).toString('hex');
  const auth = await call(
    '/sso/authorize',
    { client_id: config.SSO_CLIENT_ID, redirect_uri: config.SSO_REDIRECT_URI, state },
    { token, ip }
  );
  if (auth.status !== 200 || !auth.data || typeof auth.data.redirect_to !== 'string') {
    throw failure(auth, 'sso/authorize');
  }

  // OnDex qaytargan manzil bizning ro'yxatdagi manzilimiz va state mos bo'lishi shart.
  let loc;
  try { loc = new URL(auth.data.redirect_to); } catch {
    throw Object.assign(new Error('sso/authorize: noto\'g\'ri manzil'), { kind: 'unavailable' });
  }
  const expected = new URL(config.SSO_REDIRECT_URI);
  const code = loc.searchParams.get('code');
  if (loc.origin !== expected.origin || loc.pathname !== expected.pathname ||
      loc.searchParams.get('state') !== state || !code) {
    throw Object.assign(new Error('sso/authorize: kutilmagan qaytish manzili'), { kind: 'unavailable' });
  }

  const res = await call('/sso/token', {
    client_id: config.SSO_CLIENT_ID,
    client_secret: config.SSO_CLIENT_SECRET,
    code,
    redirect_uri: config.SSO_REDIRECT_URI,
  }, { ip });

  const identity = parseIdentity(res);
  if (identity) return identity;  if (res.status === 401) {
    throw Object.assign(new Error('OnDex klientni tanimadi (SSO_CLIENT_SECRET?)'), { kind: 'misconfig' });
  }
  throw failure(res, 'sso/token');
}

/**
 * Foydalanuvchi kimligini OnDex'dan KODSIZ qayta o'qiydi (server-server, klient
 * siri bilan). Token yangilanganda kategoriya o'zgarishini olish uchun.
 */
async function identityByUserId(userId) {
  const res = await call('/sso/identity', {
    client_id: config.SSO_CLIENT_ID,
    client_secret: config.SSO_CLIENT_SECRET,
    user_id: userId,
  });
  const identity = parseIdentity(res);
  if (identity) return identity;
  if (res.status === 401) {
    throw Object.assign(new Error('OnDex klientni tanimadi (SSO_CLIENT_SECRET?)'), { kind: 'misconfig' });
  }
  throw failure(res, 'sso/identity');
}

module.exports = {
  isConfigured, normalizePhone,
  startTelegram, verifyCode, passwordLogin, identityFromToken, identityByUserId,
};
