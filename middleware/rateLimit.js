const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 daqiqa (kommentariya to'g'rilandi)
  max: 5, // 1 daqiqada 5 ta urinish
  handler: (req, res, next, options) => {
    // Qolgan vaqtni hisoblash (millisekunddan sekundga o'tkazamiz)
    const timeLeft = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    
    res.status(options.statusCode).json({
      success: false,
      message: `Juda ko‘p urinish! Iltimos, yana ${timeLeft} soniya kuting.`,
      retryAfter: timeLeft
    });
  },
  standardHeaders: true, 
  legacyHeaders: false,
});

module.exports = loginLimiter;