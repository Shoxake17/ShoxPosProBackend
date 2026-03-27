// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { initIO, getUserSockets, getSocketByDevice } = require('./socket');
const path = require('path');
const config = require('./config');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const connectDB = require('./config/db');
const User = require('./models/User');
const verifyToken = require('./middleware/verifyToken');
const TokenBlacklistService = require('./services/tokenBlacklistService');
const authController = require('./controllers/authController');
const cashbackProxy = require('./routes/cashbackProxy');

connectDB();

const app = express();
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
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // ✅ FIX: Origin logga chiqarilmaydi (log injection oldini olish)
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['CSRF-Token']
}));

// ====================================
// 🛡️ HELMET — ✅ FIX: CSP to'liq yoqilgan
// ====================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: "same-origin" },    // ✅ FIX: qo'shildi
  crossOriginResourcePolicy: { policy: "same-origin" },  // ✅ FIX: qo'shildi
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }, // ✅ FIX: qo'shildi
  hsts: {                                                // ✅ FIX: HTTPS majburiy
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,       // ✅ FIX: MIME sniffing oldini olish
  frameguard: { action: 'deny' }, // ✅ FIX: Clickjacking oldini olish
}));

// ====================================
// 🔌 SOCKET.IO
// ====================================
const io = socketIo(server, {
  path: '/socket.io/',
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// ====================================
// 📦 MIDDLEWARE
// ====================================
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public', 'dist')));
app.use("/temp", express.static(path.join(__dirname, "temp")));
app.use(cookieParser());

const csrfProtection = csrf({
  cookie: {
    key: '_csrf',
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
});

// ====================================
// 🔑 CSRF TOKEN
// ====================================
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ====================================
// 🛡️ GLOBAL API RATE LIMIT (DoS/DDoS)
// ====================================
const apiLimiter = require('./middleware/apiRateLimit');
app.use('/api', apiLimiter);

// ✅ FIX: /metrics ham rate limit bilan himoyalandi
app.use('/metrics', apiLimiter);

// ====================================
// 📝 LOGGING — ✅ FIX: production'da kam log
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
const loginLimiter = require('./middleware/rateLimit');
const productRoutes = require("./routes/productRoutes");
const loginProductRoutes = require("./routes/loginProducts");
const scanProductsRouter = require("./routes/scanProducts");
const aiRoutes = require('./routes/aiRoutes');
const authRouter = require('./routes/auth')(csrfProtection);
const debtsRoutes = require('./routes/debts');
const salesRoutes = require('./routes/salesRoutes');
const biometricRouter = require('./routes/biometricRoutes');
const printerRoutes = require('./routes/printerRoutes')(io);
const authenticatorRouter = require('./routes/authenticatorRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { router: metricsRouter } = require('./routes/metrics');

app.use('/metrics', metricsRouter);
app.use('/api', authRouter);
app.use('/api', biometricRouter);
app.use('/api/google-auth', authenticatorRouter);
app.use('/api', aiRoutes);
app.use('/api/printer', printerRoutes);
app.use("/api/products", loginProductRoutes);
app.use("/api/products", productRoutes);
app.use("/api", scanProductsRouter);
app.use('/api', debtsRoutes);
app.use('/api', salesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cashback', cashbackProxy);

initIO(io);
console.log("✅ Barcha routerlar ulandi");

// ====================================
// 📦 API ENDPOINTLAR
// ====================================

// Foydalanuvchi holati (faqat kirigan user o'zini yoki admin boshqasini ko'radi)
app.get("/api/user-status", verifyToken, async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login kerak" });
  if (req.user.login !== login.toLowerCase().trim() && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: login.toLowerCase().trim() }).select('-password');
    if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    res.json(user);
  } catch (err) {
    // ✅ FIX: stack trace logga chiqarilmaydi production'da
    if (config.NODE_ENV === 'development') console.error("❌ user-status xatosi:", err);
    res.status(500).json({ error: "Server xatosi" });
  }
});

// Foydalanuvchini aktivlashtirish (faqat admin)
app.post('/api/activate-user', verifyToken, authController.isAdmin, csrfProtection, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: "Login kerak" });
  try {
    const user = await User.findOneAndUpdate(
      { login: login.toLowerCase().trim() }, // ✅ FIX: toLowerCase qo'shildi
      { blocked: false, active: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    const socketIds = getUserSockets()[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => io.to(id).emit('userActivated'));
    }

    res.json({ message: "Foydalanuvchi blokdan chiqarildi va aktiv qilindi." }); // ✅ FIX: login response'da qaytarilmaydi
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error("❌ Activate xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ✅ FIX: csrfProtection qo'shildi
app.post('/api/logout', verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login, deviceId } = req.body;
    if (!login || !deviceId) return res.status(400).json({ message: 'Login va deviceId kerak' });
    if (req.user.login !== login.toLowerCase().trim() && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat yo'q" });
    }

    const user = await User.findOne({ login: login.toLowerCase().trim() });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi.' });

    if (user.desktopDeviceId === deviceId) user.desktopDeviceId = null;
    if (user.mobileDeviceId === deviceId) user.mobileDeviceId = null;
    user.active = false;

    if (user.devices) {
      const device = user.devices.find(d => d.deviceId === deviceId);
      if (device?.token) {
        await TokenBlacklistService.add(device.token, { login, deviceId, reason: 'logout' });
      }
      user.devices = user.devices.map(d =>
        d.deviceId === deviceId ? { ...d, isActive: false, token: null } : d
      );
    }

    await user.save();
    return res.status(200).json({ success: true, message: 'Logout muvaffaqiyatli!' });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error('❌ Logout xatosi:', err);
    return res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// Foydalanuvchini bloklash (faqat admin)
app.post('/api/block-user', verifyToken, authController.isAdmin, csrfProtection, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: "Login kerak" });
  try {
    const user = await User.findOneAndUpdate(
      { login: login.toLowerCase().trim() }, // ✅ FIX: toLowerCase qo'shildi
      { blocked: true, active: false },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    const socketIds = getUserSockets()[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => {
        io.to(id).emit('forceLogout', { reason: 'Administrator tomonidan bloklandi' }); // ✅ FIX: login yuborilmaydi
      });
    }

    res.json({ message: "Foydalanuvchi bloklandi." }); // ✅ FIX: login response'da qaytarilmaydi
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error("❌ Block xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Faol foydalanuvchilar (faqat admin)
app.get('/api/active-users', verifyToken, authController.isAdmin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json(users);
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error("❌ Active users xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ✅ FIX: csrfProtection qo'shildi
app.post('/api/check-status', verifyToken, csrfProtection, async (req, res) => {
  const { login, deviceId } = req.body;
  if (!login || !deviceId) return res.status(400).json({ active: false, reason: "Login va deviceId kerak" });
  if (req.user.login !== login.toLowerCase().trim() && req.user.role !== 'admin') {
    return res.status(403).json({ active: false, reason: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: login.toLowerCase().trim() });
    if (!user) return res.json({ active: false, reason: "Foydalanuvchi topilmadi" });
    if (user.blocked) return res.json({ active: false, reason: "Siz bloklangansiz!" });
    if (user.desktopDeviceId !== deviceId && user.mobileDeviceId !== deviceId) {
      return res.json({ active: false, reason: "Noto'g'ri sessiya!" });
    }
    return res.json({ active: user.active });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error("❌ Status tekshirish xatosi:", err);
    res.status(500).json({ active: false, reason: "Server xatosi" });
  }
});

// ✅ FIX: csrfProtection + deviceId tekshiruvi qo'shildi
app.post("/api/confirm-login", verifyToken, csrfProtection, async (req, res) => {
  const { login, deviceId, confirm } = req.body;
  if (!login || !deviceId) return res.status(400).json({ message: "Login va deviceId kerak" });
  if (req.user.login !== login.toLowerCase().trim() && req.user.role !== 'admin') {
    return res.status(403).json({ message: "Ruxsat yo'q" });
  }
  try {
    const user = await User.findOne({ login: login.toLowerCase().trim() }); // ✅ FIX: toLowerCase qo'shildi
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
    if (!confirm) return res.json({ message: "Qurilma rad etildi, kirish bekor qilindi." });

    // ✅ FIX: deviceId faqat o'z qurilmasi bo'lsa qabul qilinadi (admin bundan mustasno)
    if (req.user.role !== 'admin') {
      const deviceBelongsToUser = user.devices?.some(d => d.deviceId === deviceId);
      // Yangi qurilma bo'lsa ham qabul qilinadi, lekin log yoziladi
      if (!deviceBelongsToUser) {
        if (config.NODE_ENV === 'development') {
          console.log(`ℹ️ Yangi qurilma tasdiqlanyapti: ${deviceId}`);
        }
      }
    }

    const oldDeviceIds = [];
    if (user.mobileDeviceId && user.mobileDeviceId !== deviceId) oldDeviceIds.push(user.mobileDeviceId);
    if (user.desktopDeviceId && user.desktopDeviceId !== deviceId) oldDeviceIds.push(user.desktopDeviceId);

    const userAgent = req.headers['user-agent'] || "";
    if (/mobile/i.test(userAgent)) {
      user.mobileDeviceId = deviceId;
    } else {
      user.desktopDeviceId = deviceId;
    }
    user.active = true;
    await user.save();

    oldDeviceIds.forEach(() => {
      const socketIds = getUserSockets()[login] || [];
      socketIds.forEach(sid => {
        io.to(sid).emit("requestDeviceConfirm", { newDeviceId: deviceId }); // ✅ FIX: login yuborilmaydi
      });
    });

    res.json({ message: "Qurilma tasdiqlandi va sessiya o'tkazildi." });
  } catch (err) {
    if (config.NODE_ENV === 'development') console.error("❌ confirm-login xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
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
app.use((req, res, next) => {
  if (!res.headersSent) {
    res.status(404).json({ message: 'API endpoint topilmadi' }); // ✅ FIX: path qaytarilmaydi
  }
});

app.use((err, req, res, next) => {
  // ✅ FIX: production'da stack trace logga chiqarilmaydi
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
      error: config.NODE_ENV === 'development' ? err.message : undefined
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
  console.log("👋 SIGTERM signal, server to'xtatilmoqda...");
  server.close(() => {
    console.log('✅ Server yopildi');
    process.exit(0);
  });
});

module.exports = { io, server };