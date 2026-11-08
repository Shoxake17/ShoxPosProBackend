// routes/oidcAuth.js
'use strict';

/**
 * OnDex orqali kirish — OIDC Authorization Code + PKCE (A4c.4).
 *
 *   GET  /api/auth/oidc/login?return=/yo'l  -> OnDex kirish sahifasi
 *   GET  /api/auth/oidc/callback            -> kod -> tokenlar -> BFF sessiya
 *   POST /api/auth/oidc/backchannel         -> OnDex: sessiya yopildi (logout_token)
 *   POST /api/auth/oidc/logout              -> markazda ham yopiladi -> OnDex end_session
 *
 * ┌─ XAVFSIZLIK ────────────────────────────────────────────────────────┐
 *  * Parol/kod/TOTP bu serverga KELMAYDI — faqat OnDex sahifasida.
 *  * state + nonce + PKCE verifier imzolangan, shifrlangan, 10 daqiqalik
 *    HttpOnly cookie'da (bazasiz); state doimiy vaqtda solishtiriladi.
 *  * id_token: EdDSA, iss, aud, exp, nonce tekshiriladi; RFC 9207 `iss`.
 *  * `return` faqat shu saytdagi nisbiy yo'l (ochiq yo'naltirgich yo'q).
 *  * back-channel: logout_token imzosi, typ, events, jti qayta o'ynatish keshi.
 * └─────────────────────────────────────────────────────────────────────┘
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const oidc = require('../services/oidcClient');
const bff = require('../services/bffSession');
const account = require('../services/merchantAccount');
const { syncPartnerProfile } = require('../services/partnerProfile');
const AuditService = require('../services/auditService');

const TX_COOKIE = () => (config.NODE_ENV === 'production' ? '__Host-pos_oidc' : 'pos_oidc');
const TX_TTL_MS = 10 * 60 * 1000;

const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const bcLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

const MESSAGES = {
  not_linked: "Bu OnDex akkaunti uchun do'kon hisobi ochilmagan. OnDex administratsiyasiga murojaat qiling",
  blocked: 'Hisob bloklangan',
  deleted: "Bu hisob o'chirilgan",
  unavailable: "OnDex bilan bog'lanib bo'lmadi. Birozdan so'ng urinib ko'ring",
  invalid: "Kirish tasdiqlanmadi. Qaytadan urinib ko'ring",
  sso_off: "OnDex orqali kirish sozlanmagan. Administrator bilan bog'laning",
};

/** Faqat shu saytdagi nisbiy yo'l: "/x" (lekin "//x" yoki "/\x" emas). */
function safeReturn(v) {
  const s = String(v || '');
  if (!/^\/(?![\/\\])[\w\-./?=&%#~+:@]*$/.test(s) || s.length > 512) return '/';
  return s;
}

/** Xato bilan kirish sahifasiga qaytish (frontend `?error=` ni ko'rsatadi). */
function toLogin(res, code) {
  return res.redirect(303, `/login?error=${encodeURIComponent(code)}`);
}

const usedJti = new Map(); // back-channel qayta o'ynatish (bitta jarayon)
function seenJti(jti, exp) {
  const now = Date.now();
  if (usedJti.size > 10000) for (const [k, v] of usedJti) if (v < now) usedJti.delete(k);
  if (usedJti.has(jti)) return true;
  usedJti.set(jti, (exp || 0) * 1000 || now + 5 * 60 * 1000);
  return false;
}

module.exports = (deps = {}) => {
  const router = express.Router();
  const kick = deps.kick || (() => {});

  router.get('/auth/oidc/login', limiter, (req, res) => {
    if (!oidc.isConfigured()) return toLogin(res, 'sso_off');
    const p = oidc.newLoginParams();
    const tx = bff.seal(JSON.stringify({ s: p.state, n: p.nonce, v: p.verifier, r: safeReturn(req.query.return),
      e: Date.now() + TX_TTL_MS }));
    res.cookie(TX_COOKIE(), tx, { ...bff.cookieOptions(), maxAge: TX_TTL_MS });
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, oidc.authorizeUrl({ state: p.state, nonce: p.nonce, challenge: p.challenge,
      prompt: req.query.prompt === 'login' ? 'login' : '' }));
  });

  router.get('/auth/oidc/callback', limiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const raw = req.cookies && req.cookies[TX_COOKIE()];
    res.clearCookie(TX_COOKIE(), bff.cookieOptions());
    let tx;
    try {
      tx = JSON.parse(bff.open(raw));
    } catch {
      return toLogin(res, 'invalid');
    }
    if (!tx || Date.now() > tx.e || !oidc.safeEqual(req.query.state, tx.s)) return toLogin(res, 'invalid');
    // RFC 9207: javob haqiqatan bizning OnDex'dan (mix-up hujumi yo'q).
    if (req.query.iss && req.query.iss !== String(config.ONDEX_ISSUER).replace(/\/+$/, '')) return toLogin(res, 'invalid');
    if (req.query.error) return toLogin(res, 'invalid');
    const code = String(req.query.code || '');
    if (!/^oac_[A-Za-z0-9_-]{20,100}$/.test(code)) return toLogin(res, 'invalid');

    try {
      const tokens = await oidc.exchangeCode(code, tx.v, req.ip);
      const claims = await oidc.verifyIdToken(tokens.id_token, tx.n);
      const ui = await oidc.userinfo(tokens.access_token);
      if (ui.sub !== claims.sub) throw new oidc.OidcError('invalid', 'userinfo sub mos emas');

      const identity = account.identityFromUserinfo(ui);
      const user = await account.resolveUser(identity);
      const deny = account.denyReason(user);
      if (deny) {
        await oidc.revoke(tokens.access_token); // markazdagi sessiya ham ochiq qolmasin
        return toLogin(res, deny);
      }
      if (!user.name && identity.name) user.name = identity.name;
      syncPartnerProfile(user, identity);
      // Profil rasmi — OnDex akkauntidan (markazlashgan; Cloudinary yo'q).
      user.avatarUrl = typeof ui.picture === 'string' ? ui.picture : '';
      user.activeDevice = { deviceId: claims.sid, deviceType: 'web', deviceOS: 'browser', lastLogin: new Date() };
      await user.save();

      const { sid, expiresAt } = await bff.create({ user, tokens, idToken: tokens.id_token, claims,
        ip: req.ip, userAgent: req.headers['user-agent'] });
      bff.setCookie(res, sid, expiresAt);
      AuditService.logUserAction({ login: user.login, action: 'LOGIN', status: 'SUCCESS' }).catch(() => {});
      return res.redirect(303, safeReturn(tx.r));
    } catch (e) {
      const kind = e && e.kind;
      console.error(`⚠️ [oidc] callback: ${e && e.message}`);
      if (kind === 'unavailable' || kind === 'misconfig' || kind === 'rate') return toLogin(res, 'unavailable');
      return toLogin(res, 'invalid');
    }
  });

  // OnDex -> ShoxPos (server-server). CSRF yo'q (imzolangan JWT bilan himoyalangan).
  router.post('/auth/oidc/backchannel', bcLimiter, express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const c = await oidc.verifyLogoutToken(req.body && req.body.logout_token);
      if (seenJti(c.jti, c.exp)) return res.status(400).json({ error: 'invalid_request' });
      const closed = await bff.revokeByOndexSid(c.sid, 'backchannel');
      for (const s of closed) kick(s.login, s.ondexSid);
      return res.status(200).end();
    } catch (e) {
      console.warn(`⚠️ [oidc] back-channel rad etildi: ${e && e.message}`);
      return res.status(400).json({ error: 'invalid_request' });
    }
  });

  /**
   * Chiqish: BFF sessiya + markazdagi sessiya yopiladi; brauzer OnDex
   * end_session'ga yuboriladi (SSO cookie ham o'chsin). CSRF — `deps.csrf`.
   */
  // /logout — eski frontend manzili (bir xil xulq).
  router.post(['/auth/oidc/logout', '/logout'], ...(deps.csrf ? [deps.csrf] : []), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const s = await bff.find(bff.cookieFrom(req)).catch(() => null);
    bff.clearCookie(res);
    if (!s) return res.json({ success: true, redirect: '/login' });
    let hint = '';
    try {
      hint = bff.idToken(s);
      await oidc.revoke(bff.accessToken(s));
    } catch { /* tokenni ochib bo'lmasa ham mahalliy sessiya yopiladi */ }
    await bff.revoke(s._id, 'logout');
    kick(s.login, s.ondexSid);
    AuditService.logUserAction({ login: s.login, action: 'LOGOUT', status: 'SUCCESS' }).catch(() => {});
    return res.json({ success: true, redirect: oidc.endSessionUrl(hint, '') });
  });

  return router;
};

module.exports.MESSAGES = MESSAGES;
module.exports.safeReturn = safeReturn;
