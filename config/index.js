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
  
  // --- SHOXPAY INTEGRATION ---
  SHOXPAY_BACKEND_URL:    str({ default: 'http://localhost:4000' }), // ✅ YANGI QO'SHILDI
  SHOXPOSPRO_SECRET:      str({ default: 'shoxpospro-secret-2024' }), // ✅ YANGI QO'SHILDI

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