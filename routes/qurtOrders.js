// routes/qurtOrders.js
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const qurtSync = require('../services/qurtSync');
const qurtOrders = require('../services/qurtOrders');
const qurtWebhook = require('../services/qurtWebhook');

const { QurtOrderError } = qurtOrders;

/** Xatoni javobga aylantiradi: kutilgan xatolar o'z matni bilan, boshqalar umumiy xabar bilan. */
function fail(res, err) {
  if (err instanceof QurtOrderError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error('⚠️ [qurt-orders]', err && err.message);
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
    if (!str(b.event_id, 160) || !['created', 'cancelled'].includes(b.event) ||
        !qurtOrders.validId(b.order_id) || !qurtOrders.validId(b.store_id) || !str(b.number, 32)) {
      return res.status(400).json({ success: false, message: "Xabar formati noto'g'ri" });
    }
    if (qurtWebhook.alreadySeen(b.event_id)) return res.status(204).end(); // takror — allaqachon ishlangan

    try {
      const owner = await User.findOne({ ondexEntityId: b.store_id, ondexStoreCategory: 'qurt' }).select('login').lean();
      if (owner) {
        // Faqat KICHIK signal: tafsilotni panel o'zi (autentifikatsiya bilan) so'raydi.
        require('../socket').sendToUser(owner.login, 'qurtOrder', {
          event: b.event, orderId: b.order_id, number: b.number,
        });
        if (b.event === 'cancelled') await qurtOrders.restoreForOrder(b.order_id);
      }
      return res.status(204).end();
    } catch (e) {
      qurtWebhook.forget(b.event_id); // qayta yuborilsa qayta ishlansin
      console.error('⚠️ [qurt-orders webhook]', e && e.message);
      return res.status(500).json({ success: false, message: 'Server xatosi' });
    }
  });

  // ── Do'kon paneli ──
  router.get('/qurt-orders', verifyToken, requireQurtStore, async (req, res) => {
    try {
      const orders = await qurtOrders.listOrders(req.qurtUser, { status: req.query.status, limit: req.query.limit });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, orders });
    } catch (e) { fail(res, e); }
  });

  router.get('/qurt-orders/:id', verifyToken, requireQurtStore, async (req, res) => {
    try {
      const order = await qurtOrders.getOrder(req.qurtUser, req.params.id);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, order });
    } catch (e) { fail(res, e); }
  });

  router.post('/qurt-orders/:id/transition', verifyToken, csrfProtection, requireQurtStore, transitionLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const order = await qurtOrders.transition(req.qurtUser, req.user.login, req.params.id, body.to, body.reason);
      res.json({ success: true, order });
    } catch (e) { fail(res, e); }
  });

  return router;
};
