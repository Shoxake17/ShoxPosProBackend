// middleware/verifyToken.js

const jwt = require('jsonwebtoken');
const config = require('../config');
const TokenBlacklistService = require('../services/tokenBlacklistService');

module.exports = async function verifyToken(req, res, next) {
  try {
    // 🍪 Cookie'dan token olish (ASOSIY USUL)
    let token = req.cookies.accessToken;

    // Fallback: Header'dan ham tekshirish (agar API client ishlatsa)
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'Token topilmadi. Autentifikatsiya talab qilinadi' 
      });
    }

    // Blacklist tekshirish
    const isBlacklisted = await TokenBlacklistService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(403).json({ 
        success: false,
        message: 'Token bloklangan. Qayta kirish talab qilinadi' 
      });
    }

    // Token verify
    const decoded = jwt.verify(token, config.JWT_SECRET || process.env.JWT_SECRET);

    req.user = {
      id: decoded.id || decoded._id,
      login: decoded.login,
      role: decoded.role,
      iat: decoded.iat,
      exp: decoded.exp
    };

    if (decoded.deviceId) {
      req.deviceId = decoded.deviceId;
    }

    next();
  } catch (err) {
    console.error('❌ Token verify xatosi:', err.message);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token muddati tugagan',
        expiredAt: err.expiredAt
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        success: false,
        message: 'Noto\'g\'ri token formati'
      });
    }

    return res.status(500).json({ 
      success: false,
      message: 'Token tekshirishda xato'
    });
  }
};