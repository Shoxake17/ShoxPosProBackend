// middleware/verifyToken.js
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const TokenBlacklistService = require('../services/tokenBlacklistService');

/**
 * 🛡️ Autentifikatsiya Middleware
 * Faqat HttpOnly Cookielar bilan ishlaydi (XSS dan himoyalangan)
 */
module.exports = async function verifyToken(req, res, next) {
  try {
    // 1. Cookiedan tokenni olish
    // ShoxPosPro uchun: accessToken cookieda saqlangan
    const token = req.cookies ? req.cookies.accessToken : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Autentifikatsiya talab qilinadi. Iltimos, tizimga kiring.'
      });
    }

    // 2. Tokenni tekshirish (Verify)
    // Avval verify qilamiz, agar muddati o'tgan bo'lsa darhol catch blokiga o'tadi.
    // Bu bazaga (Blacklist) ortiqcha so'rov yuborishdan saqlaydi (Performance optimization).
    const decoded = jwt.verify(token, config.JWT_SECRET);

    // 3. Blacklist tekshirish
    // Agarda foydalanuvchi Logout qilgan bo'lsa, token bazada bloklangan bo'ladi.
    const isBlacklisted = await TokenBlacklistService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(403).json({
        success: false,
        message: 'Sessiya muddati bekor qilingan. Qayta kiring.'
      });
    }

    // 3a. ShoxPos'da admin roli YO'Q (admin — faqat OnDex platform realmida).
    // Ochiq qolgan eski admin sessiyasi ham shu yerda to'xtaydi: aks holda
    // marshrutlardagi `role === 'admin'` istisnolari begona do'kon ma'lumotini ochardi.
    if (decoded.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: "Bu hisob uchun kirish yopilgan. OnDex administratsiyasiga murojaat qiling."
      });
    }

    // 4. Foydalanuvchi ma'lumotlarini request obyektiga biriktirish
    // Faqat kerakli (biznes mantiq uchun lozim bo'lgan) fieldlarni qo'shamiz
    req.user = {
      id: decoded.id || decoded._id, // MongoDB _id yoki JWT id fallback
      login: decoded.login,
      role: decoded.role,
      deviceId: decoded.deviceId || null
    };

    // 5. Keyingi middleware yoki controllerga o'tish
    next();

  } catch (err) {
    // Xavfsizlik uchun loglarda faqat xato nomi chiqadi, token o'zi emas
    console.error(`🛡️ [AuthError]: ${err.name}`);

    // Muddati tugagan token
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Sessiya muddati tugadi. Iltimos, qayta kiring.',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Noto'g'ri yoki buzilgan token
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Autentifikatsiya xatosi. Token yaroqsiz.'
      });
    }

    // Boshqa kutilmagan server xatolari
    return res.status(500).json({
      success: false,
      message: 'Ichki server xatosi'
    });
  }
};