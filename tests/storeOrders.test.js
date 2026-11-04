// tests/storeOrders.test.js — `node --test tests/`
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Config envalid majburiy o'zgaruvchilarni talab qiladi — sinov uchun soxta qiymatlar.
for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'MONGO_URI', 'ADMIN_DEVICE_ID',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
process.env.MONGO_URI = process.env.MONGO_URI.startsWith('mongodb') ? process.env.MONGO_URI : 'mongodb://127.0.0.1:1/x';

const { isAllowed } = require('../services/storeAccess');
const storeOrders = require('../services/storeOrders');

test('qurt do\'koni buyurtmalar yo\'liga ruxsat oladi, boshqa kategoriya cheklanmaydi', () => {
  assert.equal(isAllowed('qurt', '/store-orders'), true);
  assert.equal(isAllowed('qurt', '/store-orders/abc/transition'), true);
  assert.equal(isAllowed('qurt', '/store-orders-evil'), false, 'prefiks aldovi');
  assert.equal(isAllowed('qurt', '/qurt-orders/webhook'), true, "OnDex webhook manzili o'zgarmagan");
  assert.equal(isAllowed('qurt', '/store-couriers'), true);
  assert.equal(isAllowed('qurt', '/store-couriers/k1/settle'), true);
  assert.equal(isAllowed('qurt', '/store-assign'), true);
  assert.equal(isAllowed('qurt', '/store-couriers-evil'), false, 'prefiks aldovi');
  assert.equal(isAllowed('qurt', '/menu'), false);
});

test('ID tekshiruvi yo\'l inyeksiyasini to\'sadi', () => {
  for (const bad of ['', '../x', 'a/b', 'a b', 'a?x=1', '%2e%2e', 'x'.repeat(65), null, undefined, 5]) {
    assert.equal(storeOrders.validId(bad), false, String(bad));
  }
  for (const ok of ['abc123', 'o-1_x', 'A'.repeat(64)]) assert.equal(storeOrders.validId(ok), true);
});

test('holat filtri: faqat ma\'lum holatlar', () => {
  assert.deepEqual(storeOrders._parseStatuses('new,confirmed'), ['new', 'confirmed']);
  assert.deepEqual(storeOrders._parseStatuses(undefined), []);
  assert.throws(() => storeOrders._parseStatuses('new,bogus'), (e) => e.status === 400);
  assert.throws(() => storeOrders._parseStatuses("new'--"), (e) => e.status === 400);
});

test('buyurtma pozitsiyalari: takrorlar birlashadi, noto\'g\'ri qiymat rad etiladi', () => {
  assert.deepEqual(
    storeOrders._itemsOf({ items: [{ barcode: 'a', qty: 2 }, { barcode: 'b', qty: 1 }, { barcode: 'a', qty: 3 }] }),
    [{ barcode: 'a', qty: 5 }, { barcode: 'b', qty: 1 }],
  );
  for (const bad of [{ barcode: '', qty: 1 }, { qty: 1 }, { barcode: 'a', qty: 0 }, { barcode: 'a', qty: 1.5 }, { barcode: 'a', qty: -1 }]) {
    assert.throws(() => storeOrders._itemsOf({ items: [bad] }), (e) => e.status === 409);
  }
});
