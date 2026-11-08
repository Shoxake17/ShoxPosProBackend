'use strict';

/**
 * /api/users — FAQAT o'z profili (OnDex Merchant web).
 *
 * ┌─ XAVFSIZLIK ──────────────────────────────────────────────────────────┐
 * Login FAQAT sessiyadan (`req.user.login`) — so'rov tanasidagi login'ga
 * ishonilmaydi (avval begona profilni o'zgartirish mumkin edi).
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ PROFIL RASMI — OnDex'DA (Cloudinary OLIB TASHLANDI) ─────────────────┐
 * Rasm OnDex akkauntiga tegishli (R2, markazlashgan): bu yerda faqat
 * xotirada qabul qilinib, foydalanuvchining o'z OnDex tokeni bilan
 * `PUT /v2/me/avatar` ga uzatiladi. OnDex uni qayta kodlaydi (WebP, EXIF
 * o'chadi). Qaytgan manzil `avatarUrl` da ko'rsatish uchun saqlanadi; asl
 * qiymat — OIDC `picture` (har kirish/refresh'da yangilanadi).
 * └───────────────────────────────────────────────────────────────────────┘
 */

const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const bff = require('../services/bffSession');
const oidc = require('../services/oidcClient');

const MAX_NAME = 50;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 10 },
  // Noto'g'ri tur — XATO (jim tashlab yuborilsa foydalanuvchi 'saqlandi' deb o'ylardi).
  fileFilter: (req, file, cb) => (IMAGE_TYPES.includes(file.mimetype)
    ? cb(null, true) : cb(Object.assign(new Error('type'), { code: 'BAD_TYPE' }))),
});

function cleanText(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= MAX_NAME ? s : undefined;
}

// `io` parametri chaqiruvchi (server.js) imzosini saqlash uchun qoldirildi.
module.exports = () => {
  const router = express.Router();

  /** GET /api/users/profile — o'z profili. */
  router.get('/profile', async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login }, 'login firstName lastName phoneNumber avatarUrl');
      if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
      res.json(user);
    } catch {
      res.status(500).json({ error: 'Server xatosi' });
    }
  });

  /** PUT /api/users/profile — o'z profilini tahrirlash (ism, telefon, rasm -> OnDex). */
  router.put('/profile', (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Rasm 2 MB dan katta'
          : err.code === 'BAD_TYPE' ? 'Faqat jpg, png yoki webp rasm' : 'Rasm yuklashda xato';
        return res.status(400).json({ error: msg });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login });
      if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

      if (req.file) {
        try {
          user.avatarUrl = await oidc.uploadAvatar(bff.accessToken(req._bff), {
            buffer: req.file.buffer, filename: req.file.originalname, mimetype: req.file.mimetype });
        } catch (e) {
          if (e && e.kind === 'bad_image') return res.status(400).json({ error: 'Fayl haqiqiy rasm emas yoki buzilgan' });
          if (e && e.kind === 'rate') return res.status(429).json({ error: "Juda ko'p yuklash — biroz kuting" });
          console.error(`⚠️ [avatar] ${e && e.message}`);
          return res.status(503).json({ error: "Rasmni OnDex'ga yuklab bo'lmadi. Birozdan so'ng urinib ko'ring" });
        }
      }
      const firstName = cleanText(req.body.firstName);
      const lastName = cleanText(req.body.lastName);
      const phoneNumber = cleanText(req.body.phoneNumber);
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (phoneNumber) user.phoneNumber = phoneNumber;

      await user.save();
      res.json({
        message: 'Profil muvaffaqiyatli yangilandi',
        user: {
          login: user.login,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (err) {
      console.error('Profilni yangilashda xato:', err.message);
      res.status(500).json({ error: 'Server xatosi' });
    }
  });

  return router;
};
