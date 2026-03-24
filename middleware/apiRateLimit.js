const rateLimit = require('express-rate-limit');

/**
 * Login va Auth amallari uchun qat'iy cheklov (Brute-force himoyasi)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: 300,                 // Login uchun 300 ta yetarli
  message: {
    success: false,
    message: "Juda ko'p login urinishi. Iltimos, 15 daqiqa kuting."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Umumiy API so'rovlari uchun yumshoqroq cheklov
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: 3000,                // Ma'lumotlar uchun 3000 ta so'rov
  message: {
    success: false,
    message: "Siz juda ko'p so'rov yubordingiz. Iltimos, biroz kuting."
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Muhim bo'lmagan yo'llarni cheklovdan chiqarish
  skip: (req) => req.originalUrl === '/api/csrf-token' || req.originalUrl === '/api/health'
});

// Ikkala limitter-ni ham eksport qilamiz
module.exports = { authLimiter, apiLimiter };