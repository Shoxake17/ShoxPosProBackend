// tests/oidcBff.test.js — `node --test tests/` (A4c.4: OnDex OIDC + BFF)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

for (const k of ['COOKIE_SECRET', 'MONGO_URI', 'ADMIN_DEVICE_ID',  'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
process.env.MONGO_URI = 'mongodb://127.0.0.1:1/x';
process.env.ONDEX_ISSUER = 'https://api.ondex.test';
process.env.OIDC_CLIENT_ID = 'merchant-web';
process.env.OIDC_CLIENT_SECRET = 'x'.repeat(40);
process.env.OIDC_REDIRECT_URI = 'https://pos.ondex.test/api/auth/oidc/callback';
process.env.BFF_SESSION_KEY = crypto.randomBytes(32).toString('hex');

const oidc = require('../services/oidcClient');
const bff = require('../services/bffSession');
const BffSession = require('../models/BffSession');
const { safeReturn } = require('../routes/oidcAuth');
const account = require('../services/merchantAccount');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const KID = 'test-kid';
oidc._setJwksForTest(new Map([[KID, publicKey]]));

const now = () => Math.floor(Date.now() / 1000);
function sign(claims, header = {}, key = privateKey) {
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID, ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}
const idClaims = (over = {}) => ({ iss: 'https://api.ondex.test', aud: ['merchant-web'], sub: 'u1', sid: 's1',
  nonce: 'n1', iat: now(), exp: now() + 600, ...over });

test('id_token: to\'g\'ri token qabul qilinadi', async () => {
  const c = await oidc.verifyIdToken(sign(idClaims()), 'n1');
  assert.equal(c.sub, 'u1');
  assert.equal(c.sid, 's1');
});

test('id_token: soxta va begona tokenlar rad etiladi', async () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const cases = {
    'noto\'g\'ri nonce': [sign(idClaims()), 'boshqa'],
    'begona aud': [sign(idClaims({ aud: ['ondex-pro'] })), 'n1'],
    'ikki aud': [sign(idClaims({ aud: ['merchant-web', 'x'] })), 'n1'],
    'begona iss': [sign(idClaims({ iss: 'https://evil.test' })), 'n1'],
    'muddati o\'tgan': [sign(idClaims({ exp: now() - 120 })), 'n1'],
    'kelajakdagi iat': [sign(idClaims({ iat: now() + 600 })), 'n1'],
    'alg HS256': [sign(idClaims(), { alg: 'HS256' }), 'n1'],
    'alg none': [sign(idClaims(), { alg: 'none' }), 'n1'],
    'begona kalit': [sign(idClaims(), {}, other), 'n1'],
    'sid yo\'q': [sign(idClaims({ sid: '' })), 'n1'],
    'format': ['a.b', 'n1'],
  };
  for (const [name, [tok, nonce]] of Object.entries(cases)) {
    await assert.rejects(oidc.verifyIdToken(tok, nonce), (e) => e.kind === 'invalid', name);
  }
  const t = sign(idClaims());
  const tampered = t.slice(0, -4) + (t.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(oidc.verifyIdToken(tampered, 'n1'), /imzo|format/, 'buzilgan imzo');
});

test('logout_token: typ, events, nonce yo\'qligi, jti', async () => {
  const base = { iss: 'https://api.ondex.test', aud: ['merchant-web'], sub: 'u1', sid: 's1', jti: 'j1',
    iat: now(), exp: now() + 120, events: { 'http://schemas.openid.net/event/backchannel-logout': {} } };
  const ok = await oidc.verifyLogoutToken(sign(base, { typ: 'logout+jwt' }));
  assert.equal(ok.sid, 's1');
  await assert.rejects(oidc.verifyLogoutToken(sign(base)), /typ/);
  await assert.rejects(oidc.verifyLogoutToken(sign({ ...base, nonce: 'x' }, { typ: 'logout+jwt' })), /nonce/);
  await assert.rejects(oidc.verifyLogoutToken(sign({ ...base, events: {} }, { typ: 'logout+jwt' })), /events/);
  await assert.rejects(oidc.verifyLogoutToken(sign({ ...base, jti: '' }, { typ: 'logout+jwt' })), /jti/);
  // id_token logout_token sifatida o'tmaydi
  await assert.rejects(oidc.verifyLogoutToken(sign(idClaims())), /typ|events/);
});

test('BFF shifrlash: aylanma, buzilgan shifr rad', () => {
  const s = bff.seal('ort_maxfiy-refresh');
  assert.equal(bff.open(s), 'ort_maxfiy-refresh');
  assert.notEqual(s, bff.seal('ort_maxfiy-refresh'), 'har safar yangi IV');
  const b = Buffer.from(s, 'base64');
  b[b.length - 1] ^= 1;
  assert.throws(() => bff.open(b.toString('base64')));
  assert.throws(() => bff.open(''));
});

test('return: faqat shu saytdagi nisbiy yo\'l', () => {
  for (const ok of ['/', '/products', '/sales?d=1', '/a/b#x']) assert.equal(safeReturn(ok), ok, ok);
  for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', '', null,
    '/x\nSet-Cookie:a', '/' + 'a'.repeat(600)]) {
    assert.equal(safeReturn(bad), '/', String(bad));
  }
});

test('userinfo -> kimlik: hamkor, A3 biznesi, hech biri', () => {
  const p = account.identityFromUserinfo({ sub: 'u1', phone_number: '+998 90 111-22-33', name: 'Ali',
    partner: { role: 'store', entity_id: 'st1', entity_name: 'Qurt', store_category: 'qurt' } });
  assert.deepEqual([p.userId, p.phone, p.partnerRole, p.entityId, p.storeCategory], ['u1', '998901112233', 'store', 'st1', 'qurt']);
  const b = account.identityFromUserinfo({ sub: 'u2', phone_number: '+998901112234',
    businesses: [{ id: 'b1', type: 'restaurant', name: 'Book Cafe', legacy_entity_id: 'r1', org_status: 'active' }] });
  assert.deepEqual([b.partnerRole, b.entityId, b.entityName], ['restaurant', 'r1', 'Book Cafe']);
  const s = account.identityFromUserinfo({ sub: 'u3', businesses: [{ id: 'b2', type: 'restaurant', org_status: 'suspended' }] });
  assert.equal(s.partnerRole, '', "to'xtatilgan tashkilot hisob ochmaydi");
  assert.equal(account.identityFromUserinfo({ sub: 'u4', partner: { role: 'customer', entity_id: 'x' } }).partnerRole, '');
  assert.equal(account.denyReason(null), 'not_linked');
  assert.equal(account.denyReason({ role: 'admin' }), 'not_linked');
  assert.equal(account.denyReason({ role: 'cashier', blocked: true }), 'blocked');
  assert.equal(account.denyReason({ role: 'cashier' }), '');
});

// ── ensureFresh: Mongo va OnDex'siz (model va klient almashtiriladi) ──────
function sessionDoc(over = {}) {
  return { _id: 'h1', userId: 'u', login: 'l', role: 'cashier', sc: '', ondexSub: 'u1', ondexSid: 's1',
    accessEnc: bff.seal('acc-old'), refreshEnc: bff.seal('ort_old'), accessExp: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 3600e3), revokedAt: null, ...over };
}

test('ensureFresh: yangi token muddati bor — OnDex chaqirilmaydi', async (t) => {
  const r = t.mock.method(oidc, 'refresh', async () => { throw new Error('chaqirilmasligi kerak'); });
  const s = sessionDoc({ accessExp: new Date(Date.now() + 5 * 60e3) });
  assert.equal(await bff.ensureFresh(s), s);
  assert.equal(r.mock.callCount(), 0);
});

test('ensureFresh: markaz rad etdi (invalid) — sessiya YOPILADI', async (t) => {
  bff._resetForTest();
  t.mock.method(oidc, 'refresh', async () => { throw new oidc.OidcError('invalid', 'refresh: invalid_grant'); });
  const upd = t.mock.method(BffSession, 'updateOne', async () => ({}));
  assert.equal(await bff.ensureFresh(sessionDoc()), null);
  assert.equal(upd.mock.callCount(), 1);
  assert.equal(upd.mock.calls[0].arguments[1].$set.revokeReason, 'ondex_rejected');
});

test('ensureFresh: OnDex javob bermayapti — muhlat ichida davom, keyin 401 (yopilMAYDI)', async (t) => {
  bff._resetForTest();
  t.mock.method(oidc, 'refresh', async () => { throw new oidc.OidcError('unavailable', 'tarmoq'); });
  const upd = t.mock.method(BffSession, 'updateOne', async () => ({}));
  const fresh = sessionDoc({ accessExp: new Date(Date.now() - 60e3) });
  assert.equal(await bff.ensureFresh(fresh), fresh, 'muhlat ichida');
  bff._resetForTest();
  const old = sessionDoc({ accessExp: new Date(Date.now() - bff.OFFLINE_GRACE_MS - 60e3) });
  assert.equal(await bff.ensureFresh(old), null, 'muhlatdan keyin');
  assert.equal(upd.mock.callCount(), 0, 'OnDex ishlamay qolgani uchun sessiya yopilmasligi kerak');
});

test('ensureFresh: muvaffaqiyat — compare-and-swap, parallel chaqiruv bitta refresh', async (t) => {
  bff._resetForTest();
  let calls = 0;
  t.mock.method(oidc, 'refresh', async (rt) => {
    calls++;
    assert.equal(rt, 'ort_old');
    await new Promise((r) => setTimeout(r, 20));
    return { access_token: 'acc-new', refresh_token: 'ort_new', expires_in: 600 };
  });
  const cas = t.mock.method(BffSession, 'findOneAndUpdate', async (filter, update) => ({ ...sessionDoc(),
    ...update.$set, _id: filter._id }));
  const s = sessionDoc();
  const [a, b] = await Promise.all([bff.ensureFresh(s), bff.ensureFresh(s)]);
  assert.equal(calls, 1, 'bir vaqtdagi ikki so\'rov tokenni ikki marta yangilamasligi kerak');
  assert.equal(cas.mock.calls[0].arguments[0].refreshEnc, s.refreshEnc, 'CAS eski refresh bo\'yicha');
  assert.equal(bff.accessToken(a), 'acc-new');
  assert.equal(a, b);
});

test('ensureFresh: kimlik o\'zgardi (hamkorlik olib tashlandi) — sessiya yopiladi', async (t) => {
  bff._resetForTest();
  t.mock.method(oidc, 'refresh', async () => ({ access_token: 'a2', refresh_token: 'ort_2', expires_in: 600 }));
  t.mock.method(oidc, 'userinfo', async () => ({ sub: 'u1' }));
  t.mock.method(BffSession, 'findOneAndUpdate', async (f, u) => ({ ...sessionDoc(), ...u.$set }));
  const upd = t.mock.method(BffSession, 'updateOne', async () => ({}));
  assert.equal(await bff.ensureFresh(sessionDoc(), { onIdentity: async () => false }), null);
  assert.equal(upd.mock.calls[0].arguments[1].$set.revokeReason, 'identity_changed');
});
