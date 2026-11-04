// tests/storeLogistics.test.js — `node --test tests/`
//
// Logistika (do'konning o'z kuryerlari): OnDex'ga ketadigan so'rovlar va kirish tekshiruvi.
// OnDex javobi soxta; haqiqiy tarmoqqa chiqilmaydi.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'ADMIN_DEVICE_ID',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/shoxpos_qurt_logistics_unused'; // ulanilmaydi\nprocess.env.ONDEX_API_URL = 'http://127.0.0.1:9';
process.env.SSO_CLIENT_SECRET = 'x'.repeat(40);

const qurtSync = require('../services/qurtSync');
const storeOrders = require('../services/storeOrders');

const USER = { login: 'qurt-test-store', ondexUserId: 'ondex-u1', ondexStoreCategory: 'qurt' };

let calls;
let reply;
qurtSync.ondexCall = async (user, method, path, data) => {
  calls.push({ method, path, data });
  return reply;
};
test.beforeEach(() => { calls = []; reply = { status: 200, data: {} }; });
test.after(() => process.exit(0)); // qurtSync taymerlari

test('kuryer qo\'shish: noto\'g\'ri telefon/ism OnDex\'ga yetmaydi', async () => {
  for (const body of [{}, { phone: '123', name: 'Ali' }, { phone: '+998901112233', name: 'A' },
    { phone: '+998901112233', name: 'x'.repeat(81) }, { phone: 12345, name: 'Ali' }]) {
    await assert.rejects(storeOrders.addCourier(USER, body), (e) => e.status === 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('kuryer qo\'shish: telefon tozalanib yuboriladi, 201 qabul qilinadi', async () => {
  reply = { status: 201, data: { id: 'qurt-1', name: 'Ali', phone: '+998901112233' } };
  const r = await storeOrders.addCourier(USER, { phone: '+998 (90) 111-22-33', name: ' Ali ' });
  assert.equal(r.id, 'qurt-1');
  assert.deepEqual(calls[0], { method: 'post', path: '/merchant/qurt/couriers', data: { phone: '+998901112233', name: 'Ali' } });
});

test('OnDex 409/403 do\'konga tushunarli xato bo\'lib chiqadi', async () => {
  reply = { status: 409, data: { error: 'bu raqamda boshqa akkaunt bor' } };
  await assert.rejects(storeOrders.addCourier(USER, { phone: '+998901112233', name: 'Ali' }),
    (e) => e.status === 409 && /boshqa akkaunt/.test(e.message));
  reply = { status: 403, data: {} };
  await assert.rejects(storeOrders.listCouriers(USER), (e) => e.status === 403);
});

test('biriktirish: sana yoki buyurtmalar shart; ID lar tekshiriladi', async () => {
  await assert.rejects(storeOrders.assign(USER, { courierId: 'k1' }), (e) => e.status === 400);
  await assert.rejects(storeOrders.assign(USER, { courierId: '../x', date: '2026-11-06' }), (e) => e.status === 400);
  await assert.rejects(storeOrders.assign(USER, { courierId: 'k1', date: 'ertaga' }), (e) => e.status === 400);
  await assert.rejects(storeOrders.assign(USER, { courierId: 'k1', orderIds: ['a/b'] }), (e) => e.status === 400);
  await assert.rejects(storeOrders.assign(USER, { courierId: 'k1', orderIds: 'x' }), (e) => e.status === 400);
  await assert.rejects(storeOrders.assign(USER, { courierId: 'k1', orderIds: Array(501).fill('a') }), (e) => e.status === 400);
  assert.equal(calls.length, 0);

  reply = { status: 200, data: { assigned: 2, skipped: 0 } };
  const r = await storeOrders.assign(USER, { courierId: 'k1', date: '2026-11-06' });
  assert.equal(r.assigned, 2);
  assert.deepEqual(calls[0].data, { courier_id: 'k1', date: '2026-11-06' });
});

test('olib tashlash, pul qabul qilish va o\'chirish: noto\'g\'ri ID — so\'rov yuborilmaydi', async () => {
  for (const id of ['../admin', 'a/b', '', 'x'.repeat(80)]) {
    await assert.rejects(storeOrders.settle(USER, id), (e) => e.status === 404);
    await assert.rejects(storeOrders.removeCourier(USER, id), (e) => e.status === 404);
    await assert.rejects(storeOrders.unassign(USER, id), (e) => e.status === 404);
  }
  assert.equal(calls.length, 0);

  reply = { status: 200, data: { orders: 1, total_tiyin: 2400000 } };
  assert.equal((await storeOrders.settle(USER, 'k1')).total_tiyin, 2400000);
  assert.equal(calls[0].path, '/merchant/qurt/couriers/k1/settle');
  reply = { status: 204, data: '' };
  await storeOrders.removeCourier(USER, 'k1');
  await storeOrders.unassign(USER, 'o1');
  assert.equal(calls[1].method, 'delete');
  assert.equal(calls[2].path, '/merchant/qurt/orders/o1/unassign');
});
