// tests/qurtWebhook.test.js — `node --test tests/`
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const qurtWebhook = require('../services/qurtWebhook');

const SECRET = crypto.randomBytes(24).toString('hex'); // har ishga tushirishda yangi (soxta, haqiqiy sir emas)
const body = Buffer.from(JSON.stringify({ event: 'created', event_id: 'o1:created:1' }));
const NOW = 1_800_000_000_000; // ms
const ts = String(NOW / 1000);

const sig = (secret = SECRET, t = ts, b = body) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(`${t}.`).update(b).digest('hex');

test('to\'g\'ri imzo qabul qilinadi (OnDex formulasi bilan bir xil)', () => {
  const r = qurtWebhook.verify({ secret: SECRET, timestamp: ts, signature: sig(), rawBody: body, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(qurtWebhook.sign(SECRET, ts, body), sig().slice('sha256='.length));
});

test('noto\'g\'ri sir, o\'zgargan tana va buzilgan imzo rad etiladi', () => {
  const bad = [
    { signature: sig('boshqa-sir-boshqa-sir-boshqa-sir-1') },
    { rawBody: Buffer.from('{"event":"created","event_id":"x"}') },
    { signature: 'sha256=' + 'a'.repeat(64) },
    { signature: 'sha256=zz' },
    { signature: '' },
    { signature: undefined },
    { signature: sig().replace('sha256=', 'md5=') },
  ];
  for (const o of bad) {
    const r = qurtWebhook.verify({ secret: SECRET, timestamp: ts, signature: sig(), rawBody: body, now: NOW, ...o });
    assert.equal(r.ok, false, JSON.stringify(o).slice(0, 60));
    assert.equal(r.status, 401);
  }
});

test('eskirgan va kelajakdagi vaqt tamg\'asi rad etiladi (qayta yuborish himoyasi)', () => {
  for (const delta of [-(qurtWebhook.MAX_SKEW_SECONDS + 5), qurtWebhook.MAX_SKEW_SECONDS + 5]) {
    const t = String(NOW / 1000 + delta);
    const r = qurtWebhook.verify({ secret: SECRET, timestamp: t, signature: sig(SECRET, t), rawBody: body, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  }
  for (const t of ['abc', '', undefined, '1.5']) {
    const r = qurtWebhook.verify({ secret: SECRET, timestamp: t, signature: sig(), rawBody: body, now: NOW });
    assert.equal(r.ok, false);
  }
});

test('sir sozlanmagan yoki qisqa bo\'lsa — 503 (hech kim kira olmaydi)', () => {
  for (const secret of ['', undefined, 'qisqa']) {
    const r = qurtWebhook.verify({ secret, timestamp: ts, signature: sig(), rawBody: body, now: NOW });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
  }
});

test('tana yo\'q bo\'lsa rad etiladi', () => {
  const r = qurtWebhook.verify({ secret: SECRET, timestamp: ts, signature: sig(), rawBody: undefined, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('event_id takrori aniqlanadi; forget qayta ishlashga ruxsat beradi', () => {
  const id = 'dup:created:1';
  assert.equal(qurtWebhook.alreadySeen(id, NOW), false);
  assert.equal(qurtWebhook.alreadySeen(id, NOW + 1000), true);
  qurtWebhook.forget(id);
  assert.equal(qurtWebhook.alreadySeen(id, NOW + 2000), false);
});

test('ko\'rilganlar ro\'yxati muddati o\'tgach tozalanadi va cheklangan', () => {
  qurtWebhook._seen.clear();
  qurtWebhook.alreadySeen('old', NOW);
  assert.equal(qurtWebhook.alreadySeen('old', NOW + 16 * 60 * 1000), false, 'muddati o\'tgan qayta qabul qilinadi');
  qurtWebhook._seen.clear();
  for (let i = 0; i < 5100; i++) qurtWebhook.alreadySeen(`e${i}`, NOW);
  assert.ok(qurtWebhook._seen.size <= 5000, 'xotira cheksiz o\'smaydi');
});
