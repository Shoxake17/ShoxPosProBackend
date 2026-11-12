/**
 * @file routes/auth.js
 * @description OnDex Merchant web paneli sessiyasi (A4c.4).
 *
 * Kirish/chiqish — `routes/oidcAuth.js` (OnDex OIDC + BFF). Bu yerda faqat
 * sessiya holati, profil va "Qurilmalar" (OnDex markaziy sessiyalari).
 */

const express = require('express');
const authController = require('../controllers/authController');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');

module.exports = (csrfProtection) => {
  const router = express.Router();

  /** GET /api/user-status — o'z hisobining holati (bloklangan/o'chirilgan). */
  router.get('/user-status', verifyToken, authController.userStatus);

  /** GET /api/user-devices — OnDex'dagi barcha faol sessiyalar. */
  router.get('/user-devices', verifyToken, authController.getUserDevices);

  /** POST /api/kick-device — boshqa qurilmani markazda chiqarish. */
  router.post('/kick-device', verifyToken, csrfProtection, authController.kickDevice);

  /** GET /api/verify-session — joriy sessiya va do'kon profili. */
  router.get('/verify-session', verifyToken, async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login });
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        valid: true,
        user: {
          id: user?._id || req.user.id,
          login: req.user.login,
          name: user?.name,
          shopName: user?.shopName,
          shopType: user?.shopType,
          storeCategory: user?.ondexStoreCategory || '',
          shopCategories: await authController.effectiveCategories(user),
        },
      });
    } catch (error) {
      console.error('❌ Verify session error:', error);
      res.status(500).json({ success: false, valid: false, message: 'Session tekshirish xatosi' });
    }
  });

  /** GET /api/me */
  router.get('/me', verifyToken, authController.getMe);

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
