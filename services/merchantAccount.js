// services/merchantAccount.js
'use strict';

/**
 * OnDex kimligi (OIDC userinfo) -> ShoxPos do'kon hisobi.
 *
 * Ilgari `routes/ondexAuth.js` ichida edi (parol proksisi bilan birga); A4c'da
 * proksi olib tashlandi, moslash mantiqi shu yerga ko'chdi va OIDC userinfo
 * formatini qabul qiladi.
 *
 * Kimlik manbalari (ustuvorlik bilan):
 *  1) `partner` — eski hamkor akkaunti (rol restaurant/store; superadmin yaratadi);
 *  2) `businesses` — A3 merchant akkaunti: panel ruxsati bor biznes (egasi
 *     yoki xodim). Hozircha birinchi FAOL biznes ishlatiladi (bir nechta
 *     biznesni tanlash — keyingi bosqich).
 */

const User = require('../models/User');
const ondexSso = require('./ondexSso');
const { partnerProfile } = require('./partnerProfile');

const PARTNER_ROLES = ['store', 'restaurant'];

/** userinfo -> eski `identity` shakli ({userId, phone, name, partnerRole, ...}). */
function identityFromUserinfo(ui) {
  const id = {
    userId: String(ui.sub || ''), phone: ondexSso.normalizePhone(ui.phone_number), name: String(ui.name || ''),
    partnerRole: '', entityId: '', entityName: '', storeCategory: '',
  };
  const p = ui.partner && typeof ui.partner === 'object' ? ui.partner : null;
  if (p && PARTNER_ROLES.includes(p.role) && typeof p.entity_id === 'string' && p.entity_id) {
    id.partnerRole = p.role;
    id.entityId = p.entity_id;
    id.entityName = typeof p.entity_name === 'string' ? p.entity_name : '';
    id.storeCategory = p.role === 'store' && typeof p.store_category === 'string' ? p.store_category : '';
    return id;
  }
  const list = Array.isArray(ui.businesses) ? ui.businesses : [];
  const b = list.find((x) => x && PARTNER_ROLES.includes(x.type) && x.org_status !== 'suspended' &&
    x.org_status !== 'rejected');
  if (b) {
    id.partnerRole = b.type;
    id.entityId = String(b.legacy_entity_id || b.id || '');
    id.entityName = String(b.name || '');
    // Do'kon kategoriyasi faqat eski hamkor akkauntida bor; A3 do'koni uchun 'store'.
    id.storeCategory = b.type === 'store' ? 'store' : '';
  }
  return id;
}

/**
 * OnDex kimligiga mos ShoxPos hisobini topadi yoki (hamkor uchun) ochadi.
 *  1) `ondexUserId` bo'yicha (doimiy bog'lanish);
 *  2) admin kiritgan telefon bo'yicha, hali bog'lanmagan hisob (bir martalik ulash);
 *  3) hamkor (restoran/do'kon) — hisob avtomatik ochiladi.
 * Hamkor bo'lmagan OnDex akkaunti uchun `null` (kassa ochilmaydi).
 */
async function resolveUser(identity) {
  const phone = identity.phone;

  let user = await User.findOne({ ondexUserId: identity.userId });
  if (user) return user;

  user = await User.findOneAndUpdate(
    { ondexPhone: phone, ondexUserId: { $exists: false } },
    { $set: { ondexUserId: identity.userId } },
    { new: true }
  );
  if (user) return user;

  if (!(identity.partnerRole && identity.entityId)) return null;

  // Do'kon OnDex'da o'chirilib, shu raqam bilan QAYTA yaratilgan: yozuvni yangi
  // akkauntga o'tkazamiz, lekin faqat hamkor yozuvi bo'lsa va eski OnDex
  // akkaunti HAQIQATAN yo'q bo'lsa (raqam boshqa odamga o'tgan bo'lishi mumkin).
  const stale = await User.findOne({
    login: phone,
    ondexPartnerRole: { $in: PARTNER_ROLES },
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
    return stale;
  }

  try {
    return await User.create({
      login: phone,
      ondexUserId: identity.userId,
      ondexPhone: phone,
      ondexPartnerRole: identity.partnerRole,
      ondexEntityId: identity.entityId,
      ...partnerProfile(identity),
      name: identity.name || undefined,
      shopName: identity.entityName || identity.name || 'OnDex Merchant',
    });
  } catch (err) {
    if (err && err.code === 11000) return User.findOne({ ondexUserId: identity.userId });
    throw err;
  }
}

/** Kirishga to'sqinlik sababi ('' — kirish mumkin). */
function denyReason(user) {
  if (!user) return 'not_linked';
  if (user.isDeleted) return 'deleted';
  if (user.blocked) return 'blocked';
  return '';
}

module.exports = { identityFromUserinfo, resolveUser, denyReason };
