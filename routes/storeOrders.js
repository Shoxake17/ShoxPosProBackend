// routes/storeOrders.js
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const qurtSync = require('../services/qurtSync');
const storeOrders = require('../services/storeOrders');
const qurtWebhook = require('../services/qurtWebhook');

const { StoreOrderError } = storeOrders;

/** Xatoni javobga aylantiradi: kutilgan xatolar o'z matni bilan, boshqalar umumiy xabar bilan. */
function fail(res, err) {
  if (err instanceof StoreOrderError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error('⚠️ [store-orders]', err && err.message);
  return res.status(500).json({ success: false, message: 'Server xatosi' });
}

/** So'rov egasi — OnDex bilan bog'langan QURT do'koni. Boshqalarga 403. */
async function requireQurtStore(req, res, next) {
  try {
    const user = await User.findOne({ login: req.user.login }).select('login ondexUserId ondexStoreCategory').lean();
    if (!qurtSync.isQurtUser(user)) {
      return res.status(403).json({ success: false, message: "Bu bo'lim faqat qurt do'konlari uchun" });
    }
    req.qurtUser = user;
    return next();
  } catch (e) {
    return fail(res, e);
  }
}

/** Yangi buyurtma haqida Web Push; xatosi webhook'ni yiqitmaydi, eskirgan obuna tozalanadi. */
async function pushNewOrder(owner, orderId, number) {
  try {
    const { sendPushToUser } = require('../utils/webPush');
    const result = await sendPushToUser(owner.pushSubscription, {
      title: '🛒 Yangi buyurtma',
      body: `№ ${number} — qabul qilish uchun oching`,
      icon: '/ondexmerchant-192.png',
      badge: '/ondexmerchant-192.png',
      tag: `order-${orderId}`,
      url: '/orders',
    });
    if (result === 'expired') await User.updateOne({ login: owner.login }, { pushSubscription: null });
  } catch (e) {
    console.error('⚠️ [store-orders push]', e && e.message);
  }
}

/** OnDex yuboradigan voqealar: buyurtmaning har bir o'zgarishi (panel jonli yangilanadi). */
const WEBHOOK_EVENTS = ['created', 'confirmed', 'rejected', 'packed', 'collected', 'out_for_delivery', 'delivered',
  'failed', 'cancelled', 'assigned', 'unassigned', 'cash_settled'];

module.exports = (csrfProtection) => {
  const router = express.Router();

  // Holatni o'zgartirish: login bo'yicha cheklov (tasdiq/rad ketma-ket bosilishi, suiiste'mol).
  const transitionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `qo:${req.user && req.user.login}`,
    validate: { keyGeneratorIpFallback: false },
    message: { success: false, message: "Juda ko'p urinish. Birozdan so'ng qayta urining" },
  });

  // ── OnDex -> ShoxPos jonli signal (cookie/CSRF YO'Q — imzo bilan himoyalangan) ──
  router.post('/qurt-orders/webhook', async (req, res) => {
    const check = qurtWebhook.verify({
      secret: config.QURT_WEBHOOK_SECRET,
      timestamp: req.get('x-ondex-timestamp'),
      signature: req.get('x-ondex-signature'),
      rawBody: req.rawBody,
    });
    if (!check.ok) return res.status(check.status).json({ success: false, message: check.reason });

    const b = req.body || {};
    const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
    if (!str(b.event_id, 160) || !WEBHOOK_EVENTS.includes(b.event) ||
        !storeOrders.validId(b.order_id) || !storeOrders.validId(b.store_id) || !str(b.number, 32)) {
      return res.status(400).json({ success: false, message: "Xabar formati noto'g'ri" });
    }
    if (qurtWebhook.alreadySeen(b.event_id)) return res.status(204).end(); // takror — allaqachon ishlangan

    try {
      const owner = await User.findOne({ ondexEntityId: b.store_id, ondexStoreCategory: 'qurt' }).select('login pushSubscription').lean();
      if (owner) {
        const socketApi = require('../socket');
        // Faqat KICHIK signal: tafsilotni panel o'zi (autentifikatsiya bilan) so'raydi.
        socketApi.sendToUser(owner.login, 'storeOrder', {
          event: b.event, orderId: b.order_id, number: b.number, status: typeof b.status === 'string' ? b.status : undefined,
        });
        // Panel ochiq bo'lmasa (jonli ulanish yo'q) — tizim bildirishnomasi (Web Push).
        if (b.event === 'created' && owner.pushSubscription && !(socketApi.getUserSockets()[owner.login] || []).length) {
          await pushNewOrder(owner, b.order_id, b.number);
        }
        if (b.event === 'cancelled') await storeOrders.restoreForOrder(b.order_id);
      }
      return res.status(204).end();
    } catch (e) {
      qurtWebhook.forget(b.event_id); // qayta yuborilsa qayta ishlansin
      console.error('⚠️ [store-orders webhook]', e && e.message);
      return res.status(500).json({ success: false, message: 'Server xatosi' });
    }
  });

  // ── Do'kon paneli ──
  router.get('/store-orders', verifyToken, requireQurtStore, async (req, res) => {
    try {
      const orders = await storeOrders.listOrders(req.qurtUser, { status: req.query.status, limit: req.query.limit });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, orders });
    } catch (e) { fail(res, e); }
  });

  // ── Logistika: do'konning o'z kuryerlari (sotuvchi o'zi boshqaradi) ──
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { fail(res, e); }
  };
  const mutate = [verifyToken, csrfProtection, requireQurtStore, transitionLimiter];

  router.get('/store-couriers', verifyToken, requireQurtStore, wrap(async (req, res) => {
    const couriers = await storeOrders.listCouriers(req.qurtUser);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, couriers });
  }));

  router.post('/store-couriers', ...mutate, wrap(async (req, res) => {
    const courier = await storeOrders.addCourier(req.qurtUser, req.body || {});
    res.status(201).json({ success: true, courier });
  }));

  router.delete('/store-couriers/:id', ...mutate, wrap(async (req, res) => {
    await storeOrders.removeCourier(req.qurtUser, req.params.id);
    res.json({ success: true });
  }));

  router.post('/store-couriers/:id/settle', ...mutate, wrap(async (req, res) => {
    const result = await storeOrders.settle(req.qurtUser, req.params.id);
    res.json({ success: true, result });
  }));

  router.post('/store-assign', ...mutate, wrap(async (req, res) => {
    const b = req.body || {};
    const result = await storeOrders.assign(req.qurtUser, { courierId: b.courierId, date: b.date, orderIds: b.orderIds });
    res.json({ success: true, result });
  }));

  router.post('/store-orders/:id/unassign', ...mutate, wrap(async (req, res) => {
    await storeOrders.unassign(req.qurtUser, req.params.id);
    res.json({ success: true });
  }));

  router.get('/store-orders/:id', verifyToken, requireQurtStore, async (req, res) => {
    try {
      const order = await storeOrders.getOrder(req.qurtUser, req.params.id);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, order });
    } catch (e) { fail(res, e); }
  });

  router.post('/store-orders/:id/transition', verifyToken, csrfProtection, requireQurtStore, transitionLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const order = await storeOrders.transition(req.qurtUser, req.user.login, req.params.id, body.to, body.reason);
      res.json({ success: true, order });
    } catch (e) { fail(res, e); }
  });

  return router;
};
