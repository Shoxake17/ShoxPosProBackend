// services/qurtSync.js
'use strict';

/**
 * QURT mahsulotlarini OnDex'ga yuboradi (mijoz ilovasidagi Qurt sahifasi shundan o'qiydi).
 *
 * Oqim (hammasi server-server, OnDex klient SIRI bilan; brauzer OnDex'ga tegmaydi):
 *   * rasm:      uploadImage()  -> OnDex `POST /merchant/qurt/uploads` -> manzil
 *   * mahsulot:  reconcile()    -> OnDex `PUT/DELETE /merchant/qurt/products/{barcode}`
 *
 * RECONCILE modeli: mahsulot yozuvidagi har qanday o'zgarish (`models/Product.js`
 * hook'lari) `schedule()` ni chaqiradi; u qisqa kutib, mahsulotning HOZIRGI holatini
 * o'qiydi va OnDex'ga yuboradi (yo'q bo'lsa — o'chiradi). Shu tufayli narx, qoldiq,
 * o'chirish — qaysi marshrutdan kelishidan qat'i nazar — har doim bir xil natija beradi.
 *
 * Ishonchlilik: muvaffaqiyatsizlik `qurtSynced=false` (yoki o'chirish uchun
 * `QurtOutbox`) bo'lib qoladi va davriy sikl (`startRetryLoop`) qayta urinadi.
 * Ya'ni OnDex vaqtincha o'chiq bo'lsa ham ma'lumot yo'qolmaydi.
 *
 * Qurt FAQAT OnDex'da kategoriyasi `qurt` bo'lgan do'konlar uchun: OnDex o'zi ham
 * buni har so'rovda tekshiradi.
 */

const axios = require('axios');
const config = require('../config');
const User = require('../models/User');
const QurtOutbox = require('../models/QurtOutbox');

const DEBOUNCE_MS = 400;
const TIMEOUT_MS = 10000;
const RETRY_EVERY_MS = 2 * 60 * 1000;
const RETRY_BATCH = 20;

const pendingTimers = new Map(); // "login\0barcode" -> Timeout

const configured = () =>
  Boolean(config.ONDEX_API_URL && config.SSO_CLIENT_ID && config.SSO_CLIENT_SECRET);

const baseUrl = () => String(config.ONDEX_API_URL).replace(/\/+$/, '');

function authHeaders(ondexUserId, extra = {}) {
  return {
    'X-Client-Id': config.SSO_CLIENT_ID,
    'X-Client-Secret': config.SSO_CLIENT_SECRET,
    'X-Store-User': ondexUserId,
    ...extra,
  };
}

/** Do'kon hisobi qurtmi (va OnDex bilan bog'langanmi). */
const isQurtUser = (u) => Boolean(u && u.ondexStoreCategory === 'qurt' && u.ondexUserId);

/** ShoxPos mahsuloti -> OnDex yuborma. To'liq emas bo'lsa `null` (hali nashr qilinmaydi). */
function toPayload(p) {
  const priceTiyin = Math.round(Number(p.price) * 100);
  const wholesaleTiyin = Math.round(Number(p.basePrice || 0) * 100);
  const weight = Math.round(Number(p.weightGrams));
  if (!p.name || !p.category || !(priceTiyin > 0) || !(weight >= 1)) return null;
  return {
    name: p.name,
    description: p.description || '',
    composition: p.composition || '',
    category: p.category,
    price_tiyin: priceTiyin,
    wholesale_tiyin: wholesaleTiyin,
    weight_grams: weight,
    image_url: p.imageUrl || '',
    available: Number(p.quantity) > 0,
  };
}

const keyOf = (login, barcode) => `${login}\u0000${barcode}`;

/** O'zgarishdan keyin (qisqa kutib) shu mahsulotni OnDex bilan solishtiradi. */
function schedule(login, barcode) {
  if (!configured()) return;
  const k = keyOf(login, barcode);
  clearTimeout(pendingTimers.get(k));
  const t = setTimeout(() => {
    pendingTimers.delete(k);
    reconcile(login, barcode).catch((e) => console.error(`⚠️ [qurt] ${login}/${barcode}: ${e.message}`));
  }, DEBOUNCE_MS);
  if (t.unref) t.unref();
  pendingTimers.set(k, t);
}

async function markSynced(Product, id, value) {
  // Mongoose hook'larini ATAYLAB aylanib o'tamiz (o'z yozuvimiz qayta sinxronlashni boshlamasin).
  await Product.collection.updateOne({ _id: id }, { $set: { qurtSynced: value } });
}

/**
 * Mahsulotning hozirgi holatini OnDex'ga o'tkazadi. Qurt bo'lmagan do'kon yoki
 * to'liq bo'lmagan mahsulot uchun hech narsa qilmaydi.
 */
async function reconcile(login, barcode) {
  const Product = require('../models/Product'); // lazy: model hook'lari shu servisni chaqiradi
  const user = await User.findOne({ login }).select('ondexUserId ondexStoreCategory').lean();
  if (!isQurtUser(user)) return;

  const product = await Product.findOne({ login, barcode }).lean();
  const url = `${baseUrl()}/merchant/qurt/products/${encodeURIComponent(barcode)}`;
  const headers = authHeaders(user.ondexUserId);

  if (!product) {
    try {
      const res = await axios.delete(url, { headers, timeout: TIMEOUT_MS, validateStatus: () => true });
      if (res.status === 200) {
        await QurtOutbox.deleteOne({ login, barcode });
        return;
      }
      throw new Error(`OnDex ${res.status}`);
    } catch (e) {
      await QurtOutbox.updateOne({ login, barcode }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      throw e;
    }
  }

  const payload = toPayload(product);
  if (!payload) return; // to'liq emas (masalan gramm kiritilmagan) — nashr qilinmaydi
  try {
    const res = await axios.put(url, payload, { headers, timeout: TIMEOUT_MS, validateStatus: () => true });
    if (res.status === 200) {
      await QurtOutbox.deleteOne({ login, barcode }); // qayta qo'shilgan bo'lsa eski o'chirish bekor
      await markSynced(Product, product._id, true);
      return;
    }
    if (res.status === 400) {
      // OnDex qiymatni rad etdi: qayta urinish foydasiz, har 2 daqiqada urilmasin.
      console.error(`⚠️ [qurt] ${login}/${barcode}: OnDex rad etdi: ${JSON.stringify(res.data).slice(0, 200)}`);
      await markSynced(Product, product._id, true);
      return;
    }
    throw new Error(`OnDex ${res.status}`);
  } catch (e) {
    await markSynced(Product, product._id, false);
    throw e;
  }
}

/**
 * Davriy qayta urinish: yuborilmay qolgan mahsulotlar va o'chirilmay qolgan yozuvlar.
 * Faqat qurt do'konlari ko'riladi (boshqalarning mahsulotlari ro'yxatni to'ldirib
 * qo'ymasligi uchun).
 */
async function retryPending() {
  if (!configured()) return;
  const Product = require('../models/Product');

  const qurtUsers = await User.find({ ondexStoreCategory: 'qurt', ondexUserId: { $exists: true } })
    .select('login').lean();
  for (const u of qurtUsers) {
    const items = await Product.find({
      login: u.login, weightGrams: { $gt: 0 }, qurtSynced: { $ne: true },
    }).select('barcode').limit(RETRY_BATCH).lean();
    for (const it of items) {
      await reconcile(u.login, it.barcode).catch((e) =>
        console.error(`⚠️ [qurt retry] ${u.login}/${it.barcode}: ${e.message}`));
    }
  }

  const outbox = await QurtOutbox.find({}).limit(RETRY_BATCH).lean();
  for (const o of outbox) {
    await reconcile(o.login, o.barcode).catch((e) =>
      console.error(`⚠️ [qurt outbox] ${o.login}/${o.barcode}: ${e.message}`));
  }
}

function startRetryLoop() {
  if (!configured()) return;
  let running = false;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try { await retryPending(); } catch (e) { console.error(`⚠️ [qurt retry] ${e.message}`); } finally { running = false; }
  }, RETRY_EVERY_MS);
  if (t.unref) t.unref();
}

/**
 * Rasmni OnDex omboriga yuklaydi. Qaytadi: OnDex rasm manzili.
 * Xatoda `Error` tashlaydi; `err.status` — mijozga qaytariladigan HTTP kodi.
 */
async function uploadImage(user, buffer, filename, mimetype, ip) {
  if (!configured()) throw Object.assign(new Error("OnDex sozlanmagan"), { status: 503 });
  if (!isQurtUser(user)) throw Object.assign(new Error("Faqat qurt do'konlari uchun"), { status: 403 });

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  let res;
  try {
    res = await fetch(`${baseUrl()}/merchant/qurt/uploads`, {
      method: 'POST',
      headers: authHeaders(user.ondexUserId, ip ? { 'X-Forwarded-For': ip } : {}),
      body: form,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw Object.assign(new Error('OnDex bilan bog\'lanib bo\'lmadi'), { status: 503 });
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* JSON emas */ }
  if (res.status === 201 && data && typeof data.url === 'string') return data.url;
  if (res.status === 400) throw Object.assign(new Error((data && data.error) || "Rasm qabul qilinmadi"), { status: 400 });
  if (res.status === 429) throw Object.assign(new Error("Juda ko'p yuklash. Birozdan so'ng urinib ko'ring"), { status: 429 });
  console.error(`⚠️ [qurt upload] OnDex ${res.status}`);
  throw Object.assign(new Error("Rasm yuklab bo'lmadi. Keyinroq urinib ko'ring"), { status: 502 });
}

module.exports = { schedule, reconcile, retryPending, startRetryLoop, uploadImage, isQurtUser, toPayload };
