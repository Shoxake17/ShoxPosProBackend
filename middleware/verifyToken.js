// middleware/verifyToken.js
'use strict';

/**
 * Autentifikatsiya — OnDex markaziy sessiyasi orqali (A4c.4, BFF).
 *
 * ShoxPos o'z JWT'larini endi CHIQARMAYDI va TEKSHIRMAYDI. Brauzerda faqat
 * HttpOnly sessiya cookie'si; u `BffSession` ga, u esa OnDex sessiyasiga
 * bog'langan. Markazda yopilgan sessiya (chiqish, "Qurilmalar", parol
 * almashishi, xodim bo'shatilishi) — back-channel orqali darhol, eng yomon
 * holatda keyingi refresh'da (≤10 daqiqa) bu yerda ham tugaydi.
 *
 * `req.user` = { id, login, deviceId }. `login` — tenant kaliti: har marshrut
 * FAQAT o'z login'i ma'lumotiga kiradi ("hamma do'konni ko'radigan" rol YO'Q,
 * 2026-11-12). `deviceId` = OnDex sessiya ID (`sid`).
 */

const bff = require('../services/bffSession');
const User = require('../models/User');
const { syncPartnerProfile } = require('../services/partnerProfile');
const account = require('../services/merchantAccount');

/**
 * Refresh paytida kimlikni yangilash: do'kon kategoriyasi o'zgargan bo'lsa
 * sessiyaga yoziladi; hamkorlik olib tashlangan / hisob bloklangan — sessiya yopiladi.
 */
async function onIdentity(ui, s) {
  const user = await User.findById(s.userId);
  if (account.denyReason(user)) return false;
  const identity = account.identityFromUserinfo(ui);
  if (identity.userId !== s.ondexSub) return false;
  if (user.ondexPartnerRole && !identity.partnerRole) return false; // hamkorlik olib tashlangan
  try {
    const pic = typeof ui.picture === 'string' ? ui.picture : '';
    const changed = syncPartnerProfile(user, identity) || (user.avatarUrl || '') !== pic;
    user.avatarUrl = pic;
    if (changed) await user.save();
  } catch {
    return false; // kategoriya aniqlanmadi — fail-closed
  }
  if ((user.ondexStoreCategory || '') !== (s.sc || '')) {
    await bff.updateIdentity(s._id, { sc: user.ondexStoreCategory || '' });
    s.sc = user.ondexStoreCategory || '';
  }
  return true;
}

/** So'rov sessiyasi (bir so'rovda bir marta hisoblanadi) yoki `null`. */
async function authenticate(req) {
  if (req._bff !== undefined) return req._bff;
  let s = await bff.find(bff.cookieFrom(req));
  if (s) s = await bff.ensureFresh(s, { ip: req.ip, onIdentity });
  req._bff = s || null;
  return req._bff;
}

async function verifyToken(req, res, next) {
  try {
    const s = await authenticate(req);
    if (!s) {
      return res.status(401).json({
        success: false, code: 'SESSION_REQUIRED',
        message: 'Autentifikatsiya talab qilinadi. Iltimos, tizimga kiring.',
      });
    }
    req.user = { id: String(s.userId), login: s.login, deviceId: s.ondexSid };
    return next();
  } catch (err) {
    console.error(`🛡️ [AuthError]: ${err && err.message}`);
    return res.status(500).json({ success: false, message: 'Ichki server xatosi' });
  }
}

module.exports = verifyToken;
module.exports.authenticate = authenticate;
