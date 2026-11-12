// tests/tenantIsolation.test.js — `node --test tests/`
//
// 2026-11-12: "admin" roli va `req.user.role !== 'admin'` chetlab o'tishi
// (37 joyda) OLIB TASHLANDI. Ilgari bitta maydon (role) boshqa barcha
// do'konlarning mahsulot/sotuv/qarz/dorixona ma'lumotini ochardi. Endi
// tenant kaliti FAQAT `req.user.login`. Bu test:
//   1) sessiyaga eski "admin" roli yopishgan bo'lsa ham begona do'kon 403;
//   2) marshrutlarda role asosidagi istisno qayta paydo bo'lmasin (statik).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'MONGO_URI', 'ADMIN_DEVICE_ID', 'QR_SECRET_KEY']) {
  process.env[k] = process.env[k] || 'test-' + k;
}
process.env.MONGO_URI = process.env.MONGO_URI.startsWith('mongodb') ? process.env.MONGO_URI : 'mongodb://127.0.0.1:1/x';

// verifyToken o'rniga: sessiya "admin" rolini olib kelgandek (eski yozuv).
const vtPath = require.resolve('../middleware/verifyToken');
require.cache[vtPath] = {
  id: vtPath, filename: vtPath, loaded: true,
  exports: (req, _res, next) => { req.user = { id: 'u1', login: '998901111111', role: 'admin', deviceId: 's1' }; next(); },
};

const express = require('express');
const noCsrf = (_req, _res, next) => next();

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/products', require('../routes/loginProducts')(noCsrf));
  a.use('/api/products', require('../routes/productRoutes')(noCsrf));
  a.use('/api', require('../routes/scanProducts')(noCsrf));
  a.use('/api', require('../routes/debts')(noCsrf));
  a.use('/api', require('../routes/salesRoutes')(noCsrf));
  a.use('/api/pharmacy', require('../routes/pharmacyRoutes')(noCsrf));
  return a;
}

test("eski 'admin' roli bilan ham BEGONA do'kon ma'lumoti 403", async () => {
  const server = http.createServer(app());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const paths = [
    '/api/debts/998902222222',
    '/api/products/user-products/998902222222',
    '/api/sales/998902222222',
    '/api/sold-buckets/998902222222',
    '/api/scan-product/998902222222',
    '/api/pharmacy/user-pharm-products/998902222222',
    '/api/pharmacy/pharm-kirim/998902222222',
  ];
  try {
    for (const p of paths) {
      const res = await fetch(base + p, { signal: AbortSignal.timeout(5000) });
      assert.equal(res.status, 403, `XAVFSIZLIK: ${p} begona do'konga ${res.status} qaytardi`);
    }
  } finally {
    server.close();
  }
});

test("marshrutlarda role asosidagi tenant istisnosi YO'Q (regressiya qo'riqchisi)", () => {
  const dir = path.join(__dirname, '..', 'routes');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /req\.user\.role/, `${f}: req.user.role ishlatilmasin — tenant faqat login`);
  }
});
