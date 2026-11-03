// services/qurtOrders.js
'use strict';

/**
 * Qurt buyurtmalari (do'kon tomoni): OnDex bilan server-server ishlaydi.
 *
 * Buyurtmalar OnDex'da saqlanadi (`/merchant/qurt/orders`); ShoxPos ularni
 * do'konga ko'rsatadi va holatini o'zgartiradi. Do'kon mijozning manzili va
 * telefonini KO'RMAYDI (OnDex ularni bu javobga qo'shmaydi).
 *
 * OMBOR QOLDIG'I: do'kon buyurtmani TASDIQLAGANDA tovar ombordan ayriladi
 * (OnDex shu paytda "band"ni qo'yib yuboradi — ikki marta sanalmasin). Tartib:
 *   1) qoldiq shartli atomik ayiriladi (`quantity >= qty`) — yetmasa tasdiqlanmaydi;
 *   2) OnDex'ga "confirmed" yuboriladi; muvaffaqiyatsiz bo'lsa qoldiq QAYTARILADI;
 *   3) ayirilgan miqdor `QurtOrderLedger` ga yoziladi (keyin bekor qilinsa bir marta qaytadi).
 */

const config = require('../config');
const qurtSync = require('./qurtSync');
const QurtOrderLedger = require('../models/QurtOrderLedger');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES = ['new', 'confirmed', 'rejected', 'packed', 'collected', 'out_for_delivery', 'delivered', 'failed', 'cancelled'];
/** Do'kon o'zgartira oladigan holatlar (OnDex ham aktor huquqini tekshiradi). */
const STORE_TARGETS = ['confirmed', 'rejected', 'packed'];
const MAX_REASON = 200;

class QurtOrderError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const validId = (id) => typeof id === 'string' && ID_RE.test(id);

function parseStatuses(raw) {
  if (raw === undefined || raw === '') return [];
  const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length > STATUSES.length || list.some((s) => !STATUSES.includes(s))) {
    throw new QurtOrderError(400, "Noma'lum holat");
  }
  return list;
}

/** OnDex xatosini do'konga tushunarli xatoga aylantiradi (ichki matn oqmaydi). */
function fromOndex(res) {
  const msg = res && res.data && typeof res.data.error === 'string' ? res.data.error : null;
  switch (res.status) {
    case 400: return new QurtOrderError(400, msg || "So'rov noto'g'ri");
    case 404: return new QurtOrderError(404, msg || 'Topilmadi');
    case 409: return new QurtOrderError(409, msg || "Buyurtma holatini o'zgartirib bo'lmaydi (boshqa joyda o'zgargan bo'lishi mumkin)");
    case 403: case 401: return new QurtOrderError(403, "Bu do'kon qurt buyurtmalarini boshqara olmaydi");
    case 429: return new QurtOrderError(429, "Juda ko'p so'rov. Birozdan so'ng urinib ko'ring");
    default: return new QurtOrderError(502, "OnDex bilan bog'lanib bo'lmadi. Keyinroq urinib ko'ring");
  }
}

async function ondex(user, method, path, data) {
  if (!qurtSync.configured()) throw new QurtOrderError(503, 'OnDex sozlanmagan');
  try {
    return await qurtSync.ondexCall(user, method, path, data);
  } catch (e) {
    throw new QurtOrderError(502, "OnDex bilan bog'lanib bo'lmadi. Keyinroq urinib ko'ring");
  }
}

async function listOrders(user, { status, limit } = {}) {
  const statuses = parseStatuses(status);
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const qs = `?limit=${n}${statuses.length ? `&status=${statuses.join(',')}` : ''}`;
  const res = await ondex(user, 'get', `/merchant/qurt/orders${qs}`);
  if (res.status !== 200) throw fromOndex(res);
  return Array.isArray(res.data && res.data.orders) ? res.data.orders : [];
}

async function getOrder(user, id) {
  if (!validId(id)) throw new QurtOrderError(404, 'Buyurtma topilmadi');
  const res = await ondex(user, 'get', `/merchant/qurt/orders/${encodeURIComponent(id)}`);
  if (res.status !== 200) throw fromOndex(res);
  return res.data;
}

// ── Ombor ──────────────────────────────────────────────────────────────

function itemsOf(order) {
  const merged = new Map();
  for (const it of order.items || []) {
    const barcode = typeof it.barcode === 'string' ? it.barcode : '';
    const qty = Number(it.qty);
    if (!barcode || !Number.isInteger(qty) || qty < 1) {
      throw new QurtOrderError(409, "Buyurtmadagi mahsulot kaliti noto'g'ri — OnDex ma'muriga murojaat qiling");
    }
    merged.set(barcode, (merged.get(barcode) || 0) + qty);
  }
  return [...merged].map(([barcode, qty]) => ({ barcode, qty }));
}

/** Bir nechta pozitsiyani qoldiqdan ayiradi; birortasi yetmasa avval ayirilganlarini qaytaradi. */
async function decrementStock(Product, login, items) {
  const done = [];
  for (const it of items) {
    // Shartli ayirish ($gte) atomik: ikki tasdiq birga oxirgi donani ola olmaydi.
    const res = await Product.collection.updateOne(
      { login, barcode: it.barcode, quantity: { $gte: it.qty } },
      { $inc: { quantity: -it.qty }, $set: { qurtSynced: false } },
    );
    if (res.matchedCount === 0) {
      await incrementStock(Product, login, done);
      const p = await Product.findOne({ login, barcode: it.barcode }).select('name quantity').lean();
      throw new QurtOrderError(
        409,
        p
          ? `«${p.name}» omborda yetarli emas (bor: ${p.quantity}, kerak: ${it.qty}). Avval qoldiqni to'ldiring yoki buyurtmani rad eting`
          : `Mahsulot omborda topilmadi (${it.barcode}). Buyurtmani rad eting`,
        'out_of_stock',
      );
    }
    done.push(it);
  }
}

async function incrementStock(Product, login, items) {
  for (const it of items) {
    await Product.collection.updateOne(
      { login, barcode: it.barcode },
      { $inc: { quantity: it.qty }, $set: { qurtSynced: false } },
    );
  }
}

function resync(login, items) {
  for (const it of items) qurtSync.schedule(login, it.barcode);
}

/**
 * Do'kon buyurtma holatini o'zgartiradi. Egalik OnDex'da tekshiriladi (boshqa do'kon
 * buyurtmasi "topilmadi"); bu yerda faqat ruxsat etilgan nishon holatlar va ombor.
 */
async function transition(user, login, id, to, reason) {
  if (!validId(id)) throw new QurtOrderError(404, 'Buyurtma topilmadi');
  if (!STORE_TARGETS.includes(to)) throw new QurtOrderError(400, "Bu holatni do'kon o'zgartira olmaydi");
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length > MAX_REASON) throw new QurtOrderError(400, `Sabab ko'pi bilan ${MAX_REASON} belgi`);
  if (to === 'rejected' && text.length < 3) throw new QurtOrderError(400, 'Rad etish sababini yozing (kamida 3 belgi)');

  const Product = require('../models/Product');
  const path = `/merchant/qurt/orders/${encodeURIComponent(id)}/transition`;

  if (to !== 'confirmed') {
    const res = await ondex(user, 'post', path, { to, reason: text });
    if (res.status !== 200) throw fromOndex(res);
    return res.data;
  }

  // ── Tasdiqlash: ombor + OnDex ──
  const order = await getOrder(user, id);
  if (order.status !== 'new') throw new QurtOrderError(409, "Buyurtma allaqachon ko'rib chiqilgan");
  const items = itemsOf(order);

  const existing = await QurtOrderLedger.findOne({ orderId: id }).lean();
  const alreadyReserved = existing && existing.state === 'reserved';
  if (!alreadyReserved) {
    await decrementStock(Product, login, items);
  }

  let res;
  try {
    res = await ondex(user, 'post', path, { to: 'confirmed' });
  } catch (e) {
    if (!alreadyReserved) await incrementStock(Product, login, items);
    resync(login, items);
    throw e;
  }
  if (res.status !== 200) {
    if (!alreadyReserved) await incrementStock(Product, login, items);
    resync(login, items);
    throw fromOndex(res);
  }

  if (!alreadyReserved) {
    await QurtOrderLedger.updateOne(
      { orderId: id },
      { $set: { login, items, state: 'reserved' }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  }
  resync(login, items);
  return res.data;
}

/**
 * Buyurtma tasdiqlangandan keyin bekor qilinganda (OnDex xabari): ayirilgan qoldiqni
 * aynan BIR MARTA qaytaradi. Ledger yo'q (tasdiqlanmagan) yoki allaqachon qaytarilgan bo'lsa hech narsa.
 */
async function restoreForOrder(orderId) {
  if (!validId(orderId)) return false;
  const led = await QurtOrderLedger.findOneAndUpdate(
    { orderId, state: 'reserved' },
    { $set: { state: 'restored' } },
    { new: false },
  ).lean();
  if (!led) return false;
  const Product = require('../models/Product');
  await incrementStock(Product, led.login, led.items);
  resync(led.login, led.items);
  return true;
}

// ── Logistika: do'konning o'z kuryerlari ────────────────────────────────
//
// Sotuvchi logistikani O'ZI hal qiladi: kuryer qo'shadi, buyurtmani biriktiradi, kuryer
// topshirgan naqd pulni qabul qiladi. Egalik (kuryer/buyurtma shu do'konniki) OnDex'da tekshiriladi.

const PHONE_RE = /^\+?[0-9]{9,15}$/;
const NAME_MAX = 80;

function cleanIds(ids) {
  if (ids === undefined || ids === null) return undefined;
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every(validId)) {
    throw new QurtOrderError(400, "Buyurtmalar ro'yxati noto'g'ri");
  }
  return ids;
}

async function listCouriers(user) {
  const res = await ondex(user, 'get', '/merchant/qurt/couriers');
  if (res.status !== 200) throw fromOndex(res);
  return Array.isArray(res.data && res.data.couriers) ? res.data.couriers : [];
}

async function addCourier(user, { phone, name } = {}) {
  const p = typeof phone === 'string' ? phone.replace(/[\s()-]/g, '') : '';
  const n = typeof name === 'string' ? name.trim() : '';
  if (!PHONE_RE.test(p)) throw new QurtOrderError(400, "Telefon raqami noto'g'ri");
  if (n.length < 2 || n.length > NAME_MAX) throw new QurtOrderError(400, `Ism 2..${NAME_MAX} belgi bo'lsin`);
  const res = await ondex(user, 'post', '/merchant/qurt/couriers', { phone: p, name: n });
  if (res.status !== 201) throw fromOndex(res);
  return res.data;
}

async function removeCourier(user, id) {
  if (!validId(id)) throw new QurtOrderError(404, 'Kuryer topilmadi');
  const res = await ondex(user, 'delete', `/merchant/qurt/couriers/${encodeURIComponent(id)}`);
  if (res.status !== 204 && res.status !== 200) throw fromOndex(res);
}

async function assign(user, { courierId, date, orderIds } = {}) {
  if (!validId(courierId)) throw new QurtOrderError(400, 'Kuryerni tanlang');
  const body = { courier_id: courierId };
  if (date !== undefined && date !== '') {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new QurtOrderError(400, "Sana noto'g'ri");
    body.date = date;
  }
  const ids = cleanIds(orderIds);
  if (ids) body.order_ids = ids;
  if (!body.date && !body.order_ids) throw new QurtOrderError(400, 'Reys sanasi yoki buyurtmalarni ko\'rsating');
  const res = await ondex(user, 'post', '/merchant/qurt/assign', body);
  if (res.status !== 200) throw fromOndex(res);
  return res.data;
}

async function unassign(user, orderId) {
  if (!validId(orderId)) throw new QurtOrderError(404, 'Buyurtma topilmadi');
  const res = await ondex(user, 'post', `/merchant/qurt/orders/${encodeURIComponent(orderId)}/unassign`);
  if (res.status !== 204 && res.status !== 200) throw fromOndex(res);
}

async function settle(user, courierId) {
  if (!validId(courierId)) throw new QurtOrderError(404, 'Kuryer topilmadi');
  const res = await ondex(user, 'post', `/merchant/qurt/couriers/${encodeURIComponent(courierId)}/settle`, {});
  if (res.status !== 200) throw fromOndex(res);
  return res.data;
}

module.exports = {
  QurtOrderError, validId, STATUSES, STORE_TARGETS,
  listOrders, getOrder, transition, restoreForOrder,
  listCouriers, addCourier, removeCourier, assign, unassign, settle,
  // sinov uchun
  _itemsOf: itemsOf, _parseStatuses: parseStatuses,
};
