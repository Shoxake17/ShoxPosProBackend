// services/tokenBlacklistService.js

const blacklist = new Set();

// 🔴 Tokenni blacklistga qo‘shish
exports.add = async (token) => {
  blacklist.add(token);
  console.log(`⛔ Token blacklistga qo‘shildi: ${token}`);
};

// 🔍 Token blacklistda borligini tekshirilsinmi?
exports.isBlacklisted = async (token) => {
  return blacklist.has(token);
};