// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { initIO, getUserSockets, getSocketByDevice } = require('./socket'); // ✅ getSocketByDevice qo'shildi
const path = require('path');
const config = require('./config');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const connectDB = require('./config/db');
const User = require('./models/User');
const verifyToken = require('./middleware/verifyToken');                    // ✅ YANGI
const TokenBlacklistService = require('./services/tokenBlacklistService'); // ✅ YANGI

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
  'https://shoxpospro-6os2.onrender.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error("❌ Blocked by CORS:", origin);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['CSRF-Token']
}));

// ====================================
// 🛡️ HELMET
// ====================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
// 📝 LOGGING
// ====================================
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - Origin: ${req.headers.origin || 'No origin'}`);
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
const cashbackRoutes = require('./routes/cashback');

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
app.use('/api', cashbackRoutes);

initIO(io);
console.log("✅ Barcha routerlar ulandi");

// ====================================
// 📦 API ENDPOINTLAR
// ====================================

// Foydalanuvchi holati
app.get("/api/user-status", async (req, res) => {
  const login = req.query.login;
  if (!login) return res.status(400).json({ error: "Login kerak" });
  try {
    const user = await User.findOne({ login }).select('-password');
    if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    res.json(user);
  } catch (err) {
    console.error("❌ user-status xatosi:", err);
    res.status(500).json({ error: "Server xatosi" });
  }
});

// Foydalanuvchini aktivlashtirish
app.post('/api/activate-user', async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: "Login kerak" });
  try {
    const user = await User.findOneAndUpdate(
      { login },
      { blocked: false, active: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    const socketIds = getUserSockets()[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => io.to(id).emit('userActivated'));
    }

    res.json({ message: `${login} blokdan chiqarildi va aktiv qilindi.` });
  } catch (err) {
    console.error("❌ Activate xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Logout
app.post('/api/logout', async (req, res) => {
  try {
    const { login, deviceId } = req.body;
    if (!login || !deviceId) return res.status(400).json({ message: 'Login va deviceId kerak' });

    const user = await User.findOne({ login });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi.' });

    if (user.desktopDeviceId === deviceId) user.desktopDeviceId = null;
    if (user.mobileDeviceId === deviceId) user.mobileDeviceId = null;
    user.active = false;

    // ✅ devices array dan ham o'chirish
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
    console.error('❌ Logout xatosi:', err);
    return res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// Foydalanuvchini bloklash
app.post('/api/block-user', async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ message: "Login kerak" });
  try {
    const user = await User.findOneAndUpdate(
      { login },
      { blocked: true, active: false },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    const socketIds = getUserSockets()[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => {
        io.to(id).emit('forceLogout', { login, reason: 'Administrator tomonidan bloklandi' });
      });
    }

    res.json({ message: `${login} bloklandi.` });
  } catch (err) {
    console.error("❌ Block xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Faol foydalanuvchilar
app.get('/api/active-users', async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json(users);
  } catch (err) {
    console.error("❌ Active users xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Status tekshirish
app.post('/api/check-status', async (req, res) => {
  const { login, deviceId } = req.body;
  if (!login || !deviceId) return res.status(400).json({ active: false, reason: "Login va deviceId kerak" });
  try {
    const user = await User.findOne({ login });
    if (!user) return res.json({ active: false, reason: "Foydalanuvchi topilmadi" });
    if (user.blocked) return res.json({ active: false, reason: "Siz bloklangansiz!" });
    if (user.desktopDeviceId !== deviceId && user.mobileDeviceId !== deviceId) {
      return res.json({ active: false, reason: "Noto'g'ri sessiya!" });
    }
    return res.json({ active: user.active });
  } catch (err) {
    console.error("❌ Status tekshirish xatosi:", err);
    res.status(500).json({ active: false, reason: "Server xatosi" });
  }
});

// Loginni tasdiqlash
app.post("/api/confirm-login", async (req, res) => {
  const { login, deviceId, confirm } = req.body;
  if (!login || !deviceId) return res.status(400).json({ message: "❌ Login va deviceId kerak" });
  try {
    const user = await User.findOne({ login });
    if (!user) return res.status(404).json({ message: "❌ Foydalanuvchi topilmadi" });
    if (!confirm) return res.json({ message: "🚫 Qurilma rad etildi, kirish bekor qilindi." });

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
        io.to(sid).emit("requestDeviceConfirm", { login, newDeviceId: deviceId });
      });
    });

    res.json({ message: "✅ Qurilma tasdiqlandi va sessiya o'tkazildi." });
  } catch (err) {
    console.error("❌ confirm-login xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================
// ✅ YANGI: FOYDALANUVCHI QURILMALARI
// ====================================
app.get('/api/user-devices', verifyToken, async (req, res) => {
  const login = req.user.login;
  try {
    const user = await User.findOne({ login }).select('devices');
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });

    // Tokenni yubormaslik — faqat kerakli fieldlar
    const devices = (user.devices || []).map(d => ({
      deviceId: d.deviceId,
      deviceType: d.deviceType,
      deviceOS: d.deviceOS,
      isActive: d.isActive,
      lastLogin: d.lastLogin
    }));

    res.json({ devices });
  } catch (err) {
    console.error('❌ user-devices xatosi:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// ====================================
// ✅ YANGI: QURILMANI TIZIMDAN CHIQARISH
// ====================================
app.post('/api/kick-device', verifyToken, csrfProtection, async (req, res) => {
  const { deviceId } = req.body;
  const login = req.user.login;

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId kerak' });
  }

  // O'z qurilmasini kick qilishga yo'l qo'ymaymiz
  const currentDeviceId = req.user.deviceId || req.cookies?.deviceId;
  if (currentDeviceId && currentDeviceId === deviceId) {
    return res.status(400).json({ message: 'O\'z qurilmangizni chiqarib yuborib bo\'lmaydi' });
  }

  try {
    const user = await User.findOne({ login });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });

    // ✅ 1: Qurilmaning tokenini topib blacklistga qo'shish
    const deviceSession = (user.devices || []).find(d => d.deviceId === deviceId);
    if (deviceSession?.token) {
      await TokenBlacklistService.add(deviceSession.token, {
        login,
        deviceId,
        reason: 'kicked'
      });
      console.log(`⛔ Token blacklistga qo'shildi: ${login} | ${deviceId}`);
    }

    // ✅ 2: FAQAT o'sha qurilmaning socketiga forceLogout yuborish
    const targetSockets = getSocketByDevice(login, deviceId);
    console.log(`🎯 Kick: ${login} | deviceId: ${deviceId} | socketlar soni: ${targetSockets.length}`);

    if (targetSockets.length > 0) {
      targetSockets.forEach(socketId => {
        io.to(socketId).emit('forceLogout', {
          reason: 'Boshqa qurilma tomonidan tizimdan chiqarildingiz'
        });
        console.log(`⛔ forceLogout yuborildi → socketId: ${socketId}`);
      });
    } else {
      // ✅ Fallback: Socket topilmasa ham DB yangilanadi
      // Qurilma keyingi so'rovda 401 oladi (verifyToken → blacklist tekshiradi)
      console.warn(`⚠️ Socket topilmadi, lekin DB yangilanadi: ${login} | ${deviceId}`);
    }

    // ✅ 3: DB da qurilmani isActive = false qilish
    await User.updateOne(
      { login, 'devices.deviceId': deviceId },
      {
        $set: {
          'devices.$.isActive': false,
          'devices.$.token': null,
          'devices.$.kickedAt': new Date()
        }
      }
    );

    // ✅ 4: Eski desktopDeviceId / mobileDeviceId ni ham tozalash
    if (user.desktopDeviceId === deviceId) {
      await User.updateOne({ login }, { $set: { desktopDeviceId: null } });
    }
    if (user.mobileDeviceId === deviceId) {
      await User.updateOne({ login }, { $set: { mobileDeviceId: null } });
    }

    console.log(`✅ Qurilma chiqarildi: ${login} | ${deviceId}`);
    res.json({ success: true, message: 'Qurilma tizimdan chiqarildi' });

  } catch (err) {
    console.error('❌ Kick device xatosi:', err);
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
app.use((req, res, next) => {
  if (!res.headersSent) {
    res.status(404).json({ message: 'API endpoint topilmadi', path: req.path });
  }
});

app.use((err, req, res, next) => {
  console.error('❌ Server xatosi:', err.stack);
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