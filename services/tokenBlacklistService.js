// services/tokenBlacklistService.js

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// ====================================
// 📦 SCHEMA
// ====================================
const blacklistedTokenSchema = new mongoose.Schema({
  token: { 
    type: String, 
    required: true, 
    unique: true,
    index: true  // Tezkor qidirish uchun
  },
  login: {
    type: String,
    default: null  // Kim tomonidan blacklistga qo'shilgani
  },
  deviceId: {
    type: String,
    default: null  // Qaysi qurilma
  },
  reason: {
    type: String,
    default: 'logout'  // 'logout' | 'kicked' | 'blocked'
  },
  blacklistedAt: { 
    type: Date, 
    default: Date.now 
  },
  expiresAt: { 
    type: Date, 
    required: true 
  }
});

// ✅ TTL Index — token muddati tugagach MongoDB avtomatik o'chiradi
blacklistedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const BlacklistedToken = mongoose.model('BlacklistedToken', blacklistedTokenSchema);

// ====================================
// ⛔ Tokenni blacklistga qo'shish
// ====================================
exports.add = async (token, options = {}) => {
  try {
    if (!token) {
      console.warn('⚠️ Blacklist: Token bo\'sh, qo\'shilmadi');
      return false;
    }

    // Token decode qilib expiresAt ni olamiz
    const decoded = jwt.decode(token);
    if (!decoded) {
      console.warn('⚠️ Blacklist: Token decode qilinmadi');
      return false;
    }

    // Token allaqachon muddati o'tgan bo'lsa — blacklistga qo'shishning hojati yo'q
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      console.log('ℹ️ Token allaqachon muddati o\'tgan, blacklist kerak emas');
      return true;
    }

    const expiresAt = decoded.exp 
      ? new Date(decoded.exp * 1000) 
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // default 24 soat

    // ✅ Allaqachon borligini tekshirish (unique xatosini oldini olish)
    const existing = await BlacklistedToken.findOne({ token });
    if (existing) {
      console.log('ℹ️ Token allaqachon blacklistda bor');
      return true;
    }

    await BlacklistedToken.create({
      token,
      login: options.login || null,
      deviceId: options.deviceId || null,
      reason: options.reason || 'logout',
      expiresAt
    });

    console.log(`⛔ Token blacklistga qo'shildi | login: ${options.login || '?'} | reason: ${options.reason || 'logout'}`);
    return true;

  } catch (err) {
    // Duplicate key xatosi — allaqachon bor, muammo emas
    if (err.code === 11000) {
      console.log('ℹ️ Token allaqachon blacklistda (duplicate)');
      return true;
    }
    console.error('❌ Blacklist add xatosi:', err.message);
    return false;
  }
};

// ====================================
// 🔍 Token blacklistda borligini tekshirish
// ====================================
exports.isBlacklisted = async (token) => {
  try {
    if (!token) return false;

    const found = await BlacklistedToken.findOne({ token }).lean();
    return !!found;

  } catch (err) {
    console.error('❌ Blacklist check xatosi:', err.message);
    // Xato bo'lsa — ehtiyot uchun true qaytaramiz (bloklaymiz)
    return false;
  }
};

// ====================================
// 🗑️ Tokenni blacklistdan olib tashlash (kerak bo'lsa)
// ====================================
exports.remove = async (token) => {
  try {
    const result = await BlacklistedToken.deleteOne({ token });
    return result.deletedCount > 0;
  } catch (err) {
    console.error('❌ Blacklist remove xatosi:', err.message);
    return false;
  }
};

// ====================================
// 📊 Login bo'yicha barcha tokenlarni blacklistga qo'shish
// (Masalan: foydalanuvchi blocklanganda barcha sessiyalarini o'chirish)
// ====================================
exports.addAllByLogin = async (tokens = [], login, reason = 'blocked') => {
  try {
    if (!tokens.length) return false;

    const results = await Promise.allSettled(
      tokens.map(token => exports.add(token, { login, reason }))
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`⛔ ${login} uchun ${successCount}/${tokens.length} token blacklistga qo'shildi`);
    return true;

  } catch (err) {
    console.error('❌ addAllByLogin xatosi:', err.message);
    return false;
  }
};

// ====================================
// 🧹 Muddati o'tgan tokenlarni qo'lda tozalash
// (MongoDB TTL avtomatik qiladi, lekin manual tozalash uchun)
// ====================================
exports.cleanup = async () => {
  try {
    const result = await BlacklistedToken.deleteMany({ 
      expiresAt: { $lt: new Date() } 
    });
    console.log(`🧹 ${result.deletedCount} ta muddati o'tgan token o'chirildi`);
    return result.deletedCount;
  } catch (err) {
    console.error('❌ Cleanup xatosi:', err.message);
    return 0;
  }
};