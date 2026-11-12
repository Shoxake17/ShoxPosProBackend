// tests/userModel.test.js — `node --test tests/`
//
// 2026-11-12 tozalash: (1) o'lik auth/obuna/rol maydonlari sxemada YO'Q
// (Mongoose ularni jimgina tashlaydi — eski kod qayta yoza olmaydi);
// (2) Web Push maydoni to'g'ri nomda (ilgari pushSubscriptions <-> pushSubscription
// nomuvofiqligi tufayli xabar hech qachon kelmasdi); (3) push manzili SSRF'ga qarshi.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const { normalizeSubscription } = require('../utils/pushSubscription');

const KEY = 'B' + 'A'.repeat(86); // p256dh shakli (base64url, 87 belgi)
// Soxta (sinov) push kalitlari — sir emas.
const good = (endpoint) => ({ endpoint, keys: { p256dh: KEY, auth: 'abcdefgh1234' } }); // gitleaks:allow

test("o'lik maydonlar sxemada yo'q va saqlanmaydi", () => {
  const dead = ['password', 'role', 'subscription', 'email', 'activeDevice', 'devices', 'googleAuthSecret',
    'googleAuthEnabled', 'loginAttempts', 'blockedDevices', 'isSecret', 'uniqueChatId', 'telegramId', 'pushSubscriptions'];
  for (const f of dead) assert.equal(User.schema.path(f), undefined, `${f} sxemada qolgan`);
  const u = new User({ login: '998901111111', role: 'admin', password: 'x', googleAuthSecret: 'S', devices: [{ token: 't' }] });
  const o = u.toObject();
  for (const f of ['role', 'password', 'googleAuthSecret', 'devices']) assert.equal(o[f], undefined, `${f} yozildi`);
});

test('pushSubscription maydoni saqlanadi (nom mos)', () => {
  const u = new User({ login: '998901111111', pushSubscription: good('https://fcm.googleapis.com/fcm/send/abc') });
  assert.equal(u.toObject().pushSubscription.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
});

test('push obunasi: rasmiy xizmatlar qabul qilinadi', () => {
  for (const e of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    const n = normalizeSubscription({ ...good(e), extra: 'tashlanadi' });
    assert.ok(n, `${e} rad etildi`);
    assert.equal(n.extra, undefined);
  }
});

test('push obunasi: SSRF va buzuq qiymatlar RAD', () => {
  const bad = [
    good('http://fcm.googleapis.com/fcm/send/abc'),           // http
    good('https://ondex-api-1:8080/admin'),                   // ichki host
    good('https://127.0.0.1/x'),
    good('https://169.254.169.254/latest/meta-data'),         // bulut metadata
    good('https://fcm.googleapis.com.evil.com/x'),            // o'xshash domen
    good('https://evil.com/fcm.googleapis.com'),
    good('https://user:pass@fcm.googleapis.com/x'),           // credential
    good('https://fcm.googleapis.com:8443/x'),                // port
    good('https://' + 'a'.repeat(1100) + '.fcm.googleapis.com/'),
    { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'qisqa', auth: 'abcdefgh' } },
    { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: KEY, auth: 'a b"c<d>' } },
    { endpoint: 'https://fcm.googleapis.com/x' },
    null, 'satr', [good('https://fcm.googleapis.com/x')],
  ];
  for (const b of bad) assert.equal(normalizeSubscription(b), null, `qabul qilindi: ${JSON.stringify(b).slice(0, 80)}`);
});
