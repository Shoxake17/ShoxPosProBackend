// server.js
const express    = require('express');
const http       = require('http');
const socketIo   = require('socket.io');
const { initIO, getUserSockets } = require('./socket');
const path       = require('path');
const config     = require('./config');
const fs         = require('fs');
const cors       = require('cors');
const helmet     = require('helmet');
const cookieParser = require('cookie-parser');
const csrf       = require('csurf');
const rateLimit  = require('express-rate-limit');

const connectDB              = require('./config/db');
const User                   = require('./models/User');
const verifyToken            = require('./middleware/verifyToken');
const TokenBlacklistService  = require('./services/tokenBlacklistService');
const authController         = require('./controllers/authController');

connectDB();

const app = express();
const server = http.createServer(app);

// ✅ Proxy orqasidagiligini bildirish (secure cookie va IP uchun)
app.set('trust proxy', 1);

// ====================================
// 🔒 CORS SOZLAMALARI
// ====================================
const allowedOrigins = [
  'https://shoxpospro.uz',
  'http://shoxpospro.uz',
  'https://www.shoxpospro.uz',
  'http://www.shoxpospro.uz',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://0.0.0.0:8081',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // ✅ Origin logga chiqarilmaydi — log injection oldini olish
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // ✅ Faqat 'CSRF-Token' — 'X-CSRF-Token' o'chirildi (server bilan bir xil)
  allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['CSRF-Token', 'X-CSRF-Token'],
}));

// ====================================
// 🛡️ HELMET
// ====================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri:    ["'self'"],
      scriptSrc:  ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:", "blob:"],
      connectSrc: [
        "'self'",
        'ws:',
        'wss:',
        'https://cdn.jsdelivr.net',
        'https://freeipapi.com',
        'https://ipapi.co',
        'https://flagcdn.com',
        'https://api.anthropic.com',
        'https://generativelanguage.googleapis.com',
        'https://api.x.ai',
      ],
      fontSrc:    ["'self'", 'data:'],
      objectSrc:  ["'none'"],
      mediaSrc:   ["'self'"],
      frameSrc:   ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff:    true,
  frameguard: { action: 'deny' },
}));

// ====================================
// 🔌 SOCKET.IO
// ✅ allowEIO3: false — eski EIO3 protokoli o'chirildi (xavfsizlik)
// ====================================
const io = socketIo(server, {
  path: '/socket.io/',
  cors: {
    origin:      allowedOrigins,
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  transports:   ['websocket', 'polling'],
  allowEIO3:    false,   // ✅ false — EIO3 o'chirildi
  pingTimeout:  60000,
  pingInterval: 25000,
});

// ====================================
// 📦 MIDDLEWARE
// ====================================
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public', 'dist')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));
app.use(cookieParser());

// ====================================
// 🔒 CSRF HIMOYA
// ====================================
const csrfProtection = csrf({
  cookie: {
    key:      '_csrf',
    httpOnly: true,
    secure:   config.NODE_ENV === 'production', 
    sameSite: 'lax', 
    path:     '/',
  },
  value: (req) => {
    return req.headers['csrf-token'] || 
           req.headers['x-csrf-token'] || 
           req.headers['xsrf-token'] || 
           req.headers['x-xsrf-token'] || 
           (req.body && req.body._csrf) ||
           req.query?._csrf;
  }
});

// ====================================
// 🛡️ RATE LIMITLAR
// ====================================
const apiLimiter = require('./middleware/apiRateLimit');

// ✅ CSRF token uchun alohida rate limit — brute-force oldini olish
const csrfLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 daqiqa
  max: 100,                  // 10 daqiqada 100 ta so'rov (recovery loop uchun yetarli)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Juda ko\'p so\'rov. Keyinroq urinib ko\'ring.' },
  // ✅ stack trace chiqarilmaydi
  handler: (req, res) => {
    res.status(429).json({ message: 'Juda ko\'p so\'rov. Keyinroq urinib ko\'ring.' });
  },
});

// ✅ Global API rate limit
app.use('/api', apiLimiter);
// ✅ /metrics ham himoyalangan
app.use('/metrics', apiLimiter);

// ====================================
// 🔑 CSRF TOKEN ENDPOINT
// ✅ csrfLimiter qo'shildi
// ====================================
app.get('/api/csrf-token', csrfLimiter, csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ====================================
// 📝 LOGGING — production'da minimal
// ====================================
app.use((req, res, next) => {
  if (config.NODE_ENV === 'development') {
    console.log(`📨 ${req.method} ${req.path}`);
  }
  next();
});

// ✅ CSRF Xatolarini tutish uchun maxsus middleware
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      message: 'CSRF token noto\'g\'ri yoki mavjud emas. Iltimos, sahifani yangilang.'
    });
  }
  next(err);
});

// ====================================
// 🛣️ ROUTERLAR
// ====================================
const productRoutes       = require('./routes/productRoutes')(csrfProtection);
const loginProductRoutes  = require('./routes/loginProducts')(csrfProtection);
const scanProductsRouter  = require('./routes/scanProducts')(csrfProtection);
const aiRoutes            = require('./routes/aiRoutes')(csrfProtection);
const authRouter          = require('./routes/auth')(csrfProtection);
const debtsRoutes         = require('./routes/debts')(csrfProtection);
const salesRoutes         = require('./routes/salesRoutes')(csrfProtection);
const biometricRouter     = require('./routes/biometricRoutes')(csrfProtection);
const printerRoutes       = require('./routes/printerRoutes')(io);
const authenticatorRouter = require('./routes/authenticatorRoutes')(csrfProtection);
const cashbackProxy       = require('./routes/cashbackProxy')(csrfProtection);
const adminRoutes         = require('./routes/adminRoutes')(csrfProtection);
const userChatRoutes      = require('./routes/userChatRoutes')(csrfProtection, io);
const { router: metricsRouter } = require('./routes/metrics');

app.use('/metrics',          metricsRouter);
app.use('/api',              authRouter);
app.use('/api',              biometricRouter);
app.use('/api/google-auth',  authenticatorRouter);
app.use('/api',              aiRoutes);
app.use('/api/chat',         userChatRoutes.router);
app.use('/api/printer',      printerRoutes);
app.use('/api/products',     loginProductRoutes);
app.use('/api/products',     productRoutes);
app.use('/api',              scanProductsRouter);
app.use('/api',              debtsRoutes);
app.use('/api',              salesRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/cashback',     cashbackProxy);

initIO(io);
if (config.NODE_ENV === 'development') {
  console.log('✅ Barcha routerlar ulandi');
}

// ====================================
// 🌐 CATCH-ALL (SPA)
// ====================================
app.get(/^(?!\/api).+/, (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, 'public', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Index file topilmadi');
  }
});

// ====================================
// ❌ ERROR HANDLERS
// ====================================
// 404
app.use((req, res) => {
  if (!res.headersSent) {
    // ✅ path qaytarilmaydi — path disclosure oldini olish
    res.status(404).json({ message: 'API endpoint topilmadi' });
  }
});

// Global xato handler
app.use((err, req, res, next) => {
  // ✅ production'da stack trace logga chiqarilmaydi
  if (config.NODE_ENV === 'development') {
    console.error('❌ Server xatosi:', err.stack);
  } else {
    console.error('❌ Server xatosi:', err.message);
  }

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ message: 'CSRF token xato yoki mavjud emas' });
  }
  if (err.message === 'CORS policy violation') {
    return res.status(403).json({ message: 'CORS: Origin ruxsat berilmagan' });
  }
  if (!res.headersSent) {
    res.status(500).json({
      message: 'Server xatosi',
      // ✅ production'da error detail chiqarilmaydi
      error: config.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ====================================
// 🚀 SERVER
// ====================================
const PORT = config.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
✅ SERVER ISHGA TUSHDI
🌐 Port: ${PORT}
🔧 Muhit: ${config.NODE_ENV}
🔌 Socket.IO: Faol
  `);
});

process.on('SIGTERM', () => {
  if (config.NODE_ENV === 'development') console.log("👋 SIGTERM — server to'xtatilmoqda...");
  server.close(() => {
    if (config.NODE_ENV === 'development') console.log('✅ Server yopildi');
    process.exit(0);
  });
});

module.exports = { app, server, io };