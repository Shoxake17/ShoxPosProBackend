// services/bffSession.js
'use strict';

/**
 * Merchant web BFF sessiyasi (A4c.4). ShoxPos o'z JWT'larini CHIQARMAYDI —
 * kirish OnDex OIDC orqali, sessiyaning haqiqiy manbai OnDex markazi.
 *
 *   cookie (tasodifiy ID) -> BffSession (sha256) -> OnDex access token
 *   access token muddati tugasa -> OnDex /v2/oauth/token (refresh)
 *     -> markaz sessiyani yopgan bo'lsa refresh RAD -> bu sessiya ham yopiladi
 *   back-channel logout -> revokeByOndexSid -> darhol yopiladi
 *
 * OnDex vaqtincha javob bermasa (tarmoq) kassa to'xtab qolmasligi uchun
 * `OFFLINE_GRACE_MS` muhlati: shu vaqt ichida oldingi holat bilan ishlanadi.
 * Markaz sessiyani RAD etgan bo'lsa (invalid_grant) muhlat YO'Q.
 */

const crypto = require('crypto');
const config = require('../config');
const BffSession = require('../models/BffSession');
const oidc = require('./oidcClient');

const REFRESH_BEFORE_MS = 60 * 1000;
const OFFLINE_GRACE_MS = 15 * 60 * 1000;
const ABS_TTL_MS = 30 * 24 * 3600 * 1000; // OnDex merchant-web mutlaq muddati
const CACHE_MS = 10 * 1000;

const isProd = () => config.NODE_ENV === 'production';
const cookieName = () => (isProd() ? '__Host-pos_sid' : 'pos_sid');

function cookieOptions(expires) {
  // __Host-: Secure, Path=/, Domain'siz. Lax: OnDex'dan qaytish (top-level GET) cookie'ni ko'radi.
  return { httpOnly: true, secure: isProd(), sameSite: 'lax', path: '/', ...(expires ? { expires } : {}) };
}

// ── shifrlash ─────────────────────────────────────────────────────────────
let keyBuf = null;
function key() {
  if (keyBuf) return keyBuf;
  const raw = String(config.BFF_SESSION_KEY || '');
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('BFF_SESSION_KEY 32 bayt (64 hex) bo\'lishi shart');
  keyBuf = k;
  return k;
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function open(sealed) {
  const b = Buffer.from(String(sealed || ''), 'base64');
  if (b.length < 29) throw new Error('shifr: qisqa');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// ── kesh (bitta jarayon; yopishda darhol tozalanadi) ─────────────────────
const cache = new Map();
function cacheGet(h) {
  const e = cache.get(h);
  if (e && Date.now() - e.at < CACHE_MS) return e.s;
  cache.delete(h);
  return null;
}
function cachePut(h, s) {
  if (cache.size > 5000) cache.clear();
  cache.set(h, { at: Date.now(), s });
}

/** Yangi sessiya; cookie qiymatini qaytaradi. */
async function create({ user, tokens, idToken, claims, ip, userAgent }) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await BffSession.create({
    _id: hash(sid), userId: user._id, login: user.login, sc: user.ondexStoreCategory || '',
    ondexSub: claims.sub, ondexSid: claims.sid,
    accessEnc: seal(tokens.access_token), accessExp: new Date(now + (Number(tokens.expires_in) || 600) * 1000),
    refreshEnc: seal(tokens.refresh_token), idTokenEnc: idToken ? seal(idToken) : '',
    ip: String(ip || '').slice(0, 64), userAgent: String(userAgent || '').slice(0, 300),
    createdAt: new Date(now), lastSeenAt: new Date(now), expiresAt: new Date(now + ABS_TTL_MS),
  });
  return { sid, expiresAt: new Date(now + ABS_TTL_MS) };
}

function setCookie(res, sid, expiresAt) { res.cookie(cookieName(), sid, cookieOptions(expiresAt)); }
function clearCookie(res) { res.clearCookie(cookieName(), cookieOptions()); }

function cookieFrom(req) { return req.cookies ? req.cookies[cookieName()] : null; }

/** Cookie (yoki xom qiymat) bo'yicha faol yozuv. */
async function find(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 128) return null;
  const h = hash(raw);
  let s = cacheGet(h);
  if (!s) {
    s = await BffSession.findById(h).lean();
    if (s) cachePut(h, s);
  }
  if (!s || s.revokedAt || new Date(s.expiresAt).getTime() <= Date.now()) return null;
  return s;
}

const inflight = new Map();

/**
 * Access token yangi bo'lishini ta'minlaydi. `onIdentity(userinfo)` — refresh
 * paytida kimlik (kategoriya, bloklash) yangilanishi uchun chaqiriladi;
 * `false` qaytarsa sessiya yopiladi.
 */
async function ensureFresh(s, { ip, onIdentity } = {}) {
  if (new Date(s.accessExp).getTime() - REFRESH_BEFORE_MS > Date.now()) return s;
  if (inflight.has(s._id)) return inflight.get(s._id);
  const p = (async () => {
    let tok;
    try {
      tok = await oidc.refresh(open(s.refreshEnc), ip);
    } catch (e) {
      if (e && (e.kind === 'unavailable' || e.kind === 'rate') &&
          Date.now() - new Date(s.accessExp).getTime() < OFFLINE_GRACE_MS) {
        console.warn(`⚠️ [bff] OnDex refresh vaqtincha ishlamadi (${e.message}) — muhlat ichida davom`);
        return s;
      }
      // Markaz RAD etdi (sessiya yopilgan/o'g'irlik) — bu sessiya ham yopiladi.
      // OnDex shunchaki javob bermayapti — yopilMAYDI, faqat hozircha 401:
      // OnDex qaytgach keyingi so'rov odatdagidek yangilanadi.
      // (misconfig — bizning sozlama xatosi: foydalanuvchi sessiyasi yopilmaydi, faqat log.)
      if (e && e.kind === 'misconfig') console.error(`❌ [bff] OnDex klient sozlamasi xato: ${e.message}`);
      if (e && e.kind === 'invalid') await revoke(s._id, 'ondex_rejected');
      return null;
    }
    // Compare-and-swap: boshqa jarayon allaqachon yangilagan bo'lsa ustiga yozmaymiz.
    const upd = await BffSession.findOneAndUpdate(
      { _id: s._id, refreshEnc: s.refreshEnc, revokedAt: null },
      { $set: { accessEnc: seal(tok.access_token), refreshEnc: seal(tok.refresh_token),
        accessExp: new Date(Date.now() + (Number(tok.expires_in) || 600) * 1000), lastSeenAt: new Date() } },
      { new: true, lean: true });
    if (!upd) return BffSession.findById(s._id).lean();
    if (onIdentity) {
      let keep = true;
      try {
        keep = await onIdentity(await oidc.userinfo(tok.access_token), upd);
      } catch (e) {
        keep = !(e && e.kind === 'invalid');
      }
      if (keep === false) {
        await revoke(s._id, 'identity_changed');
        return null;
      }
    }
    cachePut(upd._id, upd);
    return upd;
  })().finally(() => inflight.delete(s._id));
  inflight.set(s._id, p);
  return p;
}

async function revoke(id, reason) {
  cache.delete(id);
  await BffSession.updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

/** Back-channel: OnDex sessiyasi yopildi. Yopilgan yozuvlar (socket chiqarish uchun). */
async function revokeByOndexSid(ondexSid, reason) {
  const list = await BffSession.find({ ondexSid, revokedAt: null }).select('_id login ondexSid').lean();
  for (const s of list) await revoke(s._id, reason);
  return list;
}

async function updateIdentity(id, fields) {
  cache.delete(id);
  await BffSession.updateOne({ _id: id }, { $set: fields });
}

const accessToken = (s) => open(s.accessEnc);
const idToken = (s) => (s.idTokenEnc ? open(s.idTokenEnc) : '');

function _resetForTest() { cache.clear(); inflight.clear(); keyBuf = null; }

module.exports = {
  cookieName, cookieOptions, create, setCookie, clearCookie, cookieFrom, find, ensureFresh, revoke,
  revokeByOndexSid, updateIdentity, accessToken, idToken, seal, open, hash, _resetForTest,
  OFFLINE_GRACE_MS,
};
