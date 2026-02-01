const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 15 daqiqa
  max: 5, // Har 15 daqiqada 5 ta urinish
  message: {
    message: "❌ Juda ko‘p urinish! Iltimos, biroz kuting va qayta urinib ko‘ring."
  },
  standardHeaders: true, // Rate limit ma'lumotlarini headerda yuboradi
  legacyHeaders: false,  // X-RateLimit-* headerlarni o‘chiradi
});

module.exports = loginLimiter;