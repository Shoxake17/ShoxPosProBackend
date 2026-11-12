// models/BffSession.js
'use strict';

/**
 * Merchant web (BFF) sessiyasi — A4c.4.
 *
 * Brauzerda FAQAT tasodifiy sessiya ID (HttpOnly cookie). Bazada uning
 * sha256 xeshi (`_id`) — baza oqsa ham cookie qayta tiklanmaydi.
 * OnDex tokenlari (access/refresh/id_token) AES-256-GCM bilan shifrlangan
 * (`services/bffSession.js`). Haqiqiy sessiya — OnDex markazida
 * (`ondexSid`): u yopilsa (back-channel yoki refresh rad) bu ham yopiladi.
 */

const mongoose = require('mongoose');

const bffSessionSchema = new mongoose.Schema({
  _id: { type: String }, // sha256(cookie) hex
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  login: { type: String, required: true },
  sc: { type: String, default: '' }, // do'kon kategoriyasi (storeAccess)
  ondexSub: { type: String, required: true },
  ondexSid: { type: String, required: true, index: true },
  accessEnc: { type: String, required: true },
  accessExp: { type: Date, required: true },
  refreshEnc: { type: String, required: true },
  idTokenEnc: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: '' },
}, { versionKey: false });

// Muddati o'tgan yozuvlar avtomatik o'chadi (mutlaq muddatdan 1 kun keyin).
bffSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports = mongoose.models.BffSession || mongoose.model('BffSession', bffSessionSchema);
