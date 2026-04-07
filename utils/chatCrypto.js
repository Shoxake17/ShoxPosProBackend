// utils/chatCrypto.js
const crypto = require('crypto');
const zlib = require('zlib');
const config = require('../config');

const IV_LENGTH = 16;

// Hozirgi va eski kalitlar
const KEYS = {
  v1: crypto.createHash('sha256').update(config.JWT_SECRET).digest(),
  // Agar eski secret bo'lsa:
  // v0: crypto.createHash('sha256').update(config.OLD_JWT_SECRET || '').digest(),
};

const CURRENT_VERSION = 'v1';

/**
 * Shifrlash — versiya prefiksi bilan
 */
function encryptAndCompress(text) {
  if (!text) return '';

  const compressed = zlib.deflateSync(Buffer.from(text, 'utf8'));
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', KEYS[CURRENT_VERSION], iv);

  let encrypted = cipher.update(compressed);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const payload = Buffer.concat([iv, encrypted]).toString('base64');

  // Format: "v1:BASE64DATA"
  return `${CURRENT_VERSION}:${payload}`;
}

/**
 * Shifr ochish — versiyani aniqlab, to'g'ri kalit ishlatish
 */
function decryptAndDecompress(encryptedBase64) {
  if (!encryptedBase64) return '';

  try {
    let version = CURRENT_VERSION;
    let payload = encryptedBase64;

    // Versiya prefiksi bormi?
    if (encryptedBase64.includes(':')) {
      const colonIdx = encryptedBase64.indexOf(':');
      version = encryptedBase64.slice(0, colonIdx);
      payload = encryptedBase64.slice(colonIdx + 1);
    }

    const key = KEYS[version];
    if (!key) throw new Error(`Noma'lum versiya: ${version}`);

    const data = Buffer.from(payload, 'base64');
    const iv = data.slice(0, IV_LENGTH);
    const encryptedText = data.slice(IV_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decompressed = zlib.inflateSync(decrypted);
    return decompressed.toString('utf8');

  } catch (err) {
    console.error('Chat dekripsiya xatosi:', err.message);
    return null; // ❌ [Xatolik string] emas, null qaytaring!
  }
}

module.exports = { encryptAndCompress, decryptAndDecompress };