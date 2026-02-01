// routes/biometricRoutes.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authController = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');
const { body, validationResult } = require('express-validator');
const config = require('../config');

/**
 * RP ID ni aniqlash (WebAuthn uchun)
 */
function getRpId(req) {
  const hostname = req.hostname || req.get('host')?.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return hostname;
}

/**
 * Base64 string'ni Buffer'ga o'girish
 */
function base64ToBuffer(base64) {
  // URL-safe base64 ni oddiy base64 ga o'girish
  const base64url = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64Padded = base64url + padding;
  return Buffer.from(base64Padded, 'base64');
}

/**
 * Buffer'ni Base64 string'ga o'girish
 */
function bufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * @route   POST /api/enable-biometric
 * @desc    Biometrik autentifikatsiyani yoqish
 * @access  Private (Token kerak)
 */
router.post('/enable-biometric',
  verifyToken,
  [
    body('deviceId').trim().notEmpty().withMessage('DeviceId majburiy'),
    body('credentialId').trim().notEmpty().withMessage('CredentialId majburiy'),
    body('publicKey').optional().trim(),
    body('deviceType').optional().trim(),
    body('deviceOS').optional().trim(),
   
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri ma\'lumotlar',
        errors: errors.array(),
      });
    }

    try {
      const { deviceId, credentialId, publicKey, deviceType, deviceOS } = req.body;
      const userId = req.user.id;

      console.log(`🔐 Enable biometric: userId=${userId}, deviceId=${deviceId}`);

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'Foydalanuvchi topilmadi' 
        });
      }

      if (user.blocked) {
        return res.status(403).json({ 
          success: false, 
          message: 'Hisob bloklangan. Biometrik yoqib bo\'lmaydi' 
        });
      }

      let device = user.devices.find((d) => d.deviceId === deviceId);

      if (!device) {
        console.log(`📱 Yangi qurilma qo'shilmoqda: ${deviceId}`);
        device = {
          deviceId,
          deviceType: deviceType || 'unknown',
          deviceOS: deviceOS || 'unknown',
          lastLogin: new Date(),
          isActive: true,
          isTrusted: true,
          isSuspicious: false,
          biometric: {
            enabled: true,
            credentialId,
            publicKey: publicKey || '',
            counter: 0,
            enabledAt: new Date(),
          }
        };
        user.devices.push(device);
      } else {
        console.log(`♻️ Mavjud qurilmaga biometrik qo'shilmoqda: ${deviceId}`);
        
        if (device.biometric && device.biometric.enabled) {
          console.log(`⚠️ Bu qurilmada biometrik allaqachon faol. Yangilanmoqda...`);
        }

        device.biometric = {
          enabled: true,
          credentialId,
          publicKey: publicKey || '',
          counter: device.biometric?.counter || 0,
          enabledAt: new Date(),
        };

        if (deviceType) device.deviceType = deviceType;
        if (deviceOS) device.deviceOS = deviceOS;
        device.lastLogin = new Date();
        device.isActive = true;
      }

      await user.save();

      console.log(`✅ Biometrik faollashtirildi: ${user.login} (${deviceId})`);

      return res.json({
        success: true,
        message: 'Biometrik autentifikatsiya muvaffaqiyatli faollashtirildi',
        data: {
          deviceId,
          enabledAt: device.biometric.enabledAt,
        }
      });
    } catch (err) {
      console.error('❌ [enable-biometric] xato:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Server xatosi',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * @route   POST /api/biometric-login
 * @desc    Biometrik orqali tizimga kirish (COOKIE ASOSIDA)
 * @access  Public
 */
router.post('/biometric-login',
  [
    body('login').trim().notEmpty().withMessage('Login majburiy'),
    body('deviceId').trim().notEmpty().withMessage('DeviceId majburiy'),
    body('credentialId').trim().notEmpty().withMessage('CredentialId majburiy'),
    body('deviceType').optional().trim(),
    body('deviceOS').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri so\'rov',
        errors: errors.array(),
      });
    }

    const { login, deviceId, credentialId, deviceType, deviceOS } = req.body;

    try {
      console.log(`🔐 Biometric login attempt: ${login}, device: ${deviceId}`);

      const user = await User.findOne({ 
        login: login.toLowerCase().trim() 
      });

      if (!user) {
        console.log(`❌ Foydalanuvchi topilmadi: ${login}`);
        return res.status(401).json({ 
          success: false, 
          message: 'Login yoki biometrik ma\'lumot noto\'g\'ri' 
        });
      }

      if (user.blocked) {
        console.log(`🚫 Bloklangan foydalanuvchi: ${login}`);
        return res.status(403).json({ 
          success: false, 
          message: 'Hisob bloklangan. Admin bilan bog\'laning' 
        });
      }

      if (user.isDeleted) {
        return res.status(403).json({ 
          success: false, 
          message: 'Hisob o\'chirilgan' 
        });
      }

      const device = user.devices.find(
        (d) => d.deviceId === deviceId && 
               d.biometric?.credentialId === credentialId &&
               d.biometric?.enabled === true
      );

      if (!device) {
        console.log(`❌ Biometrik mos kelmadi: ${login}, device: ${deviceId}`);
        
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        
        if (user.loginAttempts >= 5) {
          user.blocked = true;
          await user.save();
          console.log(`🔒 Foydalanuvchi bloklandi (ko'p noto'g'ri urinish): ${login}`);
          return res.status(403).json({
            success: false,
            message: 'Ko\'p noto\'g\'ri urinish. Hisob bloklandi',
          });
        }

        await user.save();

        return res.status(401).json({
          success: false,
          message: 'Biometrik ma\'lumot noto\'g\'ri yoki qurilma ro\'yxatdan o\'tmagan',
          attemptsLeft: 5 - user.loginAttempts
        });
      }

      console.log(`✅ Biometrik tasdiqlandi: ${login}`);

      // 🔐 Tokenlar yaratish
      const { accessToken, refreshToken, refreshTokenId } = await authController.generateTokens(user, deviceId);

      // 🍪 HTTPOnly cookie'larga yozish
      const cookieOptions = {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
      };

      res.cookie('accessToken', accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000 // 15 daqiqa
      });

      res.cookie('refreshToken', refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 kun
      });

      // 📝 Sessiya yaratish
      const UserSessionService = require('../services/userSessionService');
      await UserSessionService.createSession({
        userId: user._id,
        deviceId,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        refreshTokens: [
          {
            tokenId: refreshTokenId,
            token: refreshToken,
            deviceId,
            createdAt: new Date()
          }
        ]
      });

      // 🔄 Qurilma va user ma'lumotlarini yangilash
      device.lastLogin = new Date();
      device.isActive = true;
      if (deviceType) device.deviceType = deviceType;
      if (deviceOS) device.deviceOS = deviceOS;

      if (device.biometric.counter !== undefined) {
        device.biometric.counter += 1;
      }

      user.activeDevice = {
        deviceId,
        deviceType: device.deviceType,
        deviceOS: device.deviceOS,
        lastLogin: new Date(),
      };

      user.loginAttempts = 0;
      await user.save();

      // 📊 Audit log
      const AuditService = require('../services/auditService');
      await AuditService.logUserAction({ 
        login: user.login, 
        action: 'BIOMETRIC_LOGIN', 
        status: 'SUCCESS' 
      });

      console.log(`🎉 Biometric login muvaffaqiyatli: ${login}`);

      // ✅ Frontendga faqat muvaffaqiyat va user ma'lumotlari (tokenlarsiz!)
      return res.json({
        success: true,
        message: 'Tizimga muvaffaqiyatli kirdingiz',
        user: {
          login: user.login,
          role: user.role,
          name: user.name || null,
          email: user.email || null,
        }
      });
    } catch (err) {
      console.error('❌ [biometric-login] xato:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Server xatosi',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * @route   POST /api/disable-biometric
 * @desc    Biometrikni o'chirish
 * @access  Private (Token kerak)
 */
router.post('/disable-biometric',
  verifyToken,
  [
    body('deviceId').trim().notEmpty().withMessage('DeviceId majburiy'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Noto\'g\'ri ma\'lumotlar',
        errors: errors.array(),
      });
    }

    try {
      const { deviceId } = req.body;
      const userId = req.user.id;

      console.log(`🔓 Disable biometric: userId=${userId}, deviceId=${deviceId}`);

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'Foydalanuvchi topilmadi' 
        });
      }

      const device = user.devices.find(d => d.deviceId === deviceId);
      
      if (!device) {
        return res.status(404).json({
          success: false,
          message: 'Qurilma topilmadi'
        });
      }

      if (!device.biometric || !device.biometric.enabled) {
        return res.status(400).json({
          success: false,
          message: 'Bu qurilmada biometrik faol emas'
        });
      }

      device.biometric.enabled = false;
      device.biometric.credentialId = null;
      device.biometric.publicKey = null;

      await user.save();

      console.log(`✅ Biometrik o'chirildi: ${user.login} (${deviceId})`);

      return res.json({
        success: true,
        message: 'Biometrik autentifikatsiya o\'chirildi',
      });
    } catch (err) {
      console.error('❌ [disable-biometric]:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Server xatosi',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * @route   GET /api/biometric-status
 * @desc    Biometrik holatini tekshirish
 * @access  Private (Token kerak)
 */
router.get('/biometric-status',
  verifyToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const deviceId = req.query.deviceId;

      if (!deviceId) {
        return res.status(400).json({
          success: false,
          message: 'DeviceId parametri kerak'
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'Foydalanuvchi topilmadi' 
        });
      }

      const device = user.devices.find(d => d.deviceId === deviceId);

      if (!device) {
        return res.json({
          success: true,
          enabled: false,
          message: 'Qurilma ro\'yxatdan o\'tmagan'
        });
      }

      return res.json({
        success: true,
        enabled: device.biometric?.enabled || false,
        enabledAt: device.biometric?.enabledAt || null,
        deviceInfo: {
          deviceType: device.deviceType,
          deviceOS: device.deviceOS,
          lastLogin: device.lastLogin
        }
      });
    } catch (err) {
      console.error('❌ [biometric-status]:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Server xatosi' 
      });
    }
  }
);

module.exports = router;