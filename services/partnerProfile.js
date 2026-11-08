// services/partnerProfile.js
'use strict';

/**
 * OnDex hamkor kimligidan (do'kon kategoriyasi) ShoxPos hisobi maydonlari.
 * Kirishda (`routes/oidcAuth.js`) VA OnDex refresh'ida (`middleware/verifyToken.js`)
 * ishlatiladi: admin OnDex'da
 * kategoriyani o'zgartirsa, foydalanuvchi qayta kirmasdan ham yangi
 * cheklov tokenni yangilaganda (qisqa muddatda) kuchga kiradi.
 */

const storeAccess = require('./storeAccess');

/**
 * Do'kon kategoriyasi va unga mos `shopType`. Faqat OnDex do'kon akkaunti
 * (`store`) uchun; restoran va boshqalar uchun bo'sh (cheklov yo'q).
 *
 * Kategoriya yo'q yoki noma'lum bo'lsa XATO (xavfsiz tomonga): jimgina to'liq
 * panel berilsa, qurt sotuvchisi cheklovdan chiqib ketardi. OnDex do'kon uchun
 * kategoriyani DOIM yuboradi, demak kelmasa — OnDex eski versiyada yoki javob buzilgan.
 */
function partnerProfile(identity) {
  if (identity.partnerRole !== 'store') return {};
  if (!storeAccess.CATEGORIES.includes(identity.storeCategory)) {
    throw Object.assign(new Error("OnDex do'kon kategoriyasini bermadi"), { kind: 'unavailable' });
  }
  const category = identity.storeCategory;
  return { ondexStoreCategory: category, shopType: storeAccess.shopTypeFor(category) };
}

/**
 * OnDex'dagi kategoriyani mavjud hisobga ko'chiradi (saqlash chaqiruvchining
 * `user.save()` i orqali). O'zgargan bo'lsa `true`.
 */
function syncPartnerProfile(user, identity) {
  const p = partnerProfile(identity);
  if (p.ondexStoreCategory && user.ondexStoreCategory !== p.ondexStoreCategory) {
    user.ondexStoreCategory = p.ondexStoreCategory;
    user.shopType = p.shopType;
    return true;
  }
  return false;
}

module.exports = { partnerProfile, syncPartnerProfile };
