// routes/ondexAuth.js
'use strict';

/**
 * ShoxPos'ga kirish — FAQAT OnDex akkaunti orqali (ShoxPos'ning o'z
 * login/parol/2FA tizimi YO'Q).
 *
 *   POST /api/auth/ondex/telegram-start  { phone }                    -> { deepLink }
 *   POST /api/auth/ondex/verify          { phone, code, deviceId... } -> sessiya
 *   POST /api/auth/ondex/password        { phone, password, deviceId... } -> sessiya
 *
 * Telefon, Telegram kodi va parolni OnDex API tekshiradi (`services/ondexSso`).
 * ShoxPos faqat OnDex tasdiqlagan kimlikni o'z do'kon hisobiga moslaydi va
 * o'z sessiya cookie'larini beradi. Flutter ilovasi ham shu OnDex akkaunti
 * bilan kiradi, shuning uchun bir akkaunt — bir xil ma'lumot.
 *
 * ┌─ XAVFSIZLIK ────────────────────────────────────────────────────────┐
 *  * Brauzer OnDex tokenini HECH QACHON ko'rmaydi: u server ichida
 *    kimlikka almashtiriladi va tashlab yuboriladi.
 *  * Noto'g'ri raqam / kod / parol bir xil javob beradi (raqam mavjudligi
 *    sezilmaydi); OnDex'ning o'z cheklovlari (`429`) ham `rate` bo'lib o'tadi.
 *  * Mijozning HAQIQIY IP'si OnDex'ga uzatiladi (aks holda hamma foydalanuvchi
 *    bitta IP bo'lib, bir kishi hammani bloklab qo'yardi).
 *  * Do'kon hisobi avtomatik FAQAT OnDex'da superadmin yaratgan hamkor
 *    akkaunti (restoran/do'kon) uchun ochiladi. OnDex'da akkaunti bor
 *    har qanday odam kassa ocha olmaydi (`not_linked`).
 *  * POST + CSRF himoyasi, IP bo'yicha qo'shimcha tezlik chegarasi.
 * └─────────────────────────────────────────────────────────────────────┘
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const User = require('../models/User');
const authController = require('../controllers/authController');
const ondexSso = require('../services/ondexSso');
const { partnerProfile, syncPartnerProfile } = require('../services/partnerProfile');

const fail = (res, status, code, message) =>
  res.status(status).json({ success: false, code, message });

const MESSAGES = {
  invalid: "Raqam, kod yoki parol noto'g'ri",
  rate: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring",
  unavailable: "OnDex bilan bog'lanib bo'lmadi. Birozdan so'ng urinib ko'ring",
  sso_off: 'OnDex orqali kirish sozlanmagan. Administrator bilan bog\'laning',
  not_linked: "Bu OnDex raqami uchun do'kon hisobi ochilmagan. OnDex administratsiyasiga murojaat qiling",
  blocked: 'Hisob bloklangan',
  deleted: "Bu hisob o'chirilgan",
};

// Kirish oqimi uchun IP bo'yicha qo'shimcha chegara (umumiy /api chegarasidan tashqari).
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => fail(res, 429, 'rate', MESSAGES.rate),
});

/** Qurilma yorlig'i: qisqa, xavfsiz belgilar; aks holda 'unknown'. */
function cleanLabel(v) {
  const s = String(v || '').trim();
  return /^[\w .\-()/]{1,64}$/.test(s) ? s : 'unknown';
}

/** Telefon: faqat O'zbekiston raqami (998 + 9 raqam), aks holda null. */
function parsePhone(v) {
  const p = ondexSso.normalizePhone(v);
  return /^998\d{9}$/.test(p) ? p : null;
}

/**
 * OnDex kimligiga mos ShoxPos hisobini topadi.
 *  1) `ondexUserId` bo'yicha (doimiy bog'lanish);
 *  2) admin kiritgan telefon bo'yicha, hali bog'lanmagan hisob (bir martalik ulash);
 *  3) OnDex'da do'kon/restoran akkaunti (superadmin yaratgan) — hisob avtomatik ochiladi;
 *  4) birinchi admin (`BOOTSTRAP_ADMIN_PHONE`) — faqat admin umuman yo'q bo'lsa.
 */
async function resolveUser(identity) {
  const phone = ondexSso.normalizePhone(identity.phone);

  let user = await User.findOne({ ondexUserId: identity.userId });
  if (user) return user;

  // Atomik ulash: ikki parallel so'rov bitta hisobni ikki marta ulay olmaydi.
  user = await User.findOneAndUpdate(
    { ondexPhone: phone, ondexUserId: { $exists: false } },
    { $set: { ondexUserId: identity.userId } },
    { new: true }
  );
  if (user) return user;

  // OnDex superadmini ro'yxatdan o'tkazgan do'kon/restoran egasi: hisob
  // birinchi kirishda AVTOMATIK ochiladi. Bu xavfsiz, chunki OnDex'da
  // bunday akkauntni faqat superadmin yaratadi (o'zi ro'yxatdan
  // o'tolmaydi) — oddiy foydalanuvchida `partnerRole` bo'sh keladi.
  if (identity.partnerRole && identity.entityId) {
    // 3a) Do'kon OnDex'da O'CHIRILIB shu raqam bilan QAYTA yaratilgan: ShoxPos
    //     yozuvi eski OnDex ID'siga bog'langan (login = telefon, ma'lumotlar shu
    //     bo'yicha). Yozuvni yangi akkauntga o'tkazamiz, lekin FAQAT:
    //       * yozuv ham hamkor yozuvi bo'lsa (qo'lda ochilgan / admin hisobiga tegmaymiz);
    //       * eski OnDex akkaunti HAQIQATAN yo'q bo'lsa (`invalid`). U hali tirik
    //         bo'lsa — raqam boshqa odamga o'tgan bo'lishi mumkin, ulamaymiz.
    const stale = await User.findOne({
      login: phone,
      ondexPartnerRole: { $in: ['store', 'restaurant'] },
      ondexUserId: { $exists: true, $ne: identity.userId },
    });
    if (stale) {
      let oldGone = false;
      try {
        await ondexSso.identityByUserId(stale.ondexUserId);
      } catch (err) {
        oldGone = Boolean(err && err.kind === 'invalid');
      }
      if (!oldGone) return null;
      stale.ondexUserId = identity.userId;
      stale.ondexPhone = phone;
      stale.ondexPartnerRole = identity.partnerRole;
      stale.ondexEntityId = identity.entityId;
      stale.shopName = identity.entityName || identity.name || stale.shopName;
      if (identity.name) stale.name = identity.name;
      return stale; // kategoriya/shopType `syncPartnerProfile` da (kirishdan keyin saqlanadi)
    }

    const trial = new Date();
    trial.setDate(trial.getDate() + 7);
    try {
      return await User.create({
        login: phone,
        role: 'cashier',
        ondexUserId: identity.userId,
        ondexPhone: phone,
        ondexPartnerRole: identity.partnerRole,
        ondexEntityId: identity.entityId,
        ...partnerProfile(identity),
        name: identity.name || undefined,
        shopName: identity.entityName || identity.name || 'OnDex Merchant',
        subscription: { plan: 'pro', trialEndDate: trial, isTrial: true, startDate: new Date() },
      });
    } catch (err) {
      // Parallel ikki kirish: ikkinchisi E11000 oladi — mavjud hisobni olamiz.
      if (err && err.code === 11000) {
        return User.findOne({ ondexUserId: identity.userId });
      }
      throw err;
    }
  }

  const bootstrap = ondexSso.normalizePhone(config.BOOTSTRAP_ADMIN_PHONE);
  if (bootstrap && bootstrap === phone && !(await User.exists({ role: 'admin' }))) {
    return User.create({
      login: phone,
      role: 'admin',
      ondexUserId: identity.userId,
      ondexPhone: phone,
      name: identity.name || 'Admin',
      shopName: 'OnDex Merchant',
    });
  }
  return null;
}

/** OnDex xatosini (kind) HTTP javobiga aylantiradi. */
function sendOndexError(res, err, where) {
  const kind = err && err.kind;
  // 401 EMAS: frontend (`axiosInstance`) 401 ni "sessiya tugadi" deb tushunib,
  // yangilashga urinadi va sahifani qayta yuklaydi — xato xabari yo'qolardi.
  if (kind === 'invalid') return fail(res, 400, 'invalid', MESSAGES.invalid);
  if (kind === 'rate') return fail(res, 429, 'rate', MESSAGES.rate);
  // misconfig/unavailable — server tomoni muammosi; tafsilot FAQAT logda.
  console.error(`⚠️ [OnDex auth] ${where}: ${err && err.message}`);
  return fail(res, 503, 'unavailable', MESSAGES.unavailable);
}

/** OnDex tokenidan kimlik olib, ShoxPos sessiyasini ochadi. */
async function finishLogin(req, res, ondexToken, device) {
  const identity = await ondexSso.identityFromToken(ondexToken, req.ip);

  const user = await resolveUser(identity);
  if (!user) return fail(res, 403, 'not_linked', MESSAGES.not_linked);
  if (user.isDeleted) return fail(res, 403, 'deleted', MESSAGES.deleted);
  if (user.blocked) return fail(res, 403, 'blocked', MESSAGES.blocked);
  if (!user.name && identity.name) user.name = identity.name;
  syncPartnerProfile(user, identity);

  const info = await authController.establishSession(req, res, user, device);
  return res.json({ success: true, user: info });
}

module.exports = (csrfProtection) => {
  const router = express.Router();

  // Barcha so'rovlar uchun umumiy tekshiruvlar (sozlama, qurilma).
  const guard = (req, res, next) => {
    if (!ondexSso.isConfigured()) return fail(res, 503, 'sso_off', MESSAGES.sso_off);
    next();
  };

  const parseDevice = (body) => {
    const deviceId = String(body.deviceId || '');
    if (!/^[a-zA-Z0-9\-_:]{1,128}$/.test(deviceId)) return null;
    return { deviceId, deviceType: cleanLabel(body.deviceType), deviceOS: cleanLabel(body.deviceOS) };
  };

  router.post('/auth/ondex/telegram-start', authLimiter, csrfProtection, guard, async (req, res) => {
    const phone = parsePhone(req.body && req.body.phone);
    if (!phone) return fail(res, 400, 'phone', "Telefon raqami noto'g'ri (+998 XX XXX XX XX)");
    try {
      const deepLink = await ondexSso.startTelegram(phone, req.ip);
      return res.json({ success: true, deepLink });
    } catch (err) {
      return sendOndexError(res, err, 'telegram-start');
    }
  });

  router.post('/auth/ondex/verify', authLimiter, csrfProtection, guard, async (req, res) => {
    const body = req.body || {};
    const phone = parsePhone(body.phone);
    const code = String(body.code || '').trim();
    const device = parseDevice(body);
    if (!phone || !/^\d{4,8}$/.test(code)) return fail(res, 400, 'invalid', MESSAGES.invalid);
    if (!device) return fail(res, 400, 'device', 'Qurilma identifikatori aniqlanmadi');
    try {
      const token = await ondexSso.verifyCode(phone, code, req.ip);
      return await finishLogin(req, res, token, device);
    } catch (err) {
      return sendOndexError(res, err, 'verify');
    }
  });

  router.post('/auth/ondex/password', authLimiter, csrfProtection, guard, async (req, res) => {
    const body = req.body || {};
    const phone = parsePhone(body.phone);
    const password = typeof body.password === 'string' ? body.password : '';
    const device = parseDevice(body);
    if (!phone || !password || password.length > 128) return fail(res, 400, 'invalid', MESSAGES.invalid);
    if (!device) return fail(res, 400, 'device', 'Qurilma identifikatori aniqlanmadi');
    try {
      const token = await ondexSso.passwordLogin(phone, password, req.ip);
      return await finishLogin(req, res, token, device);
    } catch (err) {
      return sendOndexError(res, err, 'password');
    }
  });

  return router;
};
