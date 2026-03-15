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
// 🍪 COOKIE SOZLAMASI — development va production uchun
// ====================================================================
const isDev = (config.NODE_ENV || process.env.NODE_ENV) !== 'production';

// ✅ FIX: development da 'lax', production da 'strict'
// 'strict' cross-port so'rovlarda cookie yubormasligiga sabab bo'ladi
const cookieOptions = {
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
    const user = await User.findOne({ login: normalizedLogin }).select('+password');

    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    if (user.isDeleted) return res.status(403).json({ message: "Hisob o'chirilgan" });

    const blockedDevice = user.blockedDevices?.find(d => d.deviceId === deviceId);
    if (blockedDevice && new Date() < new Date(blockedDevice.lockUntil)) {
      return res.status(403).json({
        message: "Qurilma bloklangan. 30 minutdan keyin urinib ko'ring."
      });
    }

    if (!user.password) {
      return res.status(500).json({ message: "Server xatosi: foydalanuvchi ma'lumotlari buzilgan" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.blockedDevices = user.blockedDevices || [];
        user.blockedDevices.push({ deviceId, lockUntil: new Date(Date.now() + 30 * 60 * 1000) });
        user.loginAttempts = 0;
        await user.save();
        return res.status(403).json({ message: "5 ta noto'g'ri urinish. Qurilma 30 minut bloklandi." });
      }
      await user.save();
      return res.status(401).json({ message: "Parol noto'g'ri" });
    }

    if (user.googleAuthEnabled) {
      if (!googleAuthCode) {
        return res.status(200).json({ requiresGoogleAuth: true, message: "Google Authenticator kodi talab qilinadi" });
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
          user.blockedDevices.push({ deviceId, lockUntil: new Date(Date.now() + 30 * 60 * 1000) });
          user.loginAttempts = 0;
          await user.save();
          return res.status(403).json({ message: "5 ta noto'g'ri Google Auth urinish. Qurilma 30 minut bloklandi." });
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
        deviceOS: deviceOS || "unknown",
        lastLogin: new Date(),
        isActive: true,
        token: accessToken,
        kickedAt: null,
        isSuspicious: false,
        isTrusted: false
      });
    }

    user.activeDevice = {
      deviceId,
      deviceType: deviceType || "unknown",
      deviceOS: deviceOS || "unknown",
      lastLogin: new Date()
    };

    await user.save();

    // ✅ FIX: cookieOptions endi yuqorida isDev ga qarab belgilangan
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    // ✅ Session yaratish: refresh tokenni to'g'ri saqlash
    await UserSessionService.createSession({
      userId: user._id,
      deviceId,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
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
    console.error("❌ Login xatosi:", err.stack || err);
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
    const user = await User.findOne({ login: decoded.login });

    if (!user || user.blocked) {
      return res.status(403).json({ message: 'Foydalanuvchi bloklangan' });
    }

    const session = await UserSessionService.getSession(user._id, decoded.deviceId);
    const validToken = session?.refreshTokens?.find(
      rt => rt.tokenId === decoded.tokenId && rt.token === refreshToken
    );

    if (!validToken) {
      return res.status(403).json({ message: "Token noto'g'ri" });
    }

    const { accessToken, refreshToken: newRefreshToken, refreshTokenId } = createTokens(user, decoded.deviceId);

    await User.updateOne(
      { login: user.login, 'devices.deviceId': decoded.deviceId },
      { $set: { 'devices.$.token': accessToken } }
    );

    await UserSessionService.rotateRefreshToken({
      userId: user._id,
      deviceId: decoded.deviceId,
      oldTokenId: decoded.tokenId,
      newToken: { tokenId: refreshTokenId, token: newRefreshToken, deviceId: decoded.deviceId, createdAt: new Date() }
    });

    // ✅ FIX: refresh da ham cookieOptions ishlatiladi
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Refresh xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// ====================================================================
// 💻 QURILMALAR BOSHQARUVI
// ====================================================================
exports.getUserDevices = async (req, res) => {
  try {
    const user = await User.findOne({ login: req.user.login }).select('devices');
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
    console.error('❌ getUserDevices xatosi:', err);
    res.status(500).json({ message: "Server xatosi" });
  }
};

exports.kickDevice = async (req, res) => {
  const { deviceId } = req.body;
  const login = req.user.login;

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId kerak' });
  }

  // ✅ O'z qurilmasini kick qilishga yo'l qo'ymaslik
  if (req.user.deviceId && req.user.deviceId === deviceId) {
    return res.status(400).json({ message: "O'z qurilmangizni chiqarib yuborib bo'lmaydi" });
  }

  try {
    const user = await User.findOne({ login });
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    const deviceSession = (user.devices || []).find(d => d.deviceId === deviceId);
    if (deviceSession?.token) {
      await TokenBlacklistService.add(deviceSession.token, { login, deviceId, reason: 'kicked' });
      console.log(`⛔ Token blacklistga qo'shildi: ${login} | ${deviceId}`);
    } else {
      console.warn(`⚠️ Token topilmadi — qurilma offline yoki token yo'q: ${deviceId}`);
    }

    const { io } = require('../server');
    const { getSocketByDevice } = require('../socket');
    const targetSockets = getSocketByDevice(login, deviceId);
    console.log(`🎯 Kick: ${login} | ${deviceId} | socketlar: ${targetSockets.length}`);

    if (targetSockets.length > 0) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('forceLogout', { reason: 'Boshqa qurilma tomonidan tizimdan chiqarildingiz' });
        console.log(`⛔ forceLogout yuborildi → ${socketId}`);
      });
    } else {
      console.warn(`⚠️ Socket topilmadi — qurilma offline bo'lishi mumkin`);
    }

    await User.updateOne(
      { login, 'devices.deviceId': deviceId },
      { $set: { 'devices.$.isActive': false, 'devices.$.token': null, 'devices.$.kickedAt': new Date() } }
    );

    if (user.activeDevice?.deviceId === deviceId) {
      await User.updateOne({ login }, { $set: { activeDevice: null } });
    }

    console.log(`✅ Qurilma chiqarildi: ${login} | ${deviceId}`);
    res.json({ success: true, message: "Qurilma muvaffaqiyatli chiqarildi" });

  } catch (err) {
    console.error("❌ kickDevice xatosi:", err);
    return res.status(500).json({ message: "Server xatosi" });
  }
};

// ====================================================================
// 👤 FOYDALANUVCHI BOSHQARUVI
// ====================================================================
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const normalizedLogin = req.user.login;
    const user = await User.findOne({ login: normalizedLogin }).select('+password');
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    if (!user.password) return res.status(500).json({ message: 'Server xatosi: parol topilmadi' });
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ message: "Joriy parol noto'g'ri" });
    user.password = newPassword;
    await user.save();
    return res.json({ success: true, message: "Parol muvaffaqiyatli o'zgartirildi" });
  } catch (err) {
    console.error('changePassword xatosi:', err.stack || err);
    return res.status(500).json({ message: 'Server xatosi yuz berdi' });
  }
};

exports.register = async (req, res) => {
  const { login, password, role = 'seller' } = req.body;
  if (!login || !password) return res.status(400).json({ message: 'Login va parol majburiy' });
  if (!['seller', 'admin', 'cashier'].includes(role)) return res.status(400).json({ message: "Noto'g'ri role" });
  try {
    const normalizedLogin = login.trim().toLowerCase();
    const existingUser = await User.findOne({ login: normalizedLogin });
    if (existingUser) return res.status(409).json({ message: 'Bu login allaqachon mavjud' });
    const newUser = new User({ login: normalizedLogin, password, role });
    await newUser.save();
    await AuditService.logUserAction({ login: normalizedLogin, action: 'REGISTER', status: 'SUCCESS' });
    res.status(201).json({ message: '✅ Foydalanuvchi yaratildi', user: { login: normalizedLogin, role: newUser.role } });
  } catch (err) {
    console.error('❌ Register xatosi:', err);
    res.status(500).json({ message: 'Server xatosi', error: err.message });
  }
};

exports.confirmLogin = async (req, res) => {
  const { login, deviceId, deviceType = 'unknown', deviceOS = 'unknown', confirm } = req.body;
  try {
    const normalizedLogin = (login || '').trim().toLowerCase();
    if (req.user.login !== normalizedLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }
    const user = await User.findOne({ login: normalizedLogin });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    if (confirm) {
      if (user.activeDevice?.deviceId) {
        await UserSession.updateOne(
          { userId: user._id, deviceId: user.activeDevice.deviceId, isActive: true },
          { isActive: false, lastLogout: new Date() }
        );
      }
      user.activeDevice = { deviceId, deviceType, deviceOS, lastLogin: new Date() };
      await user.save();
      await AuditService.logUserAction({ login: normalizedLogin, action: 'CONFIRM_DEVICE', status: 'SUCCESS' });
      return res.json({ message: "Yangi qurilmaga o'tkazildi" });
    }
    await AuditService.logUserAction({ login: normalizedLogin, action: 'CONFIRM_DEVICE', status: 'DECLINED' });
    return res.json({ message: 'Kirish rad etildi' });
  } catch (err) {
    console.error('❌ Confirm xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
};

exports.logout = async (req, res) => {
  const { userId, deviceId } = req.body;
  try {
    const session = await UserSession.findOne({ userId, deviceId, isActive: true });
    if (session) {
      session.isActive = false;
      session.lastLogout = new Date();
      await session.save();
    }
    const user = await User.findById(userId);
    if (user) {
      const deviceSession = (user.devices || []).find(d => d.deviceId === deviceId);
      if (deviceSession?.token) {
        await TokenBlacklistService.add(deviceSession.token, { login: user.login, deviceId, reason: 'logout' });
      }
      await User.updateOne(
        { _id: userId, 'devices.deviceId': deviceId },
        { $set: { 'devices.$.isActive': false, 'devices.$.token': null } }
      );
      if (user.activeDevice?.deviceId === deviceId) {
        user.activeDevice = null;
        await user.save();
      }
      await AuditService.logUserAction({ login: user.login, action: 'LOGOUT', status: 'SUCCESS' });
    }
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
exports.isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin huquqi talab qilinadi' });
  next();
};

exports.createAdmin = async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ message: 'Login va parol majburiy' });
  try {
    const normalizedLogin = login.trim().toLowerCase();
    const existingUser = await User.findOne({ login: normalizedLogin });
    if (existingUser) return res.status(409).json({ message: 'Bu login allaqachon mavjud' });
    const newUser = new User({ login: normalizedLogin, password, role: 'admin' });
    await newUser.save();
    await AuditService.logUserAction({ login: normalizedLogin, action: 'CREATE_ADMIN', status: 'SUCCESS' });
    res.status(201).json({ message: '✅ Admin yaratildi', user: { login: normalizedLogin, role: newUser.role } });
  } catch (err) {
    console.error('❌ CreateAdmin xatosi:', err);
    res.status(500).json({ message: 'Server xatosi', error: err.message });
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