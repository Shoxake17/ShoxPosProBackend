// controllers/authController.js
'use strict';

/**
 * Merchant web sessiyasi — A4c.4 dan boshlab FAQAT OnDex markazi orqali.
 *
 * OLIB TASHLANDI: ShoxPos'ning o'z JWT'lari (createTokens/refresh/
 * establishSession), qurilmalar ro'yxati va token qora ro'yxati. Kirish —
 * `routes/oidcAuth.js` (OIDC), sessiya — `services/bffSession.js`.
 * "Qurilmalar" endi OnDex markaziy sessiyalari (`/v2/auth/sessions`):
 * bir joyda — ilova, panel, web hammasi ko'rinadi va yopiladi.
 */

const User = require('../models/User');
const ShopType = require('../models/ShopType');
const bff = require('../services/bffSession');
const oidc = require('../services/oidcClient');

function sanitizeSessionId(value) {
  if (!value || typeof value !== 'string') return null;
  return /^[A-Za-z0-9_\-:]{1,128}$/.test(value) ? value : null;
}

async function effectiveCategories(user) {
  let cats = (user && user.shopCategories) || [];
  if (cats.length === 0 && user && user.shopType) {
    const typeData = await ShopType.findOne({ value: user.shopType });
    if (typeData) cats = typeData.categories;
  }
  return cats;
}

const CLIENT_LABEL = {
  'merchant-web': 'web', 'merchant-desktop': 'desktop', 'ondex-pro': 'OnDexPro', 'ondex-go': 'OnDexGO',
  'ondex-sso': 'OnDex kirish (brauzer)',
};

/** Qurilma ko'rinishi (frontend avvalgi formatni kutadi). */
function toDevice(s, currentSid) {
  return {
    deviceId: s.id,
    deviceType: CLIENT_LABEL[s.client_id] || s.client_id || 'unknown',
    deviceOS: s.device_name || s.user_agent || 'unknown',
    lastLogin: s.last_used_at || s.created_at,
    createdAt: s.created_at,
    isActive: true,
    current: s.id === currentSid,
  };
}

// GET /api/user-devices — OnDex'dagi barcha faol sessiyalar.
exports.getUserDevices = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const data = await oidc.listSessions(bff.accessToken(req._bff));
    const list = Array.isArray(data) ? data : (data.sessions || []);
    return res.json({ success: true, devices: list.map((s) => toDevice(s, req.user.deviceId)) });
  } catch (e) {
    console.error(`⚠️ [devices] ${e && e.message}`);
    return res.status(503).json({ success: false, message: "Qurilmalar ro'yxatini OnDex'dan olib bo'lmadi" });
  }
};

// POST /api/kick-device — markazda yopiladi; ShoxPos tomoni back-channel orqali.
exports.kickDevice = async (req, res) => {
  const id = sanitizeSessionId(req.body && req.body.deviceId);
  if (!id) return res.status(400).json({ success: false, message: "Qurilma identifikatori noto'g'ri" });
  if (id === req.user.deviceId) {
    return res.status(400).json({ success: false, message: "O'z qurilmangizni bu yerdan o'chira olmaysiz — Chiqish tugmasidan foydalaning" });
  }
  try {
    await oidc.deleteSession(bff.accessToken(req._bff), id);
    return res.json({ success: true, message: 'Qurilma muvaffaqiyatli chiqarildi' });
  } catch (e) {
    if (e && e.kind === 'not_found') return res.status(404).json({ success: false, message: 'Sessiya topilmadi' });
    return res.status(503).json({ success: false, message: "OnDex bilan bog'lanib bo'lmadi" });
  }
};

// Foydalanuvchi holati — FAQAT o'zi (login sessiyadan).
exports.userStatus = async (req, res) => {
  try {
    const user = await User.findOne({ login: { $eq: req.user.login } }).select('login blocked isDeleted').lean();
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ login: user.login, blocked: Boolean(user.blocked), deleted: Boolean(user.isDeleted) });
  } catch {
    res.status(500).json({ error: 'Server xatosi' });
  }
};

// GET /api/me. Obuna rejasi YO'Q — u OnDex'da.
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    res.status(200).json({
      success: true,
      user: {
        id: user._id, login: user.login, name: user.name,
        shopName: user.shopName, shopType: user.shopType,
        storeCategory: user.ondexStoreCategory || '',
        shopCategories: await effectiveCategories(user),
        activeDevice: req.user.deviceId,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
};

exports.effectiveCategories = effectiveCategories;

module.exports = exports;
