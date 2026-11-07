'use strict';

/**
 * /api/users — FAQAT o'z profili (OnDex Merchant web).
 *
 * ┌─ XAVFSIZLIK TUZATISHI ────────────────────────────────────────────────┐
 * Avval bu yerda egalik TEKSHIRILMASDI: istalgan kirgan foydalanuvchi
 * `/block` bilan istalgan do'konni bloklab chiqarib yubora olardi, `/active`
 * barcha foydalanuvchilarning to'liq yozuvini qaytarardi, `/status` va
 * `/profile?login=` begona akkauntni ochardi, `PUT /profile` esa loginni
 * so'rov tanasidan olib BEGONA profilni o'zgartirardi.
 *
 * Endi login FAQAT tokendan (`req.user.login`). Bloklash/aktivlashtirish,
 * foydalanuvchilar ro'yxati va qurilma tasdig'i OnDex identity'ga o'tdi.
 * └───────────────────────────────────────────────────────────────────────┘
 */

const express = require('express');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const User = require('../models/User');
const config = require('../config');

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
});

const MAX_NAME = 50;

const upload = multer({
  storage: new CloudinaryStorage({
    cloudinary,
    params: async (req) => ({
      folder: 'shoxpospro_avatars',
      allowed_formats: ['jpg', 'png', 'jpeg'],
      public_id: `avatar_${req.user.login}_${Date.now()}`,
      transformation: [{ width: 250, height: 250, crop: 'fill' }],
    }),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
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
    } catch (err) {
      res.status(500).json({ error: 'Server xatosi' });
    }
  });

  /** PUT /api/users/profile — o'z profilini tahrirlash (ism, telefon, avatar). */
  router.put('/profile', (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) {
        console.error('Profil rasmi yuklanmadi:', err.message);
        return res.status(400).json({ error: 'Rasm yuklashda xato' });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login });
      if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

      const firstName = cleanText(req.body.firstName);
      const lastName = cleanText(req.body.lastName);
      const phoneNumber = cleanText(req.body.phoneNumber);
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (phoneNumber) user.phoneNumber = phoneNumber;
      if (req.file) user.avatarUrl = req.file.path;

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
