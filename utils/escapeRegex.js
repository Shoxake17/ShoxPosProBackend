/**
 * Foydalanuvchi kiritgan matnni MongoDB $regex yoki new RegExp() da
 * ishlatishdan oldin ekranga olish — ReDoS hujumlarining oldini oladi.
 * @param {string} str - Foydalanuvchi kiritgan matn
 * @param {number} maxLen - Maksimal uzunlik (default 200)
 * @returns {string}
 */
function escapeRegex(str, maxLen = 200) {
  if (str == null || typeof str !== 'string') return '';
  let s = str.slice(0, maxLen);
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * XSS va katta payloadlardan himoya: matnni trim qiladi, maksimal uzunlikni cheklaydi.
 * HTML taglarini olib tashlamaydi (backendda HTML qaytarilmasa kerak).
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizeString(str, maxLen = 1000) {
  if (str == null || typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/\0/g, '');
}

module.exports = { escapeRegex, sanitizeString };
