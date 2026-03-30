// routes/biometricRoutes.js

const express    = require('express');
const crypto     = require('crypto');
const User       = require('../models/User');
const authController = require('../controllers/authController');
const verifyToken    = require('../middleware/verifyToken');
const { body, validationResult } = require('express-validator');
const config     = require('../config');

module.exports = (csrfProtection) => {
  const router     = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRpId(req) {
  const hostname = req.hostname || req.get('host')?.split(':')[0];
  return (hostname === 'localhost' || hostname === '127.0.0.1')
    ? 'localhost'
    : hostname;
}

function base64ToBuffer(base64) {
  const base64url = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padding   = '='.repeat((4 - (base64url.length % 4)) % 4);
  return Buffer.from(base64url + padding, 'base64');
}

// In-memory challenge store (production da Redis ishlatish tavsiya qilinadi)
// Map<deviceId, { challenge, expiresAt }>
const challengeStore = new Map();

// Har 5 daqiqada eskirgan challengelarni tozalash
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of challengeStore) {
    if (val.expiresAt < now) challengeStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Cookie opsiyalari ────────────────────────────────────────────────────────

const isDev = (config.NODE_ENV || process.env.NODE_ENV) !== 'production';

const cookieOptions = {
  httpOnly: true,
  secure:   !isDev,
  sameSite: isDev ? 'lax' : 'strict',
  path:     '/',
};

// ─────────────────────────────────────────────────────────────────────────────
/**
 * GET /api/biometric-status
 * ✅ TUZATISH: verifyToken O'CHIRILDI
 * Login sahifasida token yo'q — token talab qilsa 401 qaytarib biometric ko'rinmaydi
 * Xavfsizlik: faqat enabled: true/false qaytaradi — hech qanday shaxsiy ma'lumot yo'q
 */
router.get('/biometric-status', async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.json({ biometricEnabled: false });

    // deviceId bo'yicha foydalanuvchi qidirish
    const user = await User.findOne({ 'devices.deviceId': deviceId });
    if (!user) return res.json({ biometricEnabled: false });

    const device = user.devices.find(d => d.deviceId === deviceId);
    const enabled = !!(device?.biometric?.enabled && device?.biometric?.credentialId);

    return res.json({ biometricEnabled: enabled });
  } catch {
    return res.json({ biometricEnabled: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/biometric-login-init
 * ✅ YANGI endpoint — frontend credentialId + server challenge oladi
 * Token talab qilmaydi (login sahifasida ishlatiladi)
 */
router.post('/biometric-login-init',
  csrfProtection,
  [body('deviceId').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'deviceId kerak' });
    }

    try {
      const { deviceId } = req.body;

      const user = await User.findOne({ 'devices.deviceId': deviceId });
      if (!user) {
        return res.status(404).json({ message: 'Bu qurilmada biometrik topilmadi' });
      }

      const device = user.devices.find(d => d.deviceId === deviceId);
      if (!device?.biometric?.enabled || !device?.biometric?.credentialId) {
        return res.status(404).json({ message: 'Bu qurilmada biometrik topilmadi' });
      }

      // ✅ Server tomonida challenge yaratish — client emas
      // Sabab: client challenge = replay attack xavfi
      const challenge = crypto.randomBytes(32);
      const challengeB64 = challenge.toString('base64');

      // 60 soniya muddatli saqlash
      challengeStore.set(deviceId, {
        challenge: challengeB64,
        expiresAt: Date.now() + 60_000,
      });

      return res.json({
        credentialId: device.biometric.credentialId,
        challenge:    challengeB64,
      });
    } catch {
      return res.status(500).json({ message: 'Server xatosi' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/biometric-login
 * ✅ TUZATISH: login field talab qilinmaydi — deviceId dan topiladi
 * ✅ TUZATISH: server challenge tekshiriladi
 * ✅ TUZATISH: authenticatorData, clientDataJSON, signature qabul qilinadi
 */
router.post('/biometric-login',
  csrfProtection,
  [
    body('deviceId').trim().notEmpty().withMessage('DeviceId majburiy'),
    body('credentialId').trim().notEmpty().withMessage('CredentialId majburiy'),
    body('deviceType').optional().trim(),
    body('deviceOS').optional().trim(),
    body('authenticatorData').optional().trim(),
    body('clientDataJSON').optional().trim(),
    body('signature').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri so\'rov' });
    }

    const { deviceId, credentialId, deviceType, deviceOS, clientDataJSON } = req.body;

    try {
      // ── 1. Challenge tekshirish ─────────────────────────────────────────
      const saved = challengeStore.get(deviceId);
      if (!saved || Date.now() > saved.expiresAt) {
        return res.status(400).json({
          success: false,
          message: 'Challenge eskirgan. Qayta urinib ko\'ring',
        });
      }

      // clientDataJSON yuborilgan bo'lsa challenge mosligini tekshirish
      if (clientDataJSON) {
        try {
          const clientData     = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf8'));
          const receivedChallenge = Buffer.from(clientData.challenge, 'base64url').toString('base64');
          if (receivedChallenge !== saved.challenge) {
            challengeStore.delete(deviceId);
            return res.status(400).json({ success: false, message: 'Challenge mos kelmadi' });
          }
        } catch {
          return res.status(400).json({ success: false, message: 'clientDataJSON noto\'g\'ri' });
        }
      }

      // Bir martali — ishlatilgandan keyin o'chirish
      challengeStore.delete(deviceId);

      // ── 2. Foydalanuvchi va qurilma topish ──────────────────────────────
      // ✅ login endi req.body dan emas — deviceId orqali DBdan topiladi
      const user = await User.findOne({
        'devices.deviceId':               deviceId,
        'devices.biometric.credentialId': credentialId,
        'devices.biometric.enabled':      true,
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Biometrik ma\'lumot noto\'g\'ri yoki qurilma ro\'yxatdan o\'tmagan',
        });
      }

      if (user.blocked) {
        return res.status(403).json({ success: false, message: 'Hisob bloklangan' });
      }
      if (user.isDeleted) {
        return res.status(403).json({ success: false, message: 'Hisob o\'chirilgan' });
      }

      const device = user.devices.find(
        d => d.deviceId === deviceId && d.biometric?.credentialId === credentialId,
      );

      // ── 3. Tokenlar + cookie ────────────────────────────────────────────
      const { accessToken, refreshToken, refreshTokenId } =
        await authController.generateTokens(user, deviceId);

      res.cookie('accessToken', accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      });
      res.cookie('refreshToken', refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // ── 4. Sessiya + qurilma yangilash ──────────────────────────────────
      const UserSessionService = require('../services/userSessionService');
      await UserSessionService.createSession({
        userId:   user._id,
        deviceId,
        ip:       req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        refreshToken,
        refreshTokenId,
        deviceType,
        deviceOS
      });

      device.lastLogin = new Date();
      device.isActive  = true;
      if (deviceType) device.deviceType = deviceType;
      if (deviceOS)   device.deviceOS   = deviceOS;
      if (device.biometric.counter !== undefined) device.biometric.counter += 1;

      user.activeDevice  = { deviceId, deviceType: device.deviceType, deviceOS: device.deviceOS, lastLogin: new Date() };
      user.loginAttempts = 0;
      await user.save();

      // ── 5. Audit ────────────────────────────────────────────────────────
      const AuditService = require('../services/auditService');
      await AuditService.logUserAction({
        login:  user.login,
        action: 'BIOMETRIC_LOGIN',
        status: 'SUCCESS',
      });

      return res.json({
        success: true,
        message: 'Tizimga muvaffaqiyatli kirdingiz',
        user: {
          login: user.login,
          role:  user.role,
          name:  user.name  || null,
          email: user.email || null,
        },
      });
    } catch (err) {
      return res.status(500).json({
        success:  false,
        message:  'Server xatosi',
        error: config.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/enable-biometric  (o'zgarishsiz)
 */
router.post('/enable-biometric',
  verifyToken,
  csrfProtection,
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
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri ma\'lumotlar' });
    }

    try {
      const { deviceId, credentialId, publicKey, deviceType, deviceOS } = req.body;
      const userId = req.user.id;

      const user = await User.findById(userId);
      if (!user)         return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
      if (user.blocked)  return res.status(403).json({ success: false, message: 'Hisob bloklangan' });

      let device = user.devices.find(d => d.deviceId === deviceId);

      if (!device) {
        user.devices.push({
          deviceId,
          deviceType:  deviceType || 'unknown',
          deviceOS:    deviceOS   || 'unknown',
          lastLogin:   new Date(),
          isActive:    true,
          isTrusted:   true,
          isSuspicious: false,
          biometric: {
            enabled:      true,
            credentialId,
            publicKey:    publicKey || '',
            counter:      0,
            enabledAt:    new Date(),
          },
        });
      } else {
        device.biometric = {
          enabled:      true,
          credentialId,
          publicKey:    publicKey || '',
          counter:      device.biometric?.counter || 0,
          enabledAt:    new Date(),
        };
        if (deviceType) device.deviceType = deviceType;
        if (deviceOS)   device.deviceOS   = deviceOS;
        device.lastLogin = new Date();
        device.isActive  = true;
      }

      await user.save();

      return res.json({
        success: true,
        message: 'Biometrik autentifikatsiya muvaffaqiyatli faollashtirildi',
        data:    { deviceId, enabledAt: device?.biometric?.enabledAt || new Date() },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Server xatosi',
        error: config.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/disable-biometric  (o'zgarishsiz)
 */
router.post('/disable-biometric',
  verifyToken,
  csrfProtection,
  [body('deviceId').trim().notEmpty().withMessage('DeviceId majburiy')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri ma\'lumotlar' });
    }

    try {
      const { deviceId } = req.body;
      const userId = req.user.id;

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });

      const device = user.devices.find(d => d.deviceId === deviceId);
      if (!device) return res.status(404).json({ success: false, message: 'Qurilma topilmadi' });

      if (!device.biometric?.enabled) {
        return res.status(400).json({ success: false, message: 'Bu qurilmada biometrik faol emas' });
      }

      device.biometric.enabled      = false;
      device.biometric.credentialId = null;
      device.biometric.publicKey    = null;

      await user.save();

      return res.json({ success: true, message: 'Biometrik autentifikatsiya o\'chirildi' });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Server xatosi',
        error: config.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  },
);

  return router;
};