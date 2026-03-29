// server.js
require('dotenv').config();

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
const cashbackProxy          = require('./routes/cashbackProxy');

connectDB();

const app    = express();
const server = http.createServer(app);

// ====================================
// 🔐 CORS
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
  allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['CSRF-Token'],
}));

// ====================================
// 🛡️ HELMET
// ====================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      mediaSrc:   ["'self'"],
      frameSrc:   ["'none'"],
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
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
  },
});

// ====================================
// 🛡️ RATE LIMITLAR
// ====================================
const apiLimiter = require('./middleware/apiRateLimit');

// ✅ CSRF token uchun alohida rate limit — brute-force oldini olish
const csrfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: 30,                   // 15 daqiqada 30 ta so'rov
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

// ====================================
// 🛣️ ROUTERLAR
// ====================================
const productRoutes       = require('./routes/productRoutes');
const loginProductRoutes  = require('./routes/loginProducts');
const scanProductsRouter  = require('./routes/scanProducts');
const aiRoutes            = require('./routes/aiRoutes');
const authRouter          = require('./routes/auth')(csrfProtection);
const debtsRoutes         = require('./routes/debts');
const salesRoutes         = require('./routes/salesRoutes');
const biometricRouter     = require('./routes/biometricRoutes');
const printerRoutes       = require('./routes/printerRoutes')(io);
const authenticatorRouter = require('./routes/authenticatorRoutes');
const adminRoutes         = require('./routes/adminRoutes');
const { router: metricsRouter } = require('./routes/metrics');

app.use('/metrics',          metricsRouter);
app.use('/api',              authRouter);
app.use('/api',              biometricRouter);
app.use('/api/google-auth',  authenticatorRouter);
app.use('/api',              aiRoutes);
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
// 📦 API ENDPOINTLAR
// ====================================

// ─── Foydalanuvchi holati ──────────────────────────────────────────────────
app.get('/api/user-status', verifyToken, async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: 'Login kerak' });

  const safeLogin = String(login).trim().toLowerCase();

  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: safeLogin }).select('-password');
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json(user);
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ user-status:', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─── Foydalanuvchini aktivlashtirish (faqat admin) ────────────────────────
app.post('/api/activate-user', verifyToken, authController.isAdmin, csrfProtection, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: 'Login kerak' });

  const safeLogin = String(login).trim().toLowerCase();

  try {
    const user = await User.findOneAndUpdate(
      { login: safeLogin },
      { blocked: false, active: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi!' });

    const socketIds = getUserSockets()[safeLogin];
    if (socketIds?.length > 0) {
      socketIds.forEach(id => io.to(id).emit('userActivated'));
    }

    // ✅ login response'da qaytarilmaydi
    res.json({ message: "Foydalanuvchi blokdan chiqarildi va aktiv qilindi." });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ activate-user:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────
app.post('/api/logout', verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login, deviceId } = req.body;
    if (!login || !deviceId) {
      return res.status(400).json({ message: 'Login va deviceId kerak' });
    }

    const safeLogin = String(login).trim().toLowerCase();

    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }

    const user = await User.findOne({ login: safeLogin });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi.' });

    if (user.desktopDeviceId === deviceId) user.desktopDeviceId = null;
    if (user.mobileDeviceId  === deviceId) user.mobileDeviceId  = null;
    user.active = false;

    if (user.devices) {
      const device = user.devices.find(d => d.deviceId === deviceId);
      if (device?.token) {
        await TokenBlacklistService.add(device.token, { login: safeLogin, deviceId, reason: 'logout' });
      }
      user.devices = user.devices.map(d =>
        d.deviceId === deviceId ? { ...d, isActive: false, token: null } : d
      );
    }

    await user.save();
    return res.status(200).json({ success: true, message: 'Logout muvaffaqiyatli!' });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ logout:', err);
    return res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// ─── Foydalanuvchini bloklash (faqat admin) ───────────────────────────────
app.post('/api/block-user', verifyToken, authController.isAdmin, csrfProtection, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: 'Login kerak' });

  const safeLogin = String(login).trim().toLowerCase();

  try {
    const user = await User.findOneAndUpdate(
      { login: safeLogin },
      { blocked: true, active: false },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi!' });

    const socketIds = getUserSockets()[safeLogin];
    if (socketIds?.length > 0) {
      socketIds.forEach(id => {
        // ✅ login socket eventda yuborilmaydi
        io.to(id).emit('forceLogout', { reason: 'Administrator tomonidan bloklandi' });
      });
    }

    // ✅ login response'da qaytarilmaydi
    res.json({ message: 'Foydalanuvchi bloklandi.' });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ block-user:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ─── Faol foydalanuvchilar (faqat admin) ──────────────────────────────────
app.get('/api/active-users', verifyToken, authController.isAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json(users);
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ active-users:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ─── Sessiya holati tekshiruvi ─────────────────────────────────────────────
app.post('/api/check-status', verifyToken, csrfProtection, async (req, res) => {
  const { login, deviceId } = req.body;
  if (!login || !deviceId) {
    return res.status(400).json({ active: false, reason: 'Login va deviceId kerak' });
  }

  const safeLogin = String(login).trim().toLowerCase();

  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ active: false, reason: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: safeLogin });
    if (!user)        return res.json({ active: false, reason: 'Foydalanuvchi topilmadi' });
    if (user.blocked) return res.json({ active: false, reason: 'Siz bloklangansiz!' });
    if (user.desktopDeviceId !== deviceId && user.mobileDeviceId !== deviceId) {
      return res.json({ active: false, reason: "Noto'g'ri sessiya!" });
    }
    return res.json({ active: user.active });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ check-status:', err);
    res.status(500).json({ active: false, reason: 'Server xatosi' });
  }
});

// ─── Qurilmani tasdiqlash ──────────────────────────────────────────────────
app.post('/api/confirm-login', verifyToken, csrfProtection, async (req, res) => {
  const { login, deviceId, confirm } = req.body;
  if (!login || !deviceId) {
    return res.status(400).json({ message: 'Login va deviceId kerak' });
  }

  const safeLogin = String(login).trim().toLowerCase();

  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ message: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: safeLogin });
    if (!user)    return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });
    if (!confirm) return res.json({ message: 'Qurilma rad etildi, kirish bekor qilindi.' });

    if (req.user.role !== 'admin') {
      const deviceBelongsToUser = user.devices?.some(d => d.deviceId === deviceId);
      if (!deviceBelongsToUser && config.NODE_ENV === 'development') {
        console.log(`ℹ️ Yangi qurilma tasdiqlanyapti: ${deviceId}`);
      }
    }

    const oldDeviceIds = [];
    if (user.mobileDeviceId  && user.mobileDeviceId  !== deviceId) oldDeviceIds.push(user.mobileDeviceId);
    if (user.desktopDeviceId && user.desktopDeviceId !== deviceId) oldDeviceIds.push(user.desktopDeviceId);

    const userAgent = req.headers['user-agent'] || '';
    if (/mobile/i.test(userAgent)) {
      user.mobileDeviceId = deviceId;
    } else {
      user.desktopDeviceId = deviceId;
    }
    user.active = true;
    await user.save();

    oldDeviceIds.forEach(() => {
      const socketIds = getUserSockets()[safeLogin] || [];
      socketIds.forEach(sid => {
        // ✅ login yuborilmaydi
        io.to(sid).emit('requestDeviceConfirm', { newDeviceId: deviceId });
      });
    });

    res.json({ message: "Qurilma tasdiqlandi va sessiya o'tkazildi." });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ confirm-login:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ====================================
// 🌐 CATCH-ALL (SPA)
// ====================================
app.get('*', (req, res, next) => {
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

module.exports = { io, server };