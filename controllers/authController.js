// controllers/authController.js

const User = require('../models/User');
const UserSession = require('../models/UserSession');
const AuditService = require('../services/auditService');
const UserSessionService = require('../services/userSessionService');
const TokenBlacklistService = require('../services/tokenBlacklistService');
const ShopType = require('../models/ShopType');
const { getUserSockets, sendToUser } = require('../socket');

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { normalizePhone, identityByUserId } = require('../services/ondexSso');
const { syncPartnerProfile } = require('../services/partnerProfile');

// ====================================================================
// INPUT SANITIZER — NoSQL Injection va XSS himoyasi
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
    deviceId,
    // Do'kon kategoriyasi (qurt/store/pharmacy) — `services/storeAccess.js`
    // shu bo'yicha API'ni cheklaydi. Imzolangan, mijoz o'zgartira olmaydi.
    sc: user.ondexStoreCategory || ''
  };

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
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
// 🔐 SESSIYA YARATISH
// ====================================================================
/**
 * Foydalanuvchi OnDex orqali TASDIQLANGANDAN KEYIN chaqiriladi
 * (`routes/ondexAuth.js`). Kimlikni tekshirish bu yerda EMAS: bu funksiya
 * faqat qurilmani ro'yxatga oladi, tokenlar va cookie'larni beradi.
 *
 * Parol, Authenticator va biometrik tekshiruv olib tashlangan: kirish
 * yagona OnDex akkaunti orqali.
 *
 * @returns {Promise<object>} mijozga ko'rsatiladigan foydalanuvchi ma'lumoti
 */
exports.establishSession = async (req, res, user, { deviceId, deviceType = 'unknown', deviceOS = 'unknown' }) => {
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

  // 🚀 Parallel bajarish — kirish vaqtini tejash uchun
  await Promise.all([
    user.save(),
    UserSessionService.createSession({
      userId: user._id, deviceId, refreshToken, refreshTokenId, deviceType, deviceOS,
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    }),
    AuditService.logUserAction({ login: user.login, action: 'LOGIN', status: 'SUCCESS' })
  ]);

  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

  // Effektif kategoriyalarni aniqlash
  let effectiveCategories = user.shopCategories || [];
  if (effectiveCategories.length === 0 && user.shopType) {
    const typeData = await ShopType.findOne({ value: user.shopType });
    if (typeData) {
      effectiveCategories = typeData.categories;
    }
  }

  return {
    login: user.login,
    role: user.role,
    name: user.name,
    shopName: user.shopName,
    shopType: user.shopType,
    storeCategory: user.ondexStoreCategory || '',
    shopCategories: effectiveCategories,
    subscription: user.subscription
  };
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
      //  REUSE DETECTION: Token o'g'irlangan bo'lishi mumkin!
      await UserSessionService.clearAllSessions(user._id);
      return res.status(403).json({ message: "Xavfsizlik xatosi: Qayta login qiling" });
    }

    // ┌─ KATEGORIYANI OnDex'DAN YANGILASH ───────────────────────────────┐
    // Admin do'konni qurtdan oddiy do'konga (yoki aksincha) o'tkazgan bo'lishi
    // mumkin; kategoriya tokenga yoziladi (`sc`), shuning uchun yangilash shu
    // yerda — token muddati tugab, yangilanganda. OnDex javob bermasa saqlangan
    // qiymat bilan davom etamiz (kassa to'xtab qolmasin), lekin kategoriyasi
    // HECH QACHON aniqlanmagan do'kon (eski hisob) kiritilmaydi.
    // └────────────────────────────────────────────────────────────────────┘
    if (user.ondexUserId) {
      try {
        const identity = await identityByUserId(user.ondexUserId);
        if (syncPartnerProfile(user, identity)) await user.save();
      } catch (e) {
        if (e && e.kind === 'invalid') {
          // OnDex akkaunti o'chirilgan/topilmaydi — sessiya yangilanmaydi.
          await UserSessionService.clearAllSessions(user._id);
          return res.status(403).json({ message: "Hisob mavjud emas. Qayta kiring" });
        }
        console.error(`⚠️ [refresh] OnDex kimligi yangilanmadi: ${e && e.message}`);
      }
    }
    if (user.ondexPartnerRole === 'store' && !user.ondexStoreCategory) {
      await UserSessionService.clearAllSessions(user._id);
      return res.status(403).json({ message: "Do'kon turi aniqlanmadi. Qayta kiring" });
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

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });
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
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    const device = user.devices.find(d => d.deviceId === deviceId);

    if (device?.token) {
      await TokenBlacklistService.add(device.token, { login: user.login, deviceId, reason: 'kicked' });
    }

    // 🚀 REAL-TIME FORCE LOGOUT (Socket orqali)
    const { getIO, getSocketByDevice } = require('../socket');
    const io = getIO();
    const sockets = getSocketByDevice(user.login, deviceId);
    
    if (io && sockets.length > 0) {
      sockets.forEach(s => {
        io.to(s).emit('forceLogout', { 
          reason: 'Sessiya administrator yoki boshqa qurilmangiz orqali tugatildi.' 
        });
      });
      console.log(`🔴 [Socket] Force logout yuborildi: ${user.login} (Device: ${deviceId})`);
    }

    // ── 1. User modelidan qurilmani o'chirish ($pull) ──
    const updateObj = {
      $pull: { devices: { deviceId: deviceId } }
    };

    // Agar o'chirilayotgan qurilma hozirgi activeDevice bo'lsa
    if (user.activeDevice?.deviceId === deviceId) {
      updateObj.$set = { activeDevice: null };
    }

    await User.updateOne({ _id: user._id }, updateObj);

    // ── 2. UserSession dagi barcha sessiyalarni yopish ──
    await UserSession.updateMany(
      { userId: user._id, deviceId: deviceId },
      { 
        isActive: false, 
        isBlocked: true, 
        lastLogout: new Date() 
      }
    );

    // Audit log
    await AuditService.logUserAction({ 
      login: user.login, 
      action: 'KICK_DEVICE', 
      status: 'SUCCESS',
      details: `Device ID: ${deviceId} chiqarib yuborildi`
    });

    return res.json({ success: true, message: "Qurilma muvaffaqiyatli chiqarildi" });
  } catch (err) {
    console.error("❌ Kick device error:", err);
    return res.status(500).json({ success: false, message: "Xatolik yuz berdi" });
  }
};

// register, updateUserCategories OLIB TASHLANDI: akkaunt va do'kon turi OnDex identity'da.

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

// Foydalanuvchi holati — FAQAT o'zi (login tokendan; so'rovdagi `login` e'tiborsiz).
// To'liq yozuv EMAS: faqat holat maydonlari (avval qurilmalar, push obunalari
// va boshqa ichki maydonlar ham ketardi).
exports.userStatus = async (req, res) => {
  try {
    const user = await User.findOne({ login: { $eq: req.user.login } }).select('login blocked active isDeleted').lean();
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ login: user.login, blocked: Boolean(user.blocked), active: Boolean(user.active), deleted: Boolean(user.isDeleted) });
  } catch (err) {
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// Foydalanuvchi ma'lumotlarini qaytarish (me). Obuna rejasi YO'Q — u OnDex'da.
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    let effectiveCategories = user.shopCategories || [];
    if (effectiveCategories.length === 0 && user.shopType) {
      const typeData = await ShopType.findOne({ value: user.shopType });
      if (typeData) effectiveCategories = typeData.categories;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        login: user.login,
        role: user.role,
        name: user.name,
        shopName: user.shopName,
        shopType: user.shopType,
        storeCategory: user.ondexStoreCategory || '',
        shopCategories: effectiveCategories,
        activeDevice: req.user.deviceId,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

// isAdmin, activateUser, blockUser, activeUsers, checkStatus, getShopTypes, addShopCategory
// OLIB TASHLANDI: admin va foydalanuvchi boshqaruvi faqat OnDex platform realmida (ADR-002).

module.exports = exports;
