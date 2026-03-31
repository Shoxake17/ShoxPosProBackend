// controllers/authController.js

const User = require('../models/User');
const UserSession = require('../models/UserSession');
const AuditService = require('../services/auditService');
const UserSessionService = require('../services/userSessionService');
const TokenBlacklistService = require('../services/tokenBlacklistService');
const { getUserSockets, sendToUser } = require('../socket');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

// ====================================================================
// 🛡️ INPUT SANITIZER — NoSQL Injection va XSS himoyasi
// ====================================================================
function sanitizeString(value, fieldName = 'field') {
  if (value === null || value === undefined) {
    return ''; 
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} satr bo'lishi kerak`);
  }
  // Xavfli belgilarni tekshirish (NoSQL Injection dan himoya)
  // Faqat eng xavfli belgilarni qoldiramiz, oddiy belgilarga ruxsat beramiz
  if (/[\$\{\}]/.test(value)) {
    throw new Error(`${fieldName}da noto'g'ri belgilar mavjud`);
  }
  return value.trim();
}

function sanitizeDeviceId(value) {
  if (!value || typeof value !== 'string') return null;
  // DeviceId UUID yoki ixtiyoriy xavfsiz formatda bo'lishi mumkin
  if (!/^[a-zA-Z0-9\-_:]{1,128}$/.test(value)) {
    throw new Error("deviceId formati noto'g'ri");
  }
  return value;
}

function sanitizeObjectId(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^[a-fA-F0-9]{24}$/.test(value)) {
    throw new Error("ID formati noto'g'ri");
  }
  return value;
}

function sanitizeRole(value) {
  const allowed = ['admin', 'cashier'];
  if (!allowed.includes(value)) {
    throw new Error("Noto'g'ri role qiymati");
  }
  return value;
}

// ====================================================================
// 🍪 COOKIE SOZLAMALARI
// ====================================================================
const isDev = (config.NODE_ENV || process.env.NODE_ENV) !== 'production';

const cookieOptions = {
  httpOnly: true,
  secure: !isDev, // Production-da faqat HTTPS orqali
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
    { ...payload, tokenId: refreshTokenId },
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
    googleAuthCode = req.body.googleAuthCode ? sanitizeString(req.body.googleAuthCode, 'googleAuthCode') : null;
    deviceId       = sanitizeDeviceId(req.body.deviceId);
    deviceType     = req.body.deviceType ? sanitizeString(req.body.deviceType, 'deviceType') : 'unknown';
    deviceOS       = req.body.deviceOS ? sanitizeString(req.body.deviceOS, 'deviceOS') : 'unknown';
  } catch (err) {
    if (isDev) {
      console.warn("⚠️ [Login Validation Error]:", err.message);
    }
    return res.status(400).json({ message: err.message });
  }

  if (!deviceId) {
    if (isDev) console.warn("⚠️ [Login Error]: deviceId topilmadi", req.body);
    return res.status(400).json({ message: "deviceId topilmadi" });
  }

  try {
    const normalizedLogin = login.toLowerCase();
    const user = await User.findOne({ login: { $eq: normalizedLogin } }).select('+password +googleAuthSecret');

    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    if (user.isDeleted) return res.status(403).json({ message: "Hisob o'chirilgan" });

    // Qurilma blokini tekshirish
    const blockedDevice = user.blockedDevices?.find(d => d.deviceId === deviceId);
    if (blockedDevice && new Date() < new Date(blockedDevice.lockUntil)) {
      return res.status(403).json({ message: "Qurilma 30 minutga bloklangan" });
    }

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.blockedDevices.push({ deviceId, lockUntil: new Date(Date.now() + 30 * 60 * 1000) });
        user.loginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ message: "Parol noto'g'ri" });
    }

    // Google 2FA Tekshiruvi
    if (user.googleAuthEnabled) {
      if (!googleAuthCode) {
        return res.status(200).json({ requiresGoogleAuth: true, message: "2FA kodi kerak" });
      }
      const verified = speakeasy.totp.verify({
        secret: user.googleAuthSecret,
        encoding: 'base32',
        token: googleAuthCode,
        window: 1 
      });
      if (!verified) return res.status(400).json({ message: "2FA kod xato" });
    }

    user.loginAttempts = 0;
    const { accessToken, refreshToken, refreshTokenId } = createTokens(user, deviceId);

    // Qurilmalar ro'yxatini boshqarish (Cleanup + Update)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    user.devices = (user.devices || []).filter(d => d.isActive || new Date(d.lastLogin) > thirtyDaysAgo);

    const devIdx = user.devices.findIndex(d => d.deviceId === deviceId);
    const deviceData = {
      deviceId, deviceType, deviceOS, lastLogin: new Date(),
      isActive: true, token: accessToken, kickedAt: null
    };

    if (devIdx > -1) {
      user.devices[devIdx] = { ...user.devices[devIdx].toObject(), ...deviceData };
    } else {
      user.devices.push(deviceData);
    }

    user.activeDevice = { deviceId, deviceType, deviceOS, lastLogin: new Date() };
    
    // 🚀 Parallel bajarish — login vaqtini tejash uchun
    const [savedUser] = await Promise.all([
      user.save(),
      UserSessionService.createSession({
        userId: user._id, deviceId, refreshToken, refreshTokenId, deviceType, deviceOS,
        ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent']
      }),
      AuditService.logUserAction({ login: user.login, action: 'LOGIN', status: 'SUCCESS' })
    ]);

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.json({
      success: true,
      user: { login: user.login, role: user.role, name: user.name }
    });
  } catch (err) {
    if (isDev) console.error("❌ Login Error:", err);
    return res.status(500).json({ message: "Server xatosi" });
  }
};

// ====================================================================
// 🔁 TOKEN REFRESH
// ====================================================================
exports.refresh = async (req, res) => {
  const oldRefreshToken = req.cookies.refreshToken;
  if (!oldRefreshToken) return res.status(401).json({ message: "Refresh token topilmadi" });

  try {
    const decoded = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.blocked) return res.status(403).json({ message: "Ruxsat etilmagan" });

    const session = await UserSessionService.getSession(user._id, decoded.deviceId);
    const isValid = session?.refreshTokens?.some(rt => rt.token === oldRefreshToken);

    if (!isValid) {
      // 🛡️ REUSE DETECTION: Token o'g'irlangan bo'lishi mumkin!
      await UserSessionService.clearAllSessions(user._id);
      return res.status(403).json({ message: "Xavfsizlik xatosi: Qayta login qiling" });
    }

    const { accessToken, refreshToken, refreshTokenId } = createTokens(user, decoded.deviceId);

    await User.updateOne(
      { _id: user._id, 'devices.deviceId': decoded.deviceId },
      { $set: { 'devices.$.token': accessToken } }
    );

    await UserSessionService.rotateRefreshToken({
      userId: user._id, deviceId: decoded.deviceId, oldTokenId: decoded.tokenId,
      newToken: { tokenId: refreshTokenId, token: refreshToken, createdAt: new Date() }
    });

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.json({ success: true });
  } catch (err) {
    return res.status(403).json({ message: "Sessiya muddati tugagan" });
  }
};

// ====================================================================
// 💻 QURILMALAR BOSHQARUVI
// ====================================================================
exports.getUserDevices = async (req, res) => {
  try {
    const user = await User.findOne({ login: { $eq: req.user.login } }).select('devices');
    if (!user) return res.status(404).json({ message: "Topilmadi" });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cleaned = (user.devices || []).filter(d => d.isActive || new Date(d.lastLogin) > thirtyDaysAgo);

    if (cleaned.length !== user.devices.length) {
      await User.updateOne({ _id: user._id }, { $set: { devices: cleaned } });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, devices: cleaned });
  } catch (err) {
    return res.status(500).json({ message: "Server xatosi" });
  }
};

exports.kickDevice = async (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.body.deviceId);
    if (req.user.deviceId === deviceId) {
      return res.status(400).json({ message: "O'z qurilmangizni o'chira olmaysiz" });
    }

    const user = await User.findOne({ login: { $eq: req.user.login } });
    const device = user.devices.find(d => d.deviceId === deviceId);

    if (device?.token) {
      await TokenBlacklistService.add(device.token, { login: user.login, deviceId, reason: 'kicked' });
    }

    // Socket orqali Logout qilish
    const { io } = require('../server');
    const { getSocketByDevice } = require('../socket');
    const sockets = getSocketByDevice(user.login, deviceId);
    sockets.forEach(s => io.to(s).emit('forceLogout', { reason: 'Sessiya tugatildi' }));

    await User.updateOne(
      { _id: user._id, 'devices.deviceId': deviceId },
      { $set: { 'devices.$.isActive': false, 'devices.$.token': null, 'devices.$.kickedAt': new Date() } }
    );

    if (user.activeDevice?.deviceId === deviceId) {
      await User.updateOne({ _id: user._id }, { $set: { activeDevice: null } });
    }

    return res.json({ success: true, message: "Qurilma chiqarildi" });
  } catch (err) {
    return res.status(500).json({ message: "Xatolik yuz berdi" });
  }
};

// ====================================================================
// 👤 USER OPS
// ====================================================================
exports.changePassword = async (req, res) => {
  try {
    const currentPassword = sanitizeString(req.body.currentPassword, 'currentPassword');
    const newPassword     = sanitizeString(req.body.newPassword, 'newPassword');

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "Parol juda qisqa" });
    }

    const user = await User.findOne({ login: { $eq: req.user.login } }).select('+password');
    const isMatch = await bcrypt.compare(currentPassword, user.password || '');
    if (!isMatch) return res.status(401).json({ message: "Joriy parol xato" });

    // Yangi parol eski parol bilan bir xil emasligini tekshirish
    const isNewPasswordSameAsOld = await bcrypt.compare(newPassword, user.password || '');
    if (isNewPasswordSameAsOld) {
      return res.status(400).json({ message: "Yangi parol joriy paroldan farqli bo'lishi kerak" });
    }

    user.password = newPassword;
    await user.save();
    return res.json({ success: true, message: "Parol muvaffaqiyatli yangilandi" });
  } catch (err) {
    return res.status(500).json({ message: "Server xatosi" });
  }
};

exports.register = async (req, res) => {
  try {
    const login    = sanitizeString(req.body.login, 'login').toLowerCase();
    const password = sanitizeString(req.body.password, 'password');
    
    // 🛡️ Admin faqat bitta bo'lishi kerak. Yangi qo'shiladiganlar faqat 'cashier' bo'ladi.
    const role     = 'cashier';

    if (password.length < 8) return res.status(400).json({ message: "Parol 8 tadan ko'p bo'lsin" });

    const exists = await User.findOne({ login: { $eq: login } });
    if (exists) return res.status(409).json({ message: "Login band" });

    const newUser = new User({ login, password, role });
    await newUser.save();
    await AuditService.logUserAction({ login, action: 'REGISTER', status: 'SUCCESS' });

    return res.status(201).json({ success: true, user: { login, role } });
  } catch (err) {
    return res.status(500).json({ message: "Server xatosi" });
  }
};

exports.confirmLogin = async (req, res) => {
  try {
    const login    = sanitizeString(req.body.login, 'login').toLowerCase();
    const deviceId = sanitizeDeviceId(req.body.deviceId);
    const confirm  = req.body.confirm;

    if (req.user.login !== login && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }

    const user = await User.findOne({ login: { $eq: login } });
    if (!user) return res.status(404).json({ message: "Topilmadi" });

    if (confirm) {
      // Eski aktiv sessiyani yopish
      if (user.activeDevice?.deviceId) {
        await UserSession.updateOne(
          { userId: user._id, deviceId: user.activeDevice.deviceId, isActive: true },
          { isActive: false, lastLogout: new Date() }
        );
      }
      user.activeDevice = { deviceId, lastLogin: new Date() };
      await user.save();
      return res.json({ message: "Tasdiqlandi" });
    }
    return res.json({ message: "Rad etildi" });
  } catch (err) {
    return res.status(500).json({ message: "Xatolik" });
  }
};

exports.logout = async (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.body.deviceId);
    const userId   = sanitizeObjectId(req.body.userId);

    const session = await UserSession.findOneAndUpdate(
      { userId, deviceId, isActive: true },
      { isActive: false, lastLogout: new Date() }
    );

    const user = await User.findById(userId);
    if (user) {
      const device = user.devices.find(d => d.deviceId === deviceId);
      if (device?.token) await TokenBlacklistService.add(device.token, { login: user.login, deviceId, reason: 'logout' });

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

    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: "Xatolik" });
  }
};

// ====================================================================
// 🛡️ ADMIN OPS
// ====================================================================
exports.isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: "Admin emas" });
  next();
};

exports.createAdmin = async (req, res) => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
      return res.status(403).json({ message: "Admin allaqachon mavjud. Faqat bitta admin bo'lishi mumkin." });
    }

    const login    = sanitizeString(req.body.login, 'login').toLowerCase();
    const password = sanitizeString(req.body.password, 'password');

    const exists = await User.findOne({ login: { $eq: login } });
    if (exists) return res.status(409).json({ message: "Login band" });

    const newAdmin = new User({ login, password, role: 'admin' });
    await newAdmin.save();
    return res.status(201).json({ success: true, message: "Admin yaratildi" });
  } catch (err) {
    return res.status(500).json({ message: "Xatolik" });
  }
};

// Foydalanuvchi holati (admin yoki o'zi)
exports.userStatus = async (req, res) => {
  try {
    const login = sanitizeString(req.query.login, 'login');
    if (!login) return res.status(400).json({ error: 'Login kerak' });

    const safeLogin = login.toLowerCase();

    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Ruxsat yo'q" });
    }
    
    const user = await User.findOne({ login: { $eq: safeLogin } }).select('-password');
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Foydalanuvchini aktivlashtirish (admin)
exports.activateUser = async (req, res) => {
  try {
    const login = sanitizeString(req.body.login, 'login');
    if (!login) return res.status(400).json({ message: 'Login kerak' });

    const safeLogin = login.toLowerCase();

    const user = await User.findOneAndUpdate(
      { login: { $eq: safeLogin } },
      { blocked: false, active: true },
      { returnDocument: 'after' }
    );
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi!' });

    sendToUser(safeLogin, 'userActivated', null);

    res.json({ message: "Foydalanuvchi blokdan chiqarildi va aktiv qilindi." });
  } catch (err) {
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// Foydalanuvchini bloklash (admin)
exports.blockUser = async (req, res) => {
  try {
    const login = sanitizeString(req.body.login, 'login');
    if (!login) return res.status(400).json({ message: 'Login kerak' });

    const safeLogin = login.toLowerCase();

    const user = await User.findOneAndUpdate(
      { login: { $eq: safeLogin } },
      { blocked: true, active: false },
      { returnDocument: 'after' }
    );
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi!' });

    sendToUser(safeLogin, 'forceLogout', { reason: 'Administrator tomonidan bloklandi' });

    res.json({ message: 'Foydalanuvchi bloklandi.' });
  } catch (err) {
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// Faol foydalanuvchilar (admin)
exports.activeUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server xatosi' });
  }
};

// Sessiya holati tekshiruvi
exports.checkStatus = async (req, res) => {
  try {
    const login = sanitizeString(req.body.login, 'login');
    const deviceId = sanitizeDeviceId(req.body.deviceId);
    
    if (!login || !deviceId) {
      return res.status(400).json({ active: false, reason: 'Login va deviceId kerak' });
    }

    const safeLogin = login.toLowerCase();

    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ active: false, reason: "Ruxsat yo'q" });
    }
    
    const user = await User.findOne({ login: { $eq: safeLogin } });
    if (!user)        return res.json({ active: false, reason: 'Foydalanuvchi topilmadi' });
    if (user.blocked) return res.json({ active: false, reason: 'Siz bloklangansiz!' });
    if (user.desktopDeviceId !== deviceId && user.mobileDeviceId !== deviceId) {
      return res.json({ active: false, reason: "Noto'g'ri sessiya!" });
    }
    return res.json({ active: user.active });
  } catch (err) {
    res.status(500).json({ active: false, reason: 'Server xatosi' });
  }
};

// Foydalanuvchi ma'lumotlarini qaytarish (me)
exports.getMe = async (req, res) => {
  try {
    // verifyToken middleware'dan kelgan req.user.id orqali topamiz
    const user = await User.findById(req.user.id).select('-password'); 
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        login: user.login,
        role: user.role,
        name: user.name,
        activeDevice: req.user.deviceId // Middleware'dan kelgan qurilma IDsi
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

module.exports = exports;