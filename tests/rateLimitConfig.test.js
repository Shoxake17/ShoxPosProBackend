// tests/rateLimitConfig.test.js — `node --test tests/`
//
// 2026-11-12 (SEC-5): storeOrders limiteri o'rnatilgan express-rate-limit
// versiyasi tanimaydigan `validate` kalitini olgan edi -> prod logida
// ERR_ERL_UNKNOWN_VALIDATION. Endi har bir routerni yaratishda kutubxona
// hech qanday sozlama xatosini yozmasligi tekshiriladi.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Config envalid majburiy o'zgaruvchilarni talab qiladi — sinov uchun soxta qiymatlar.
for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'MONGO_URI', 'ADMIN_DEVICE_ID', 'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
process.env.MONGO_URI = process.env.MONGO_URI.startsWith('mongodb') ? process.env.MONGO_URI : 'mongodb://127.0.0.1:1/x';

test("router limiterlari sozlama xatosisiz yaratiladi", () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    const noCsrf = (_req, _res, next) => next();
    require('../routes/storeOrders')(noCsrf);
  } finally {
    console.error = orig;
  }
  const rl = errors.filter((e) => /ERR_ERL_|ValidationError/.test(e));
  assert.deepEqual(rl, [], `express-rate-limit sozlama xatosi: ${rl.join(' | ')}`);
});
