// tests/storeOrdersStock.test.js — `node --test tests/`
//
// Qurt buyurtmasini tasdiqlash/bekor qilishda OMBOR qoldig'i: haqiqiy Mongo (alohida vaqtincha
// baza) bilan; OnDex javobi soxta. Mongo yo'q bo'lsa test o'tkazib yuboriladi.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'ADMIN_DEVICE_ID',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
const DB = `shoxpos_qurt_orders_test_${process.pid}`;
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/${DB}`;
process.env.ONDEX_API_URL = 'http://127.0.0.1:9'; // soxtalanadi; haqiqiy tarmoqqa chiqilmaydi
process.env.SSO_CLIENT_SECRET = 'x'.repeat(40);

const mongoose = require('mongoose');
const qurtSync = require('../services/qurtSync');
const storeOrders = require('../services/storeOrders');
const Product = require('../models/Product');
const QurtOrderLedger = require('../models/QurtOrderLedger');

const LOGIN = 'qurt-test-store';
const USER = { login: LOGIN, ondexUserId: 'ondex-u1', ondexStoreCategory: 'qurt' };

let mongoOk = false;

test.before(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    mongoOk = true;
  } catch {
    mongoOk = false;
  }
});

test.after(async () => {
  if (mongoOk) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
  process.exit(0); // qurtSync debounce taymerlari
});

// OnDex'ni soxtalashtirish: order — hozirgi buyurtma, transitionStatus — o'tish javobi.
let order;
let transitionStatus;
let calls;
qurtSync.ondexCall = async (user, method, path, data) => {
  calls.push({ method, path, data });
  if (method === 'get') return { status: 200, data: order };
  return transitionStatus === 200
    ? { status: 200, data: { ...order, status: data.to } }
    : { status: transitionStatus, data: { error: 'xato' } };
};

async function seed(stock) {
  await Product.collection.deleteMany({ login: LOGIN });
  await QurtOrderLedger.deleteMany({});
  await Product.collection.insertMany([
    { login: LOGIN, barcode: 'a', name: 'Qurt A', price: 100, quantity: stock.a },
    { login: LOGIN, barcode: 'b', name: 'Qurt B', price: 200, quantity: stock.b },
  ]);
  calls = [];
  transitionStatus = 200;
  order = {
    id: 'ord1', status: 'new',
    items: [{ barcode: 'a', name: 'Qurt A', qty: 3 }, { barcode: 'b', name: 'Qurt B', qty: 2 }],
  };
}
const qty = async (barcode) => (await Product.collection.findOne({ login: LOGIN, barcode })).quantity;

test('tasdiqlash: qoldiq ayiriladi va ledger yoziladi', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  await storeOrders.transition(USER, LOGIN, 'ord1', 'confirmed');
  assert.equal(await qty('a'), 7);
  assert.equal(await qty('b'), 8);
  const led = await QurtOrderLedger.findOne({ orderId: 'ord1' }).lean();
  assert.equal(led.state, 'reserved');
  assert.deepEqual(led.items, [{ barcode: 'a', qty: 3 }, { barcode: 'b', qty: 2 }]);
  assert.ok(calls.some((c) => c.method === 'post' && c.data.to === 'confirmed'));
});

test('qoldiq yetmasa: tasdiqlanmaydi, hech narsa o\'zgarmaydi, OnDex\'ga so\'rov ketmaydi', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 1 }); // b da 2 kerak
  await assert.rejects(storeOrders.transition(USER, LOGIN, 'ord1', 'confirmed'),
    (e) => e.status === 409 && e.code === 'out_of_stock');
  assert.equal(await qty('a'), 10, 'avval ayirilgan a qaytarilishi kerak');
  assert.equal(await qty('b'), 1);
  assert.equal(await QurtOrderLedger.countDocuments({}), 0);
  assert.equal(calls.filter((c) => c.method === 'post').length, 0);
});

test('OnDex rad etsa: ayirilgan qoldiq QAYTARILADI, ledger yo\'q', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  transitionStatus = 409;
  await assert.rejects(storeOrders.transition(USER, LOGIN, 'ord1', 'confirmed'), (e) => e.status === 409);
  assert.equal(await qty('a'), 10);
  assert.equal(await qty('b'), 10);
  assert.equal(await QurtOrderLedger.countDocuments({}), 0);
});

test('allaqachon ko\'rib chiqilgan buyurtma qayta tasdiqlanmaydi (qoldiq ikki marta ayirilmaydi)', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  order.status = 'confirmed';
  await assert.rejects(storeOrders.transition(USER, LOGIN, 'ord1', 'confirmed'), (e) => e.status === 409);
  assert.equal(await qty('a'), 10);
});

test('bekor qilinganda qoldiq aynan BIR MARTA qaytadi', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  await storeOrders.transition(USER, LOGIN, 'ord1', 'confirmed');
  assert.equal(await qty('a'), 7);
  assert.equal(await storeOrders.restoreForOrder('ord1'), true);
  assert.equal(await qty('a'), 10);
  assert.equal(await qty('b'), 10);
  assert.equal(await storeOrders.restoreForOrder('ord1'), false, 'takroriy xabar qoldiqni qo\'shmasin');
  assert.equal(await qty('a'), 10);
  assert.equal(await storeOrders.restoreForOrder('yoq-buyurtma'), false, 'tasdiqlanmagan buyurtma — hech narsa');
});

test('rad etish va qadoqlash qoldiqqa tegmaydi; rad etishda sabab shart', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  await assert.rejects(storeOrders.transition(USER, LOGIN, 'ord1', 'rejected', ''), (e) => e.status === 400);
  await storeOrders.transition(USER, LOGIN, 'ord1', 'rejected', 'Mahsulot tugagan');
  order.status = 'confirmed';
  await storeOrders.transition(USER, LOGIN, 'ord1', 'packed');
  assert.equal(await qty('a'), 10);
  assert.equal(await qty('b'), 10);
});

test('do\'kon faqat confirmed/rejected/packed ni o\'zgartira oladi', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  for (const to of ['collected', 'delivered', 'cancelled', 'out_for_delivery', 'new', '', undefined, '../x']) {
    await assert.rejects(storeOrders.transition(USER, LOGIN, 'ord1', to), (e) => e.status === 400, String(to));
  }
  assert.equal(calls.length, 0, 'OnDex\'ga so\'rov ketmasligi kerak');
});

test('noto\'g\'ri ID — OnDex\'ga so\'rov yuborilmaydi', async (t) => {
  if (!mongoOk) return t.skip('Mongo yo\'q');
  await seed({ a: 10, b: 10 });
  for (const id of ['../admin', 'a/b', '', 'x'.repeat(80)]) {
    await assert.rejects(storeOrders.getOrder(USER, id), (e) => e.status === 404);
    await assert.rejects(storeOrders.transition(USER, LOGIN, id, 'packed'), (e) => e.status === 404);
  }
  assert.equal(calls.length, 0);
});
