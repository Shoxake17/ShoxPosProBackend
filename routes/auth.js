/**
 * @file routes/auth.js
 * @description OnDex Merchant web paneli sessiyasi (vaqtinchalik, A4 gacha).
 *
 * ┌─ NIMA QOLDI VA NEGA ──────────────────────────────────────────────────┐
 * Kimlik, akkaunt, rol, do'kon turi va admin funksiyalari OnDex identity'ga
 * o'tdi (ADR-002): bu yerdagi `register`, foydalanuvchini aktivlashtirish/
 * bloklash, foydalanuvchilar CRUD, `shop-types`, admin rol berish OLIB TASHLANDI.
 *
 * Qolganlari — faqat panel sessiyasining o'zi (refresh, logout, holat,
 * qurilmalar). A4 bosqichida bular ham markaziy sessiyaga (OIDC + BFF)
 * almashtiriladi: docs/architecture/AUTH-PHASE-A.md (ChustApp).
 * └───────────────────────────────────────────────────────────────────────┘
 */

const express = require('express');
const authController = require('../controllers/authController');
const User = require('../models/User');
const ShopType = require('../models/ShopType');
const verifyToken = require('../middleware/verifyToken');
const { cacheMiddleware, CACHE_TTL } = require('../middleware/redisCache');

module.exports = (csrfProtection) => {
  const router = express.Router();

  /** POST /api/refresh — panel sessiyasi tokenini yangilash. */
  router.post('/refresh', async (req, res) => {
    try {
      await authController.refresh(req, res);
    } catch (error) {
      console.error('❌ Refresh route error:', error);
      res.status(500).json({ success: false, message: 'Token yangilash xatosi' });
    }
  });

  /** POST /api/logout */
  router.post('/logout', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.logout(req, res);
    } catch (error) {
      console.error('❌ Logout route error:', error);
      res.status(500).json({ success: false, message: 'Logout xatosi' });
    }
  });

  /** GET /api/user-status — o'z hisobining holati (bloklangan/o'chirilgan). */
  router.get('/user-status', verifyToken, authController.userStatus);

  /** GET /api/user-devices — o'z qurilmalari. */
  router.get('/user-devices', verifyToken, async (req, res) => {
    try {
      await authController.getUserDevices(req, res);
    } catch (error) {
      console.error('❌ Get user devices error:', error);
      res.status(500).json({ success: false, message: 'Qurilmalarni yuklashda xato' });
    }
  });

  /** POST /api/kick-device — o'z qurilmasini chiqarish. */
  router.post('/kick-device', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.kickDevice(req, res);
    } catch (error) {
      console.error('❌ Kick device error:', error);
      res.status(500).json({ success: false, message: 'Qurilmani chiqarishda xato' });
    }
  });

  /** GET /api/verify-session — joriy sessiya va do'kon profili. */
  router.get('/verify-session', verifyToken, async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login });

      let effectiveCategories = user?.shopCategories || [];
      if (effectiveCategories.length === 0 && user?.shopType) {
        const typeData = await ShopType.findOne({ value: user.shopType });
        if (typeData) effectiveCategories = typeData.categories;
      }

      res.json({
        success: true,
        valid: true,
        user: {
          id: user?._id || req.user.id,
          login: req.user.login,
          role: req.user.role,
          shopName: user?.shopName,
          shopType: user?.shopType,
          storeCategory: user?.ondexStoreCategory || '',
          shopCategories: effectiveCategories,
        },
      });
    } catch (error) {
      console.error('❌ Verify session error:', error);
      res.status(500).json({ success: false, valid: false, message: 'Session tekshirish xatosi' });
    }
  });

  /** GET /api/me */
  router.get('/me', verifyToken, cacheMiddleware(CACHE_TTL.MEDIUM), authController.getMe);

  /** GET /api/health */
  router.get('/health', (req, res) => {
    res.json({ success: true, service: 'auth', status: 'healthy', timestamp: new Date().toISOString() });
  });

  router.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
      console.error('❌ CSRF token xatosi:', req.method, req.path);
      return res.status(403).json({
        success: false,
        message: "CSRF token noto'g'ri yoki mavjud emas",
        hint: 'Avval /api/csrf-token dan token oling',
      });
    }
    next(err);
  });

  return router;
};
