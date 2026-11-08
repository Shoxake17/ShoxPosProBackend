// services/ondexSso.js
'use strict';

/**
 * OnDex server-server klienti (eski `internal/sso`, klient siri bilan).
 *
 * KIRISH BU YERDA EMAS (A4c.4): foydalanuvchi OnDex OIDC orqali kiradi
 * (`services/oidcClient.js`), parol/kod ShoxPos'dan o'tmaydi. Bu modulda
 * faqat server-server ishlar qoldi:
 *   * identityByUserId — eski hisob hali tirikligini tekshirish
 *     (`services/merchantAccount.js`, raqam boshqa odamga o'tganmi);
 *   * normalizePhone — telefonni bir xil ko'rinishga keltirish.
 * Qurt mahsulot sinxronlashi ham shu klient sirini ishlatadi (`qurtSync`).
 */

const axios = require('axios');
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

// startTelegram/verifyCode/passwordLogin OLIB TASHLANDI (A4c.4): parol va kod
// endi ShoxPos'dan O'TMAYDI — faqat OnDex kirish sahifasida (OIDC).

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
  identityByUserId,
};
