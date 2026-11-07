// services/storeAccess.js
'use strict';

/**
 * Do'kon KATEGORIYASI bo'yicha kirish huquqi.
 *
 * Kategoriyani OnDex belgilaydi (admin panelda do'kon yaratganda): `qurt`,
 * `store`, `pharmacy`. ShoxPos uni faqat o'qiydi va ikki qatlamda qo'llaydi:
 *   1) BACKEND (shu fayl): cheklangan kategoriya uchun ruxsat etilmagan API
 *      yo'llari 403 qaytaradi — frontend'dagi yashirish aylanib o'tilsa ham
 *      (URL'ni qo'lda yozish, so'rovni to'g'ridan yuborish) ishlamaydi;
 *   2) FRONTEND (`src/utils/storeAccess.ts`): menyu va sahifalar yashiriladi.
 * Ikkala ro'yxat BIR XIL bo'lishi shart.
 *
 * Kategoriya JWT'dagi `sc` da turadi (imzolangan, o'zgartirib bo'lmaydi) va
 * har kirishda OnDex'dan yangilanadi.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

const CATEGORIES = ['qurt', 'store', 'pharmacy'];

/** Kategoriya -> ShoxPos `shopType` (dorixona menyusi `dorixona` ga bog'langan). */
const SHOP_TYPE = { qurt: 'qurt', store: 'dokon', pharmacy: 'dorixona' };

function shopTypeFor(category) {
  return SHOP_TYPE[category] || '';
}

/**
 * QURT: faqat mahsulot qo'shish/bazasi, sotuvlar, kirim bazasi, savdo
 * statistikasi, qarzlar va sozlamalar. Ro'yxat `/api` dan keyingi yo'l uchun.
 * Ro'yxatda YO'Q yo'l — rad etiladi (yangi marshrut qo'shilsa ham ochilmaydi).
 */
const QURT_ALLOW = [
  // Sessiya va hisob (kirish, chiqish, qurilmalar, profil, sozlamalar)
  /^\/csrf-token$/, /^\/refresh$/, /^\/logout$/, /^\/verify-session$/, /^\/me$/,
  /^\/user-status$/, /^\/user-devices$/, /^\/kick-device$/, /^\/health$/,
  /^\/users\/profile$/, /^\/push(\/|$)/,
  // Mahsulot qo'shish, mahsulotlar bazasi, kirim bazasi
  /^\/products(\/|$)/,
  // Qurt buyurtmalari (OnDex'dan keladi; webhook ham shu yo'lda)
  /^\/store-orders(\/|$)/,
  /^\/qurt-orders\/webhook$/, // OnDex imzolangan webhook'i: tashqi shartnoma, manzili o'zgarmaydi
  /^\/store-couriers(\/|$)/,
  /^\/store-assign$/,
  // Sotuvlar, savdo statistikasi
  /^\/sales(\/|$)/, /^\/sold-buckets(\/|$)/,
  // Qarzlar
  /^\/debts(\/|$)/,
];

/** Ruxsat etilgan ro'yxat ichida ham YOPIQ qoladigan yo'llar. */
const QURT_DENY = [];

/** Eskirgan (kategoriyasiz) token bilan ham ochiq: yangilash, chiqish, kirish. */
const OUTDATED_EXEMPT = /^\/(refresh|logout|csrf-token|auth\/.*)$/;

const POLICIES = {
  qurt: { allow: QURT_ALLOW, deny: QURT_DENY },
};

/** `category` uchun `path` (`/api` siz, so'rov satrisiz) ruxsat etilganmi. */
function isAllowed(category, path) {
  const policy = POLICIES[category];
  if (!policy) return true; // cheklanmagan kategoriya
  if (policy.deny.some((rx) => rx.test(path))) return false;
  return policy.allow.some((rx) => rx.test(path));
}

/**
 * `/api` ostida global qo'riqchi. Tokenni o'zi o'qiydi (marshrutlar
 * `verifyToken` ni alohida ishlatadi): tokensiz/yaroqsiz so'rovga tegmaydi —
 * uni keyingi middleware 401 bilan rad etadi.
 */
function storeCategoryGuard(req, res, next) {
  const token = req.cookies ? req.cookies.accessToken : null;
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return next();
  }

  // sc YO'Q (kategoriya joriy etilishidan oldingi token): kategoriyasi noma'lum,
  // shuning uchun o'tkazilmaydi. 401 — frontend tokenni yangilaydi (refresh
  // kategoriyani OnDex'dan oladi) va so'rovni qaytaradi; bo'sh sc ("") — cheklanmagan.
  // `/refresh`, `/logout`, `/csrf-token` va kirish yo'llari ISTISNO: aks holda
  // eski tokenli foydalanuvchi yangilana olmay, tizimdan chiqib ketardi.
  // Admin uchun istisno YO'Q: ShoxPos'da admin roli endi yo'q (admin — faqat OnDex platform realmi).
  if (decoded && decoded.sc === undefined && !OUTDATED_EXEMPT.test(req.path)) {
    return res.status(401).json({
      success: false,
      code: 'TOKEN_OUTDATED',
      message: 'Sessiyani yangilash kerak',
    });
  }

  const category = decoded && decoded.sc;
  if (!category || isAllowed(category, req.path)) return next();

  return res.status(403).json({
    success: false,
    code: 'CATEGORY_FORBIDDEN',
    message: "Bu bo'lim sizning do'kon turingiz uchun mavjud emas",
  });
}

module.exports = { CATEGORIES, shopTypeFor, isAllowed, storeCategoryGuard };
