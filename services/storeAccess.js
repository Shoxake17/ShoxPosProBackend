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
 * Kategoriya BFF sessiyasining `sc` maydonida turadi (serverda — mijoz
 * o'zgartira olmaydi) va har kirishda hamda har OnDex refresh'ida (≤10 daqiqa)
 * OnDex userinfo'dan yangilanadi (A4c.4).
 */

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
  /^\/csrf-token$/, /^\/auth\/oidc\/(login|callback|logout|backchannel)$/, /^\/verify-session$/, /^\/me$/,
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
 * `/api` ostida global qo'riqchi. Sessiyani `verifyToken.authenticate` bilan
 * o'qiydi (natija so'rovda keshlanadi — marshrut qayta hisoblamaydi).
 * Sessiyasiz so'rovga tegmaydi — uni keyingi middleware 401 bilan rad etadi.
 */
async function storeCategoryGuard(req, res, next) {
  let s = null;
  try {
    // Kechiktirilgan require: verifyToken -> partnerProfile -> storeAccess aylanmasi.
    s = await require('../middleware/verifyToken').authenticate(req);
  } catch {
    return next();
  }
  const category = s && s.sc;
  if (!category || isAllowed(category, req.path)) return next();

  return res.status(403).json({
    success: false,
    code: 'CATEGORY_FORBIDDEN',
    message: "Bu bo'lim sizning do'kon turingiz uchun mavjud emas",
  });
}
module.exports = { CATEGORIES, shopTypeFor, isAllowed, storeCategoryGuard };
