// config/index.js
const { cleanEnv, str, num, bool } = require('envalid');

const env = cleanEnv(process.env, {
  // --- AUTH & SECURITY ---
  JWT_SECRET:             str(),
  JWT_REFRESH_SECRET:      str(),
  COOKIE_SECRET:          str({ desc: 'Cookie-larni shifrlash uchun maxfiy kalit' }), // ✅ YANGI QO'SHILDI
  JWT_EXPIRES_IN:         str({ default: '15m' }),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),
  JWT_ALGORITHM:          str({ choices: ['HS256', 'RS256'], default: 'HS256' }),
  
  // --- SERVER & DB ---
  PORT:                   num({ default: 3000 }), 
  MONGO_URI:              str(),
  NODE_ENV:               str({ choices: ['development', 'production', 'test'], default: 'development' }),
  
  // --- OnDex orqali KIRISH (ShoxPos'ning o'z auth tizimi yo'q) ---
  // Telefon, Telegram kodi va parolni OnDex API tekshiradi (server-server),
  // biz kimlikni olib o'z sessiyamizni beramiz. Bo'sh bo'lsa kirish O'CHIQ
  // (hech kim kira olmaydi) — shuning uchun server ishga tushganda ogohlantiriladi.
  ONDEX_API_URL:          str({ default: '', desc: 'OnDex API manzili, masalan https://api-ondex.shoxpro.uz' }),
  SSO_CLIENT_ID:          str({ default: 'merchant' }),
  SSO_CLIENT_SECRET:      str({ default: '', desc: 'OnDex tomonidagi SSO_MERCHANT_SECRET bilan BIR XIL' }),
  SSO_REDIRECT_URI:       str({ default: '', desc: 'OnDex ro\'yxatidagi qaytish manzili bilan ANIQ teng (brauzer bu manzilga bormaydi; server-server tekshiruv uchun)' }),
  QURT_WEBHOOK_SECRET:    str({ default: '', desc: 'OnDex QURT_POS_WEBHOOK_SECRET bilan BIR XIL (>= 32 belgi). Bo\'sh bo\'lsa jonli signal qabul qilinmaydi — panel davriy so\'raydi' }),
  BOOTSTRAP_ADMIN_PHONE:  str({ default: '', desc: 'Birinchi admin telefoni (OnDex raqami). Admin yo\'q bo\'lgandagina ishlaydi' }),

  // --- LOGGING & AUDIT ---
  LOG_LEVEL:              str({ choices: ['info', 'debug', 'warn', 'error'], default: 'info' }),
  AUDIT_ENABLED:          bool({ default: true }),
  ADMIN_DEVICE_ID:        str(),

  // --- SOCKET.IO ---
  SOCKET_IO_ENABLED:      bool({ default: false }),
  SOCKET_IO_PORT:         num({ default: 3000 }),

  // --- EXTERNAL SERVICES (Cloudinary) ---
  CLOUDINARY_CLOUD_NAME:  str(),
  CLOUDINARY_API_KEY:     str(),
  CLOUDINARY_API_SECRET:  str(),

  // HMAC konfiguratsiyasi
  QR_SECRET_KEY: str({ desc: 'QR kod imzosini yaratish uchun maxfiy kalit' }),  
});

module.exports = env;