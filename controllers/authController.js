// controllers/authController.js

// 📦 Importlar
const User = require('../models/User');
const UserSession = require('../models/UserSession');
const AuditService = require('../services/auditService');
const UserSessionService = require('../services/userSessionService');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy'); // ← Google Authenticator uchun qo'shildi
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
// ====================================================================
// 🔑 TOKEN GENERATOR - BIOMETRIK UCHUN HAM ISHLAYDI
// ====================================================================

/**
 * Access va Refresh tokenlarni yaratadi
 * @param {Object} user - User model obyekti
 * @param {String} deviceId - Qurilma ID
 * @returns {Object} { accessToken, refreshToken, refreshTokenId }
 */
function createTokens(user, deviceId = null) {
  const payload = {
    id: user._id.toString(),
    login: user.login,
    role: user.role,
    deviceId
  };

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshTokenId = uuidv4();
  const refreshToken = jwt.sign(
    { 
      id: user._id.toString(),
      login: user.login, 
      tokenId: refreshTokenId, 
      deviceId 
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken, refreshTokenId };
}

exports.generateTokens = async (user, deviceId = null) => {
  return createTokens(user, deviceId);
};

// ====================================================================
// 🔐 ODDIY KIRISH - LOGIN VA PAROL BILAN
// ====================================================================

/**
 * Oddiy kirishni davom ettirish - tokenlar yaratish va sessiya ochish
 */
async function proceedWithLogin(user, deviceId, deviceType, deviceOS, req, res) {
  // Faol qurilmani yangilash
  user.activeDevice = {
    deviceId,
    deviceType: deviceType || 'unknown',
    deviceOS: deviceOS || 'unknown',
    lastLogin: new Date()
  };
  await user.save();

  // Tokenlar yaratish
  const { accessToken, refreshToken, refreshTokenId } = createTokens(user, deviceId);

  // Cookie sozlamalari
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

  // Sessiya yaratish
  await UserSessionService.createSession({
    userId: user._id,
    deviceId,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    refreshTokens: [{
      tokenId: refreshTokenId,
      token: refreshToken,
      deviceId,
      createdAt: new Date()
    }]
  });

  // Audit log
  await AuditService.logUserAction({ 
    login: user.login, 
    action: 'LOGIN', 
    status: 'SUCCESS' 
  });

  res.json({
    success: true,
    message: 'Kirish muvaffaqiyatli',
    user: { 
      login: user.login, 
      role: user.role,
      name: user.name || null
    }
  });
}

/**
 * LOGIN - Oddiy kirish (login + parol)
 */
exports.login = async (req, res) => {
  const { 
    login, 
    password, 
    googleAuthCode, 
    deviceId, 
    deviceType, 
    deviceOS 
  } = req.body;

  if (!deviceId || !deviceType || !deviceOS) {
    return res.status(400).json({ message: "Device ma'lumotlari majburiy" });
  }

  try {
    const normalizedLogin = (login || "").trim().toLowerCase();

   

    // MUHIM: password ni majburan olish uchun +password qo'shamiz
    const user = await User.findOne({ login: normalizedLogin })
      .select('+password');  // ← BU QATOR MUHIM – XATONI HAL QILADI

    if (!user) {
      console.warn(`❌ User topilmadi: ${normalizedLogin}`);
      return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    }

    if (user.isDeleted) {
      console.warn(`❌ User o'chirilgan: ${normalizedLogin}`);
      return res.status(403).json({ message: "Hisob o'chirilgan" });
    }

    // Bloklangan qurilma tekshiruvi
    const blockedDevice = user.blockedDevices?.find(d => d.deviceId === deviceId);
    if (blockedDevice && new Date() < new Date(blockedDevice.lockUntil)) {
      console.warn(`❌ Qurilma bloklangan: ${deviceId}`);
      return res.status(403).json({
        message: "Qurilma bloklangan. 30 minutdan keyin urinib ko'ring."
      });
    }

  
   
    // Agar password fieldi hali ham undefined bo'lsa – xavfsizlik uchun tekshirish
    if (!user.password) {
      console.error(`❌ Password fieldi mavjud emas: ${normalizedLogin}`);
      return res.status(500).json({ message: "Server xatosi: foydalanuvchi ma'lumotlari buzilgan" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

   

    if (!isMatch) {
      console.warn(`❌ Parol noto'g'ri: ${normalizedLogin}`);

      user.loginAttempts = (user.loginAttempts || 0) + 1;

      if (user.loginAttempts >= 5) {
        user.blockedDevices = user.blockedDevices || [];
        user.blockedDevices.push({
          deviceId,
          lockUntil: new Date(Date.now() + 30 * 60 * 1000) // 30 daqiqa
        });
        user.loginAttempts = 0;
        await user.save();

        return res.status(403).json({
          message: "5 ta noto'g'ri urinish. Qurilma 30 minut bloklandi."
        });
      }

      await user.save();
      return res.status(401).json({ message: "Parol noto'g'ri" });
    }


    // ========================================
    // GOOGLE AUTHENTICATOR TEKSHIRUVI
    // ========================================
    if (user.googleAuthEnabled) {
      if (!googleAuthCode) {
        return res.status(200).json({
          requiresGoogleAuth: true,
          message: "Google Authenticator kodi talab qilinadi"
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.googleAuthSecret,
        encoding: 'base32',
        token: googleAuthCode,
        window: 2
      });

      if (!verified) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;

        if (user.loginAttempts >= 5) {
          user.blockedDevices = user.blockedDevices || [];
          user.blockedDevices.push({
            deviceId,
            lockUntil: new Date(Date.now() + 30 * 60 * 1000)
          });
          user.loginAttempts = 0;
          await user.save();

          return res.status(403).json({
            message: "5 ta noto'g'ri Google Auth urinish. Qurilma 30 minut bloklandi."
          });
        }

        await user.save();
        return res.status(400).json({ 
          message: "Google Authenticator kodi noto'g'ri" 
        });
      }
    }

    // Muvaffaqiyatli login → attempts ni reset qilish
    user.loginAttempts = 0;

    // Qurilma ma'lumotlarini yangilash
    const deviceInfo = {
      deviceId,
      deviceType: deviceType || "unknown",
      deviceOS: deviceOS || "unknown",
      lastLogin: new Date(),
      isActive: true,
      isSuspicious: false,
      isTrusted: false
    };

    if (!user.devices?.some(d => d.deviceId === deviceId)) {
      user.devices = user.devices || [];
      user.devices.push(deviceInfo);
    } else {
      user.devices = user.devices.map(d =>
        d.deviceId === deviceId
          ? { ...d, lastLogin: new Date(), isActive: true }
          : { ...d, isActive: false }
      );
    }

    user.activeDevice = {
      deviceId,
      deviceType: deviceType || "unknown",
      deviceOS: deviceOS || "unknown",
      lastLogin: new Date()
    };

    await user.save();


    // Token yaratish va cookie'larga yozish
    const { accessToken, refreshToken, refreshTokenId } = createTokens(user, deviceId);

    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000  // 15 daqiqa
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000  // 7 kun
    });

    // Sessiya yaratish
    await UserSessionService.createSession({
      userId: user._id,
      deviceId,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      refreshTokens: [{
        tokenId: refreshTokenId,
        token: refreshToken,
        deviceId,
        createdAt: new Date()
      }]
    });

    // Audit log
    await AuditService.logUserAction({ 
      login: user.login, 
      action: 'LOGIN', 
      status: 'SUCCESS' 
    });

    return res.json({
      success: true,
      message: 'Kirish muvaffaqiyatli',
      user: { 
        login: user.login, 
        role: user.role,
        name: user.name || null
      }
    });

  } catch (err) {
    console.error("❌ Login xatosi:", err.stack || err);
    return res.status(500).json({ 
      success: false,
      message: "Server xatosi yuz berdi" 
    });
  }
};

// ====================================================================
// 🔁 TOKEN REFRESH
// ====================================================================

exports.refresh = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh token yo\'q' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findOne({ login: decoded.login });
    
    if (!user || user.blocked) {
      return res.status(403).json({ message: 'Foydalanuvchi bloklangan' });
    }

    const session = await UserSessionService.getSession(user._id, decoded.deviceId);
    const validToken = session?.refreshTokens?.find(
      rt => rt.tokenId === decoded.tokenId && rt.token === refreshToken
    );
    
    if (!validToken) {
      return res.status(403).json({ message: 'Token noto\'g\'ri' });
    }

    // ✅ AVVAL yangi tokenlarni yaratamiz
    const { accessToken, refreshToken: newRefreshToken, refreshTokenId } = createTokens(user, decoded.deviceId);

    // ✅ KEYIN eski sessiyani o'chiramiz (atomik operatsiya)
    await UserSessionService.rotateRefreshToken({
      userId: user._id,
      deviceId: decoded.deviceId,
      oldTokenId: decoded.tokenId,
      newToken: {
        tokenId: refreshTokenId,
        token: newRefreshToken,
        deviceId: decoded.deviceId,
        createdAt: new Date()
      }
    });

    // Cookie'larga yozish
    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000
    });

    res.cookie('refreshToken', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Refresh xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// ====================================================================
// 👤 FOYDALANUVCHI BOSHQARUVI
// ====================================================================

/**
 * Parolni o'zgartirish
 */
/**
 * Parolni o'zgartirish - FIXED VERSION
 */
exports.changePassword = async (req, res) => {
  const { login, currentPassword, newPassword } = req.body;

  try {
    const normalizedLogin = (login || '').trim().toLowerCase();

    // MUHIM QATOR: password ni majburan olish
    const user = await User.findOne({ login: normalizedLogin })
      .select('+password');   // ← BU QATOR XATONI HAL QILADI

    if (!user) {
      return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    }

    // Endi user.password mavjud bo'ladi
    if (!user.password) {
      console.error(`❌ Password fieldi mavjud emas: ${normalizedLogin}`);
      return res.status(500).json({ message: 'Server xatosi: parol maʼlumotlari topilmadi' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Joriy parol noto'g'ri" });
    }

    // Yangi parolni oddiy matn sifatida o'rnatamiz (hook o'zi hash qiladi)
    user.password = newPassword;

    await user.save();

    // Test uchun saqlangan hashni ko'rish
    const fresh = await User.findById(user._id).select('+password');

    return res.json({
      success: true,
      message: "Parol muvaffaqiyatli o'zgartirildi"
    });

  } catch (err) {
    console.error('changePassword xatosi:', err.stack || err);
    return res.status(500).json({ message: 'Server xatosi yuz berdi' });
  }
};


/**
 * Ro'yxatdan o'tish
 */
exports.register = async (req, res) => {
  const { login, password, role = 'seller' } = req.body;

  if (!login || !password) {
    return res.status(400).json({ message: 'Login va parol majburiy' });
  }

  if (!['seller', 'admin', 'cashier'].includes(role)) {
    return res.status(400).json({ message: 'Noto\'g\'ri role: faqat seller, cashier yoki admin' });
  }

  try {
    const normalizedLogin = login.trim().toLowerCase();

    const existingUser = await User.findOne({ login: normalizedLogin });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu login allaqachon mavjud' });
    }

    const newUser = new User({ login: normalizedLogin, password, role });
    await newUser.save();

    await AuditService.logUserAction({ 
      login: normalizedLogin, 
      action: 'REGISTER', 
      status: 'SUCCESS' 
    });

    res.status(201).json({
      message: '✅ Foydalanuvchi yaratildi',
      user: { login: normalizedLogin, role: newUser.role }
    });
  } catch (err) {
    console.error('❌ Register xatosi:', err);
    res.status(500).json({ message: 'Server xatosi', error: err.message });
  }
};


/**
 * Qurilmani tasdiqlash
 */
exports.confirmLogin = async (req, res) => {
  const { login, deviceId, deviceType = 'unknown', deviceOS = 'unknown', confirm } = req.body;

  try {
    const normalizedLogin = (login || '').trim().toLowerCase();
    const user = await User.findOne({ login: normalizedLogin });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });

    if (confirm) {
      // Eski sessiyani deactivate qilish
      if (user.activeDevice && user.activeDevice.deviceId) {
        await UserSession.updateOne(
          { userId: user._id, deviceId: user.activeDevice.deviceId, isActive: true },
          { isActive: false, lastLogout: new Date() }
        );
      }

      // Yangi qurilma ma'lumotlarini saqlash
      user.activeDevice = {
        deviceId,
        deviceType,
        deviceOS,
        lastLogin: new Date()
      };
      await user.save();

      await AuditService.logUserAction({ 
        login: normalizedLogin, 
        action: 'CONFIRM_DEVICE', 
        status: 'SUCCESS' 
      });

     

      return res.json({ 
        message: 'Yangi qurilmaga o\'tkazildi, eski qurilmadan chiqildi' 
      });
    }

    await AuditService.logUserAction({ 
      login: normalizedLogin, 
      action: 'CONFIRM_DEVICE', 
      status: 'DECLINED' 
    });
    return res.json({ message: 'Kirish rad etildi' });
  } catch (err) {
    console.error('❌ Confirm xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

/**
 * Foydalanuvchi qurilmalarini olish
 */
exports.getUserDevices = async (req, res) => {
  try {
    const user = await User.findOne({ login: req.user.login });
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    const activeDevices = user.devices?.filter(d => d.isActive) || [];

    res.json({ devices: activeDevices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
};

/**
 * Qurilmani chiqarib yuborish
 */
exports.kickDevice = async (req, res) => {
  const { deviceId } = req.body;
  const login = req.user.login;

  try {
    const user = await User.findOne({ login });
    if (!user) {
      return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    }

    const initialLength = user.devices.length;
    user.devices = user.devices.filter(d => d.deviceId !== deviceId);

    if (user.devices.length === 0) {
      user.devices = [];
    }

    if (user.activeDevice?.deviceId === deviceId) {
      user.activeDevice = null;
    }

    await user.save();

    if (user.devices.length === initialLength - 1 || initialLength === 0) {
      const { io } = require('../server');
      io.to(deviceId).emit('force-logout');
      console.log(`✅ Qurilma o'chirildi: ${deviceId}`);

      return res.json({ message: "Qurilma muvaffaqiyatli o'chirildi" });
    } else {
      return res.status(404).json({ message: "Qurilma topilmadi" });
    }
  } catch (err) {
    console.error("❌ Kick device xatosi:", err);
    return res.status(500).json({ message: "Server xatosi" });
  }
};

/**
 * Logout
 */
exports.logout = async (req, res) => {
  // Body’dan emas, cookie va req.user’dan olish mumkin, lekin hozirgi logika saqlaymiz
  const { userId, deviceId } = req.body;

  try {
    const session = await UserSession.findOne({ userId, deviceId, isActive: true });
    if (session) {
      session.isActive = false;
      session.lastLogout = new Date();
      await session.save();
    }

    const user = await User.findById(userId);
    if (user && user.activeDevice?.deviceId === deviceId) {
      user.activeDevice = null;
      await user.save();
    }

    await AuditService.logUserAction({ 
      login: user?.login, 
      action: 'LOGOUT', 
      status: 'SUCCESS' 
    });

    // 🍪 Cookie’larni tozalash
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.json({ success: true, message: '✅ Logout muvaffaqiyatli' });
  } catch (err) {
    console.error('❌ Logout xatosi:', err);
    res.status(500).json({ message: 'Server xatosi', error: err.message });
  }
};

// ====================================================================
// 🛡️ RBAC & ADMIN
// ====================================================================

/**
 * Admin huquqini tekshirish (middleware)
 */
exports.isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin huquqi talab qilinadi' });
  }
  next();
};

/**
 * Admin yaratish
 */
exports.createAdmin = async (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ message: 'Login va parol majburiy' });
  }

  try {
    const normalizedLogin = login.trim().toLowerCase();

    const existingUser = await User.findOne({ login: normalizedLogin });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu login allaqachon mavjud' });
    }

    const newUser = new User({ login: normalizedLogin, password, role: 'admin' });
    await newUser.save();

    await AuditService.logUserAction({ 
      login: normalizedLogin, 
      action: 'CREATE_ADMIN', 
      status: 'SUCCESS' 
    });

    res.status(201).json({
      message: '✅ Admin foydalanuvchi yaratildi',
      user: { login: normalizedLogin, role: newUser.role }
    });
  } catch (err) {
    console.error('❌ CreateAdmin xatosi:', err);
    res.status(500).json({ message: 'Server xatosi', error: err.message });
  }
};


module.exports = {
  login: exports.login,
  refresh: exports.refresh,
  changePassword: exports.changePassword,
  register: exports.register,
  confirmLogin: exports.confirmLogin,
  getUserDevices: exports.getUserDevices,
  kickDevice: exports.kickDevice,
  logout: exports.logout,
  isAdmin: exports.isAdmin,
  createAdmin: exports.createAdmin,
  generateTokens: exports.generateTokens
};