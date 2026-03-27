// controllers/authController.js

const User = require('../models/User');
const UserSession = require('../models/UserSession');
const AuditService = require('../services/auditService');
const UserSessionService = require('../services/userSessionService');
const TokenBlacklistService = require('../services/tokenBlacklistService');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// ====================================================================
// 🛡️ INPUT SANITIZER — NoSQL Injection oldini olish
// ====================================================================
function sanitizeString(value, fieldName = 'field') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} string bo'lishi kerak`);
  }
  if (/\$/.test(value)) {
    throw new Error(`${fieldName} da noto'g'ri belgi mavjud`);
  }
  return value.trim();
}

function sanitizeDeviceId(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^[a-zA-Z0-9\-_]{1,128}$/.test(value)) {
    throw new Error("deviceId formati noto'g'ri");
  }
  return value;
}

// ✅ YANGI: ObjectId sanitizer (userId uchun)
function sanitizeObjectId(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^[a-fA-F0-9]{24}$/.test(value)) {
    throw new Error("userId formati noto'g'ri");
  }
  return value;
}

function sanitizeRole(value) {
  const allowed = ['seller', 'admin', 'cashier'];
  if (!allowed.includes(value)) {
    throw new Error("Noto'g'ri role qiymati");
  }
  return value;
}

// ====================================================================
// 🍪 COOKIE SOZLAMASI
// ====================================================================
const isDev = (config.NODE_ENV || process.env.NODE_ENV) !== 'production';

const cookieOptions = {
  httpOnly: true,
  secure: !isDev,
  sameSite: isDev ? 'lax' : 'strict',
  path: '/',
};

const clearCookieOptions = {
  httpOnly: true,
  secure: !isDev,
  sameSite: isDev ? 'lax' : 'strict',
  path: '/',
};

// ====================================================================
// 🔑 TOKEN GENERATOR
// ====================================================================
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
// 🔐 LOGIN
// ====================================================================
exports.login = async (req, res) => {
  let login, password, googleAuthCode, deviceId, deviceType, deviceOS;

  try {
    login          = sanitizeString(req.body.login, 'login');
    password       = sanitizeString(req.body.password, 'password');
    googleAuthCode = req.body.googleAuthCode
      ? sanitizeString(req.body.googleAuthCode, 'googleAuthCode')
      : null;
    deviceId   = sanitizeDeviceId(req.body.deviceId);
    deviceType = sanitizeString(req.body.deviceType, 'deviceType');
    deviceOS   = sanitizeString(req.body.deviceOS, 'deviceOS');
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!deviceId || !deviceType || !deviceOS) {
    return res.status(400).json({ message: "Device ma'lumotlari majburiy" });
  }

  try {
    const normalizedLogin = login.toLowerCase();

    // ✅ $eq bilan login qidirish
    const user = await User.findOne({ login: { $eq: normalizedLogin } }).select('+password');

    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    if (user.isDeleted) return res.status(403).json({ message: "Hisob o'chirilgan" });

    const blockedDevice = user.blockedDevices?.find(d => d.deviceId === deviceId);
    if (blockedDevice && new Date() < new Date(blockedDevice.lockUntil)) {
      return res.status(403).json({
        message: "Qurilma bloklangan. 30 minutdan keyin urinib ko'ring."
      });
    }

    if (!user.password) {
      return res.status(500).json({ message: "Server xatosi" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
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
          message: "5 ta noto'g'ri urinish. Qurilma 30 minut bloklandi."
        });
      }
      await user.save();
      return res.status(401).json({ message: "Parol noto'g'ri" });
    }

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
        return res.status(400).json({ message: "Google Authenticator kodi noto'g'ri" });
      }
    }

    user.loginAttempts = 0;
    const { accessToken, refreshToken, refreshTokenId } = createTokens(user, deviceId);

    const deviceExists = user.devices?.some(d => d.deviceId === deviceId);
    if (deviceExists) {
      user.devices = user.devices.map(d =>
        d.deviceId === deviceId
          ? { ...d.toObject(), lastLogin: new Date(), isActive: true, token: accessToken, kickedAt: null }
          : { ...d.toObject(), isActive: false }
      );
    } else {
      user.devices = user.devices || [];
      user.devices.push({
        deviceId,
        deviceType: deviceType || "unknown",
        deviceOS:   deviceOS   || "unknown",
        lastLogin:  new Date(),
        isActive:   true,
        token:      accessToken,
        kickedAt:   null,
        isSuspicious: false,
        isTrusted:    false
      });
    }

    user.activeDevice = {
      deviceId,
      deviceType: deviceType || "unknown",
      deviceOS:   deviceOS   || "unknown",
      lastLogin:  new Date()
    };

    await user.save();

    res.cookie('accessToken',  accessToken,  { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    await UserSessionService.createSession({
      userId:         user._id,
      deviceId,
      ip:             req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress,
      userAgent:      req.headers['user-agent'],
      refreshTokenId,
      refreshToken,
      deviceType,
      deviceOS,
    });

    await AuditService.logUserAction({ login: user.login, action: 'LOGIN', status: 'SUCCESS' });

    return res.json({
      success: true,
      message: 'Kirish muvaffaqiyatli',
      user: { login: user.login, role: user.role, name: user.name || null }
    });

  } catch (err) {
    if (isDev) console.error("❌ Login xatosi:", err.stack || err);
    return res.status(500).json({ success: false, message: "Server xatosi yuz berdi" });
  }
};

// ====================================================================
// 🔁 TOKEN REFRESH
// ====================================================================
exports.refresh = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token yo'q" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    let normalizedLogin;
    try {
      normalizedLogin = sanitizeString(decoded.login, 'login').toLowerCase();
    } catch {
      return res.status(403).json({ message: "Token ma'lumotlari noto'g'ri" });
    }

    // ✅ $eq bilan login qidirish
    const user = await User.findOne({ login: { $eq: normalizedLogin } });

    if (!user || user.blocked) {
      return res.status(403).json({ message: 'Foydalanuvchi bloklangan' });
    }

    let safeDeviceId;
    try {
      safeDeviceId = sanitizeDeviceId(decoded.deviceId);
    } catch {
      return res.status(403).json({ message: "deviceId noto'g'ri" });
    }

    const session = await UserSessionService.getSession(user._id, safeDeviceId);
    const validToken = session?.refreshTokens?.find(
      rt => rt.tokenId === decoded.tokenId && rt.token === refreshToken
    );

    if (!validToken) {
      return res.status(403).json({ message: "Token noto'g'ri" });
    }

    const { accessToken, refreshToken: newRefreshToken, refreshTokenId } = createTokens(user, safeDeviceId);

    // ✅ FIX L383: 'devices.deviceId' ham $eq bilan
    await User.updateOne(
      {
        login:              { $eq: user.login },
        'devices.deviceId': { $eq: safeDeviceId }
      },
      { $set: { 'devices.$.token': accessToken } }
    );

    await UserSessionService.rotateRefreshToken({
      userId:     user._id,
      deviceId:   safeDeviceId,
      oldTokenId: decoded.tokenId,
      newToken: {
        tokenId:   refreshTokenId,
        token:     newRefreshToken,
        deviceId:  safeDeviceId,
        createdAt: new Date()
      }
    });

    res.cookie('accessToken',  accessToken,     { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({ success: true });
  } catch (err) {
    if (isDev) console.error('❌ Refresh xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// ====================================================================
// 💻 QURILMALAR BOSHQARUVI
// ====================================================================
exports.getUserDevices = async (req, res) => {
  try {
    // ✅ $eq bilan login qidirish
    const user = await User.findOne({ login: { $eq: req.user.login } }).select('devices');
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    const devices = (user.devices || []).map(d => ({
      deviceId:     d.deviceId,
      deviceType:   d.deviceType,
      deviceOS:     d.deviceOS,
      deviceModel:  d.deviceModel  || null,
      location:     d.location     || null,
      ip:           d.ip           || null,
      isActive:     d.isActive,
      lastLogin:    d.lastLogin,
      isTrusted:    d.isTrusted,
      isSuspicious: d.isSuspicious
    }));

    res.json({ success: true, devices });
  } catch (err) {
    if (isDev) console.error('❌ getUserDevices xatosi:', err);
    res.status(500).json({ message: "Server xatosi" });
  }
};

exports.kickDevice = async (req, res) => {
  let deviceId;

  try {
    deviceId = sanitizeDeviceId(req.body.deviceId);
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId kerak' });
  }

  const login = req.user.login;

  if (req.user.deviceId && req.user.deviceId === deviceId) {
    return res.status(400).json({ message: "O'z qurilmangizni chiqarib yuborib bo'lmaydi" });
  }

  try {
    // ✅ $eq bilan login qidirish
    const user = await User.findOne({ login: { $eq: login } });
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    const deviceSession = (user.devices || []).find(d => d.deviceId === deviceId);
    if (deviceSession?.token) {
      await TokenBlacklistService.add(deviceSession.token, { login, deviceId, reason: 'kicked' });
    }

    const { io } = require('../server');
    const { getSocketByDevice } = require('../socket');
    const targetSockets = getSocketByDevice(login, deviceId);

    if (targetSockets.length > 0) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('forceLogout', {
          reason: 'Boshqa qurilma tomonidan tizimdan chiqarildingiz'
        });
      });
    }

    // ✅ FIX L411, L493: 'devices.deviceId' ham $eq bilan
    await User.updateOne(
      {
        login:              { $eq: login },
        'devices.deviceId': { $eq: deviceId }
      },
      {
        $set: {
          'devices.$.isActive': false,
          'devices.$.token':    null,
          'devices.$.kickedAt': new Date()
        }
      }
    );

    if (user.activeDevice?.deviceId === deviceId) {
      await User.updateOne(
        { login: { $eq: login } },
        { $set: { activeDevice: null } }
      );
    }

    res.json({ success: true, message: "Qurilma muvaffaqiyatli chiqarildi" });

  } catch (err) {
    if (isDev) console.error("❌ kickDevice xatosi:", err);
    return res.status(500).json({ message: "Server xatosi" });
  }
};

// ====================================================================
// 👤 FOYDALANUVCHI BOSHQARUVI
// ====================================================================
exports.changePassword = async (req, res) => {
  let currentPassword, newPassword;

  try {
    currentPassword = sanitizeString(req.body.currentPassword, 'currentPassword');
    newPassword     = sanitizeString(req.body.newPassword, 'newPassword');
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: "Yangi parol kamida 8 belgi bo'lishi kerak" });
  }

  try {
    // ✅ $eq bilan login qidirish
    const user = await User.findOne({ login: { $eq: req.user.login } }).select('+password');
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    if (!user.password) return res.status(500).json({ message: 'Server xatosi' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "Joriy parol noto'g'ri" });

    user.password = newPassword;
    await user.save();
    return res.json({ success: true, message: "Parol muvaffaqiyatli o'zgartirildi" });
  } catch (err) {
    if (isDev) console.error('changePassword xatosi:', err.stack || err);
    return res.status(500).json({ message: 'Server xatosi yuz berdi' });
  }
};

exports.register = async (req, res) => {
  let login, password, role;

  try {
    login    = sanitizeString(req.body.login, 'login');
    password = sanitizeString(req.body.password, 'password');
    role     = sanitizeRole(req.body.role || 'seller');
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!login || !password) return res.status(400).json({ message: 'Login va parol majburiy' });

  if (password.length < 8) {
    return res.status(400).json({ message: "Parol kamida 8 belgi bo'lishi kerak" });
  }

  try {
    const normalizedLogin = login.toLowerCase();

    // ✅ $eq bilan qidirish
    const existingUser = await User.findOne({ login: { $eq: normalizedLogin } });
    if (existingUser) return res.status(409).json({ message: 'Bu login allaqachon mavjud' });

    const newUser = new User({ login: normalizedLogin, password, role });
    await newUser.save();
    await AuditService.logUserAction({ login: normalizedLogin, action: 'REGISTER', status: 'SUCCESS' });
    res.status(201).json({
      message: 'Foydalanuvchi yaratildi',
      user: { login: normalizedLogin, role: newUser.role }
    });
  } catch (err) {
    if (isDev) console.error('❌ Register xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

exports.confirmLogin = async (req, res) => {
  let login, deviceId, deviceType, deviceOS;

  try {
    login      = sanitizeString(req.body.login, 'login');
    deviceId   = sanitizeDeviceId(req.body.deviceId);
    deviceType = sanitizeString(req.body.deviceType || 'unknown', 'deviceType');
    deviceOS   = sanitizeString(req.body.deviceOS   || 'unknown', 'deviceOS');
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  const confirm = req.body.confirm;

  try {
    const normalizedLogin = login.toLowerCase();
    if (req.user.login !== normalizedLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }

    // ✅ $eq bilan qidirish
    const user = await User.findOne({ login: { $eq: normalizedLogin } });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });

    if (confirm) {
      if (user.activeDevice?.deviceId) {
        // ✅ FIX L527: deviceId ham $eq bilan
        await UserSession.updateOne(
          {
            userId:   user._id,
            deviceId: { $eq: user.activeDevice.deviceId },
            isActive: true
          },
          { isActive: false, lastLogout: new Date() }
        );
      }
      user.activeDevice = { deviceId, deviceType, deviceOS, lastLogin: new Date() };
      await user.save();
      await AuditService.logUserAction({
        login: normalizedLogin, action: 'CONFIRM_DEVICE', status: 'SUCCESS'
      });
      return res.json({ message: "Yangi qurilmaga o'tkazildi" });
    }

    await AuditService.logUserAction({
      login: normalizedLogin, action: 'CONFIRM_DEVICE', status: 'DECLINED'
    });
    return res.json({ message: 'Kirish rad etildi' });
  } catch (err) {
    if (isDev) console.error('❌ Confirm xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

exports.logout = async (req, res) => {
  let deviceId, safeUserId;

  try {
    deviceId   = sanitizeDeviceId(req.body.deviceId);
    safeUserId = sanitizeObjectId(req.body.userId); // ✅ FIX: ObjectId format tekshiruvi
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!safeUserId) {
    return res.status(400).json({ message: "userId noto'g'ri" });
  }

  try {
    // ✅ FIX L544: userId va deviceId ham $eq bilan
    const session = await UserSession.findOne({
      userId:   { $eq: safeUserId },
      deviceId: { $eq: deviceId },
      isActive: true
    });

    if (session) {
      session.isActive   = false;
      session.lastLogout = new Date();
      await session.save();
    }

    const user = await User.findById(safeUserId);
    if (user) {
      const deviceSession = (user.devices || []).find(d => d.deviceId === deviceId);
      if (deviceSession?.token) {
        await TokenBlacklistService.add(deviceSession.token, {
          login: user.login, deviceId, reason: 'logout'
        });
      }

      // ✅ FIX: 'devices.deviceId' ham $eq bilan
      await User.updateOne(
        {
          _id:                { $eq: safeUserId },
          'devices.deviceId': { $eq: deviceId }
        },
        { $set: { 'devices.$.isActive': false, 'devices.$.token': null } }
      );

      if (user.activeDevice?.deviceId === deviceId) {
        user.activeDevice = null;
        await user.save();
      }

      await AuditService.logUserAction({ login: user.login, action: 'LOGOUT', status: 'SUCCESS' });
    }

    res.clearCookie('accessToken',  clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.json({ success: true, message: 'Logout muvaffaqiyatli' });
  } catch (err) {
    if (isDev) console.error('❌ Logout xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// ====================================================================
// 🛡️ RBAC & ADMIN
// ====================================================================
exports.isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin huquqi talab qilinadi' });
  }
  next();
};

exports.createAdmin = async (req, res) => {
  let login, password;

  try {
    login    = sanitizeString(req.body.login, 'login');
    password = sanitizeString(req.body.password, 'password');
  } catch (validationErr) {
    return res.status(400).json({ message: validationErr.message });
  }

  if (!login || !password) return res.status(400).json({ message: 'Login va parol majburiy' });

  if (password.length < 8) {
    return res.status(400).json({ message: "Parol kamida 8 belgi bo'lishi kerak" });
  }

  try {
    const normalizedLogin = login.toLowerCase();

    // ✅ $eq bilan qidirish
    const existingUser = await User.findOne({ login: { $eq: normalizedLogin } });
    if (existingUser) return res.status(409).json({ message: 'Bu login allaqachon mavjud' });

    const newUser = new User({ login: normalizedLogin, password, role: 'admin' });
    await newUser.save();
    await AuditService.logUserAction({ login: normalizedLogin, action: 'CREATE_ADMIN', status: 'SUCCESS' });
    res.status(201).json({
      message: 'Admin yaratildi',
      user: { login: normalizedLogin, role: newUser.role }
    });
  } catch (err) {
    if (isDev) console.error('❌ CreateAdmin xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

module.exports = {
  login:          exports.login,
  refresh:        exports.refresh,
  changePassword: exports.changePassword,
  register:       exports.register,
  confirmLogin:   exports.confirmLogin,
  getUserDevices: exports.getUserDevices,
  kickDevice:     exports.kickDevice,
  logout:         exports.logout,
  isAdmin:        exports.isAdmin,
  createAdmin:    exports.createAdmin,
  generateTokens: exports.generateTokens
};