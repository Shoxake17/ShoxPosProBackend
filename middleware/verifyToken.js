// middleware/verifyToken.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const TokenBlacklistService = require('../services/tokenBlacklistService');

module.exports = async function verifyToken(req, res, next) {
  try {
    // Faqat HttpOnly cookie — header fallback yo'q
    const token = req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Autentifikatsiya talab qilinadi'
      });
    }

    // Blacklist tekshirish — 403 qaytaradi (401 emas!)
    const isBlacklisted = await TokenBlacklistService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(403).json({
        success: false,
        message: 'Kirish taqiqlangan'
      });
    }

    // Token verify — faqat config dan (|| process.env yo'q)
    const decoded = jwt.verify(token, config.JWT_SECRET);

    req.user = {
      id:       decoded.id || decoded._id,
      login:    decoded.login,
      role:     decoded.role,
      deviceId: decoded.deviceId || null,
    };
    // iat, exp — req.user ga qo'shilmaydi (keraksiz info)

    next();

  } catch (err) {
    // console.error ga minimal log — token o'zi chiqmasin
    console.error('Token verify xatosi:', err.name);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token muddati tugagan'
        // expiredAt — o'chirildi
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        // 403 emas 401 — invalid token ham auth xatosi
        success: false,
        message: 'Autentifikatsiya talab qilinadi'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Ichki server xatosi'
    });
  }
};