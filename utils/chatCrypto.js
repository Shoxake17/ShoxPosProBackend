// utils/chatCrypto.js
const crypto = require('crypto');
const zlib = require('zlib');
const config = require('../config');

// JWT_SECRET dan 32 baytli kalit yaratish (AES-256 uchun)
const ENCRYPTION_KEY = crypto.createHash('sha256').update(config.JWT_SECRET).digest();
const IV_LENGTH = 16; // AES uchun IV uzunligi

/**
 * Ma'lumotni siqish va shifrlash
 * @param {string} text - Asl xabar matni
 * @returns {string} - base64 formatdagi shifrlangan ma'lumot
 */
function encryptAndCompress(text) {
  if (!text) return '';

  // 1. Siqish (Compression)
  const compressed = zlib.deflateSync(Buffer.from(text, 'utf8'));

  // 2. Shifrlash (Encryption)
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(compressed);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // IV + Encrypted ma'lumotni birlashtirib qaytarish
  return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Shifrlangan ma'lumotni ochish va dekompressiya qilish
 * @param {string} encryptedBase64 - base64 formatdagi shifrlangan ma'lumot
 * @returns {string} - Asl matn
 */
function decryptAndDecompress(encryptedBase64) {
  if (!encryptedBase64) return '';

  try {
    const data = Buffer.from(encryptedBase64, 'base64');

    // 1. Shifrdan chiqarish
    const iv = data.slice(0, IV_LENGTH);
    const encryptedText = data.slice(IV_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // 2. Dekompressiya
    const decompressed = zlib.inflateSync(decrypted);
    return decompressed.toString('utf8');
  } catch (err) {
    console.error('Chat dekripsiya xatosi:', err.message);
    return '[Xatolik: Xabarni o\'qib bo\'lmadi]';
  }
}

module.exports = {
  encryptAndCompress,
  decryptAndDecompress
};
