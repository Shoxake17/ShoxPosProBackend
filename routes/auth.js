/**
 * @file routes/auth.js
 * @description Autentifikatsiya, foydalanuvchi boshqaruvi va admin RBAC endpointlari
 * @version 2.2.0 - CSRF INSTANCE MUAMMOSI TUZATILDI
 *
 * ✅ FIX: Bu fayl endi csrfProtection ni o'zi yaratmaydi.
 *         server.js dan bitta shared instance qabul qiladi.
 *         Ikki xil instance bo'lsa cookie'dagi token bilan
 *         header'dagi token mos kelmay 403 xatosi beradi.
 */

const express = require('express');
const authController = require('../controllers/authController');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const loginLimiter = require('../middleware/rateLimit');
const { loginValidation, registerValidation, handleValidationErrors } = require('../middleware/validateAuth');

// ✅ Factory pattern: csrfProtection tashqaridan uzatiladi
module.exports = (csrfProtection) => {
  const router = express.Router();

  // ====================================
  // 🔓 PUBLIC ENDPOINTS (CSRF'siz)
  // ====================================

  /**
   * @route POST /api/login
   * @description Foydalanuvchini tizimga kiritish - BLOKLANGAN USER TEKSHIRUVI BILAN
   * @access Public (rate limited - credential stuffing oldini olish)
   */
  router.post('/login', loginLimiter, (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
    }
    next();
  }, loginValidation, handleValidationErrors, async (req, res) => {
    try {
      const { login, password } = req.body;

      // 1. Foydalanuvchini topish
      const user = await User.findOne({
        login: login.toLowerCase().trim()
      }).select('+password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Login yoki parol noto'g'ri"
        });
      }

      // ⚠️ 2. BLOKLANGAN USER TEKSHIRUVI - ENG MUHIM!
      if (user.blocked === true) {
        console.log(`🚫 [Login] Bloklangan user urinishi: ${login}`);
        return res.status(403).json({
          success: false,
          blocked: true,
          message: "Sizning hisobingiz bloklangan. Administrator bilan bog'laning.",
          contact: "Telegram: @ShoxPosPro_Support",
          reason: "Admin tomonidan bloklangan"
        });
      }

      // 3. authController.login'ni chaqirish (parol tekshiruvi va boshqalar)
      await authController.login(req, res);

    } catch (error) {
      console.error('❌ Login route error:', error);
      res.status(500).json({
        success: false,
        message: 'Server xatosi'
      });
    }
  });

/**
   * @route POST /api/register
   * @description Yangi foydalanuvchi ro'yxatdan o'tkazish (faqat admin)
   * @access Protected (admin only)
   */
  router.post('/register', 
    verifyToken, 
    authController.isAdmin, 
    csrfProtection, 
    registerValidation, 
    handleValidationErrors, 
    authController.register // <-- Bu controller endi shopName va kategoriyalarni saqlaydi
  );

  router.post(
  '/update-user-categories',
  verifyToken,
  authController.isAdmin,
  csrfProtection,
  async (req, res) => {
    try {
      await authController.updateUserCategories(req, res);
    } catch (error) {
      console.error('❌ Update user categories error:', error);
      res.status(500).json({ success: false, message: 'Kategoriyalarni yangilashda xato' });
    }
  }
);
 

  /**
   * @route GET /api/shop-types
   * @description Do'kon turlari va kategoriyalarini yuklash
   */
  router.get('/shop-types', verifyToken, authController.getShopTypes);

  router.post('/add-shop-category', verifyToken, authController.isAdmin, csrfProtection, authController.addShopCategory);


  /**
   * @route POST /api/change-password
   * @description Foydalanuvchi parolini o'zgartirish
   * @access Protected
   */
  router.post('/change-password', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.changePassword(req, res);
    } catch (error) {
      console.error('❌ Change password route error:', error);
      res.status(500).json({ success: false, message: 'Server xatosi' });
    }
  });

  /**
   * @route POST /api/refresh
   * @description JWT tokenni yangilash (refresh token orqali)
   * @access Public
   */
  router.post('/refresh', async (req, res) => {
    try {
      await authController.refresh(req, res);
    } catch (error) {
      console.error('❌ Refresh route error:', error);
      res.status(500).json({
        success: false,
        message: 'Token yangilash xatosi'
      });
    }
  });

  // ====================================
  // 🔒 PROTECTED ENDPOINTS (CSRF bilan)
  // ====================================

  /**
   * @route POST /api/logout
   * @description Foydalanuvchini tizimdan chiqarish
   * @access Protected
   */
  router.post('/logout', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.logout(req, res);
    } catch (error) {
      console.error('❌ Logout route error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout xatosi'
      });
    }
  });

  /**
   * @route POST /api/confirm-login
   * @description Yangi qurilmadan kirishni tasdiqlash
   * @access Protected
   */
  router.post('/confirm-login', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.confirmLogin(req, res);
    } catch (error) {
      console.error('❌ Confirm login route error:', error);
      res.status(500).json({
        success: false,
        message: 'Tasdiqlash xatosi'
      });
    }
  });

  /**
   * @route POST /api/change-password
   * @description Foydalanuvchi parolini o'zgartirish
   * @access Protected
   */
  router.post('/change-password', verifyToken, csrfProtection, authController.changePassword);
  
  // ─── Foydalanuvchi holati ──────────────────────────────────────────────────
  router.get('/user-status', verifyToken, authController.userStatus);

  // ─── Foydalanuvchini aktivlashtirish (faqat admin) ────────────────────────
  router.post('/activate-user', verifyToken, authController.isAdmin, csrfProtection, authController.activateUser);

  // ─── Foydalanuvchini bloklash (faqat admin) ───────────────────────────────
  router.post('/block-user', verifyToken, authController.isAdmin, csrfProtection, authController.blockUser);

  // ─── Faol foydalanuvchilar (faqat admin) ──────────────────────────────────
  router.get('/active-users', verifyToken, authController.isAdmin, authController.activeUsers);

  // ─── Sessiya holati tekshiruvi ─────────────────────────────────────────────
  router.post('/check-status', verifyToken, csrfProtection, authController.checkStatus);

  // ====================================
  // 💻 DEVICE MANAGEMENT
  // ====================================

  /**
   * @route GET /api/user-devices
   * @description Foydalanuvchining barcha qurilmalarini ko'rish
   * @access Protected
   */
  router.get('/user-devices', verifyToken, async (req, res) => {
    try {
      await authController.getUserDevices(req, res);
    } catch (error) {
      console.error('❌ Get user devices error:', error);
      res.status(500).json({
        success: false,
        message: 'Qurilmalarni yuklashda xato'
      });
    }
  });

  /**
   * @route POST /api/kick-device
   * @description Qurilmani tizimdan chiqarish
   * @access Protected
   */
  router.post('/kick-device', verifyToken, csrfProtection, async (req, res) => {
    try {
      await authController.kickDevice(req, res);
    } catch (error) {
      console.error('❌ Kick device error:', error);
      res.status(500).json({
        success: false,
        message: 'Qurilmani chiqarishda xato'
      });
    }
  });

  // ====================================
  // 👑 ADMIN RBAC ENDPOINTS
  // ====================================

  /**
   * @route POST /api/create-admin
   * @description Yangi admin yaratish (faqat super admin)
   * @access Admin only
   */
  router.post('/create-admin',
    verifyToken,
    authController.isAdmin,
    csrfProtection,
    async (req, res) => {
      try {
        await authController.createAdmin(req, res);
      } catch (error) {
        console.error('❌ Create admin error:', error);
        res.status(500).json({
          success: false,
          message: 'Admin yaratishda xato'
        });
      }
    }
  );

  /**
   * @route GET /api/verify-session
   * @description Joriy sessiyani tekshirish
   * @access Protected
   */
  router.get('/verify-session', verifyToken, (req, res) => {
    try {
      res.json({
        success: true,
        valid: true,
        user: {
          id: req.user.id,
          login: req.user.login,
          role: req.user.role
        }
      });
    } catch (error) {
      console.error('❌ Verify session error:', error);
      res.status(500).json({
        success: false,
        valid: false,
        message: 'Session tekshirish xatosi'
      });
    }
  });

  

  router.get('/me', verifyToken, authController.getMe);
  
  // ====================================
  // 👤 USER INFO ENDPOINTS
  // ====================================

  /**
   * @route GET /api/users
   * @description Barcha foydalanuvchilarni ko'rish (faqat admin)
   * @access Admin only
   */
  router.get('/users', verifyToken, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Ruxsat yo'q: faqat adminlar uchun"
        });
      }

      const users = await User.find({})
        .select('-password -twoFactorSecret')
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        count: users.length,
        users: users.map(user => ({
          login: user.login,
          role: user.role,
          name: user.name,
          email: user.email,
          active: user.active,
          blocked: user.blocked,
          twoFactorEnabled: user.twoFactorEnabled,
          devicesCount: user.devices?.length || 0,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        }))
      });

    } catch (err) {
      console.error('❌ Get users error:', err);
      res.status(500).json({
        success: false,
        message: 'Server xatosi'
      });
    }
  });

  /**
   * @route GET /api/users/:login
   * @description Foydalanuvchi ma'lumotlarini qaytaradi
   * @access Protected
   */
  router.get('/users/:login', verifyToken, async (req, res) => {
    try {
      const { login } = req.params;

      if (!login || typeof login !== 'string') {
        return res.status(400).json({
          success: false,
          message: "Login majburiy va string bo'lishi kerak"
        });
      }

      const normalizedLogin = login.trim().toLowerCase();

      if (!User) {
        console.error('❌ KRITIK XATO: User model yuklanmadi!');
        return res.status(500).json({
          success: false,
          message: 'Server konfiguratsiya xatosi'
        });
      }

      const user = await User.findOne({ login: normalizedLogin }).select('-password');

      if (!user) {
        console.warn(`❌ User topilmadi: "${normalizedLogin}"`);
        return res.status(404).json({
          success: false,
          message: 'Foydalanuvchi topilmadi',
          hint: "Loginni tekshiring yoki mavjud foydalanuvchilarni ko'ring"
        });
      }

      // Ruxsat tekshirish
      if (req.user.login !== normalizedLogin && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Ruxsat yo'q: faqat o'z ma'lumotingizni ko'rishingiz mumkin"
        });
      }

      // Biometrik holatini qurilma bo'yicha tekshirish
      const deviceId = req.query.deviceId || req.headers['x-device-id'];
      let biometricEnabled = false;
      let currentDevice = null;

      if (deviceId && user.devices && Array.isArray(user.devices)) {
        const device = user.devices.find(d => d.deviceId === deviceId);
        if (device) {
          biometricEnabled = device.biometric?.enabled || false;
          currentDevice = {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            deviceType: device.deviceType,
            lastActive: device.lastActive,
            biometricEnabled: device.biometric?.enabled || false
          };
        }
      }

      const response = {
        success: true,
        user: {
          login: user.login,
          role: user.role,
          name: user.name || null,
          email: user.email || null,
          phone: user.phone || null,
          twoFactorEnabled: user.twoFactorEnabled || false,
          biometricEnabled,
          currentDevice,
          blocked: user.blocked || false,
          active: user.active || false,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin || null,
          ...(req.user.role === 'admin' && {
            devices: user.devices?.map(d => ({
              deviceId: d.deviceId,
              deviceName: d.deviceName,
              deviceType: d.deviceType,
              lastActive: d.lastActive,
              biometricEnabled: d.biometric?.enabled || false
            })) || []
          })
        }
      };

      console.log(`✅ User ma'lumotlari yuklandi: ${normalizedLogin}`);
      res.json(response);

    } catch (err) {
      console.error('❌ Get user error:', err);
      res.status(500).json({
        success: false,
        message: 'Server xatosi',
        error: process.env.NODE_ENV === 'production' ? 'Ichki xato' : err.message,
        type: err.name
      });
    }
  });

  /**
   * @route PUT /api/users/:login
   * @description Foydalanuvchi ma'lumotlarini yangilash
   * @access Protected (o'z ma'lumotini yoki admin)
   */
  router.put('/users/:login', verifyToken, csrfProtection, async (req, res) => {
    try {
      const { login } = req.params;
      const normalizedLogin = login.trim().toLowerCase();

      if (req.user.login !== normalizedLogin && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Ruxsat yo'q"
        });
      }

      const user = await User.findOne({ login: normalizedLogin });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Foydalanuvchi topilmadi'
        });
      }

      const allowedFields = ['name', 'email', 'phone', 'firstName', 'lastName', 'phoneNumber', 'avatarUrl'];
      const updates = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      });

      if (req.user.role === 'admin' && req.body.role) {
        updates.role = req.body.role;
      }

      Object.assign(user, updates);
      await user.save();

      res.json({
        success: true,
        message: "Ma'lumotlar yangilandi",
        user: {
          login: user.login,
          name: user.name,
          firstName: user.firstName, 
          lastName: user.lastName,     
          phoneNumber: user.phoneNumber, 
          avatarUrl: user.avatarUrl,   
          email: user.email,
          phone: user.phone,
          role: user.role
        }
      });

    } catch (err) {
      console.error('❌ Update user error:', err);
      res.status(500).json({
        success: false,
        message: 'Server xatosi'
      });
    }
  });

  /**
   * @route DELETE /api/users/:login
   * @description Foydalanuvchini o'chirish (faqat admin)
   * @access Admin only
   */
  router.delete('/users/:login', verifyToken, csrfProtection, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Ruxsat yo'q: faqat adminlar uchun"
        });
      }

      const { login } = req.params;
      const normalizedLogin = login.trim().toLowerCase();

      if (req.user.login === normalizedLogin) {
        return res.status(400).json({
          success: false,
          message: "O'zingizni o'chira olmaysiz"
        });
      }

      const user = await User.findOneAndDelete({ login: normalizedLogin });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Foydalanuvchi topilmadi'
        });
      }

      console.log(`✅ Foydalanuvchi o'chirildi: ${normalizedLogin}`);
      res.json({
        success: true,
        message: "Foydalanuvchi o'chirildi"
      });

    } catch (err) {
      console.error('❌ Delete user error:', err);
      res.status(500).json({
        success: false,
        message: 'Server xatosi'
      });
    }
  });

  // ====================================
  // 🔍 HEALTH CHECK
  // ====================================

  /**
   * @route GET /api/health
   * @description Auth router health check
   * @access Public
   */
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'auth',
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  // ====================================
  // ❌ CSRF ERROR HANDLER
  // ====================================
  router.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
      console.error('❌ CSRF token xatosi:', req.method, req.path);
      return res.status(403).json({
        success: false,
        message: "CSRF token noto'g'ri yoki mavjud emas",
        hint: 'Avval /api/csrf-token dan token oling'
      });
    }
    next(err);
  });

  return router;
};