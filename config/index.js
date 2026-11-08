// config/index.js
const { cleanEnv, str, num, bool } = require('envalid');

const env = cleanEnv(process.env, {
  // --- AUTH & SECURITY ---
  COOKIE_SECRET:          str({ desc: 'Cookie-larni shifrlash uchun maxfiy kalit' }), // ✅ YANGI QO'SHILDI
  
  // --- SERVER & DB ---
  PORT:                   num({ default: 3000 }), 
  MONGO_URI:              str(),
  NODE_ENV:               str({ choices: ['development', 'production', 'test'], default: 'development' }),
  
  // --- OnDex OIDC (A4c.4): kirish FAQAT OnDex sahifasida, ShoxPos = BFF ---
  // ShoxPos o'z JWT'larini chiqarmaydi (JWT_SECRET kerak emas). Sessiya —
  // BffSession (cookie = tasodifiy ID), OnDex tokenlari AES-256-GCM bilan.
  ONDEX_ISSUER:           str({ default: '', desc: 'OnDex issuer (brauzer yo\'naltiriladigan), masalan https://api.ondex.uz' }),
  ONDEX_API_INTERNAL_URL: str({ default: '', desc: 'Server-server so\'rovlar uchun ichki manzil (bo\'sh — ONDEX_ISSUER)' }),
  OIDC_CLIENT_ID:         str({ default: 'merchant-web' }),
  OIDC_CLIENT_SECRET:     str({ default: '', desc: 'OnDex OIDC_MERCHANT_WEB_SECRET bilan BIR XIL (>= 32)' }),
  OIDC_REDIRECT_URI:      str({ default: '', desc: 'OnDex ro\'yxatidagi bilan ANIQ teng: https://merchant.ondex.uz/api/auth/oidc/callback' }),
  OIDC_POST_LOGOUT_URI:   str({ default: '', desc: 'Chiqishdan keyin qaytish (OnDex ro\'yxatida bo\'lishi shart)' }),
  BFF_SESSION_KEY:        str({ default: '', desc: '32 bayt (64 hex): OnDex tokenlarini bazada shifrlash kaliti' }),

  // --- OnDex server-server (qurt sinxronlashi, eski hisob tekshiruvi) ---
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


  // HMAC konfiguratsiyasi
  QR_SECRET_KEY: str({ desc: 'QR kod imzosini yaratish uchun maxfiy kalit' }),  
});

module.exports = env;
