/**
 * Global API rate limiter — DoS/DDoS hujumlarining oldini olish.
 * /api/* uchun so'rovlar sonini IP bo'yicha cheklaydi.
 */
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 daqiqa
  max: 1000,                 // IP uchun 1 daqiqada maksimum 1000 so'rov
  message: {
    success: false,
    message: "Juda ko'p so'rov. Iltimos, biroz kuting."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.originalUrl === '/api/csrf-token' || req.originalUrl === '/api/health'
});

module.exports = apiLimiter;
