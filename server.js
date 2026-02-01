// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const net = require('net');
const socketIo = require('socket.io');
const { initIO } = require('./socket');
const path = require('path');
const config = require('./config');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const connectDB = require('./config/db');

// ✅ User modelini import qilish (MUHIM!)
const User = require('./models/User'); // Yo'lingizga qarab to'g'rilang

// Database ulash
connectDB();

const app = express();
const server = http.createServer(app);

// ====================================
// 🔐 CORS KONFIGURATSIYASI (TO'G'RILANGAN)
// ====================================
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8081',
  'http://localhost:19006', // Expo web
  'http://0.0.0.0:8081', // Mobil qurilmalar uchun (IP manzilingizga o'zgartiring)
  ...(process.env.NODE_ENV === 'production' 
    ? ['https://shoxpospro-6os2.onrender.com'] 
    : [])
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked: ${origin}`);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['CSRF-Token']
}));

// ====================================
// 🛡️ HELMET KONFIGURATSIYASI
// ====================================
app.use(helmet({
  contentSecurityPolicy: false, // Agar frontend bilan muammo bo'lsa
  crossOriginEmbedderPolicy: false
}));

// ====================================
// 🔌 SOCKET.IO KONFIGURATSIYASI
// ====================================
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// ====================================
// 📦 MIDDLEWARE (TO'G'RI TARTIBDA!)
// ====================================

// 1. Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 2. Static fayllar
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public', 'dist')));
app.use("/temp", express.static(path.join(__dirname, "temp")));

// 3. Cookie parser (CSRF dan oldin!)
app.use(cookieParser());

// 4. CSRF protection (faqat zarur route'larga)
const csrfProtection = csrf({ 
  cookie: {
    key: '_csrf',
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax'
  } 
});

// ====================================
// 🔑 CSRF TOKEN ENDPOINT
// ====================================
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// ====================================
// 📝 LOGGING MIDDLEWARE
// ====================================
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - Origin: ${req.headers.origin || 'No origin'}`);
  next();
});

// ====================================
// 🛣️ ROUTERLAR
// ====================================
const cardRoutes = require('./routes/card');
const telegramSender = require('./routes/telegramSender');
const telegramPasswordRoutes = require('./routes/telegramPassword');
const loginLimiter = require('./middleware/rateLimit');
const productRoutes = require("./routes/productRoutes");
const loginProductRoutes = require("./routes/loginProducts");
const scanProductsRouter = require("./routes/scanProducts");
const aiRoutes = require('./routes/aiRoutes');
const authRouter = require('./routes/auth');
const debtsRoutes = require('./routes/debts');
const salesRoutes = require('./routes/salesRoutes');
const biometricRouter = require('./routes/biometricRoutes');
const printerRoutes = require('./routes/printerRoutes')(io);
const authenticatorRouter = require('./routes/authenticatorRoutes');
const adminRoutes = require('./routes/adminRoutes');
// Router ulash
app.use('/', cardRoutes);
app.use('/', telegramSender);
app.use('/api', authRouter);
app.use('/api', biometricRouter);
app.use('/api/google-auth', authenticatorRouter);
app.use('/api/telegram', telegramPasswordRoutes);
app.use('/api', aiRoutes);
app.use('/api/printer', printerRoutes);
app.use("/api/products", loginProductRoutes);
app.use("/api/products", productRoutes);
app.use("/api", scanProductsRouter);
app.use('/api', debtsRoutes);
app.use('/api', salesRoutes);
app.use('/api/admin', adminRoutes);
initIO(io);
require('./bot');

console.log("✅ Barcha routerlar ulandi");

// ====================================
// 🔐 SOCKET.IO VA FAOL FOYDALANUVCHILAR
// ====================================

let activeUsers = [];
const userSockets = {};

io.on('connection', (socket) => {
  console.log('🔌 Yangi socket ulandi:', socket.id);

  socket.on('register-device', (deviceId) => {
    socket.join(deviceId);
    console.log(`📱 Qurilma ulandi: ${deviceId} → ${socket.id}`);
  });

  socket.on('registerUser', ({ login }) => {
    if (!login) return;
    if (!userSockets[login]) userSockets[login] = [];
    if (!userSockets[login].includes(socket.id)) {
      userSockets[login].push(socket.id);
    }
    console.log(`📲 ${login} ro'yxatdan o'tdi: ${socket.id}`);
  });

  socket.on('userLogged', (user) => {
    if (!user || !user.login) return;

    const existing = activeUsers.find(
      u => u.login === user.login && u.deviceType === user.deviceType
    );
    if (existing && existing.active === false) return;

    const updatedUser = {
      login: user.login,
      deviceId: user.deviceId,
      deviceType: user.deviceType || "Noma'lum",
      deviceOS: user.deviceOS || "Noma'lum",
      lastActive: user.lastActive || new Date().toLocaleString(),
      active: true
    };

    const index = activeUsers.findIndex(u => u.deviceId === user.deviceId);
    if (index !== -1) {
      activeUsers[index] = updatedUser;
    } else {
      activeUsers.push(updatedUser);
    }
    io.emit('userLogged', updatedUser);
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket uzildi:', socket.id);
    for (const login in userSockets) {
      userSockets[login] = userSockets[login].filter(id => id !== socket.id);
      if (userSockets[login].length === 0) {
        delete userSockets[login];
      }
    }
  });
});

// ====================================
// 📦 API ENDPOINTLAR
// ====================================

const cardFile = path.join(__dirname, "card.json");

// Karta tekshirish
app.post("/check-card", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ exists: false });

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      cards = JSON.parse(fs.readFileSync(cardFile, "utf-8"));
    } catch (err) {
      console.error("❌ Karta faylini o'qishda xato:", err);
      return res.status(500).json({ exists: false, error: "Fayl xatosi" });
    }
  }

  const card = cards.find(c => c.id === id);
  if (card) return res.json({ exists: true, data: card });
  return res.json({ exists: false });
});

// Cashback qo'shish
app.put("/add-cashback", (req, res) => {
  const { id, amount } = req.body;
  if (!id || typeof amount !== "number") {
    return res.status(400).json({ success: false, message: "Noto'g'ri ma'lumot" });
  }

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      cards = JSON.parse(fs.readFileSync(cardFile, "utf-8"));
    } catch (err) {
      console.error("❌ Karta faylini o'qishda xato:", err);
    }
  }

  let card = cards.find(c => c.id === id);
  if (!card) {
    card = { id, balance: 0, createdAt: new Date().toISOString() };
    cards.push(card);
  }

  card.balance = (card.balance || 0) + amount;

  try {
    fs.writeFileSync(cardFile, JSON.stringify(cards, null, 2), "utf-8");
    res.json({ success: true, balance: card.balance });
  } catch (err) {
    console.error("❌ Karta faylini yozishda xato:", err);
    res.status(500).json({ success: false, message: "Fayl xatosi" });
  }
});

// Scanner hook
let syncedProducts = [];

app.post('/api/scanner-hook', async (req, res) => {
  const { code } = req.body;
  console.log("📦 Scanner so'rovi:", req.body);

  if (!code || typeof code !== "string") {
    return res.status(400).json({ message: '❌ Barcode/QR code kerak' });
  }

  const cleanedCode = String(code).trim();
  const log = `[${new Date().toISOString()}] Barcode: ${cleanedCode}\n`;
  
  try {
    fs.appendFileSync('scanner.log', log);
  } catch (err) {
    console.error("❌ Log faylga yozishda xato:", err);
  }

  try {
    let product = syncedProducts.find(p => p.barcode === cleanedCode);

    if (!product) {
      const categoriesDir = path.join(__dirname, 'public', 'categories');
      if (fs.existsSync(categoriesDir)) {
        const categoryFiles = fs.readdirSync(categoriesDir).filter(f => f.endsWith('.json'));
        for (const file of categoryFiles) {
          const filePath = path.join(categoriesDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const products = JSON.parse(raw);
            const found = products.find(p => p.barcode === cleanedCode);
            if (found) {
              product = found;
              break;
            }
          } catch (err) {
            console.error(`❌ ${file} o'qishda xato:`, err);
          }
        }
      }
    }

    if (!product) {
      const mxikPath = path.join(__dirname, 'public', 'mxik_codes.json');
      if (fs.existsSync(mxikPath)) {
        try {
          const raw = fs.readFileSync(mxikPath, 'utf-8');
          const mxikProducts = JSON.parse(raw);
          product = mxikProducts.find(p => p.barcode === cleanedCode);
        } catch (err) {
          console.error("❌ MXIK faylni o'qishda xato:", err);
        }
      }
    }

    if (!product) {
      console.warn("❌ Mahsulot topilmadi:", cleanedCode);
      const fallbackProduct = {
        barcode: cleanedCode,
        name: '',
        price: 0,
        category: '',
        unit: '',
        error: true
      };
      io.emit('productScanned', fallbackProduct);
      return res.status(200).json({
        message: '❌ Mahsulot topilmadi',
        product: fallbackProduct
      });
    }

    console.log("✅ Mahsulot topildi:", product.name);
    io.emit('productScanned', product);
    return res.status(200).json({
      message: '✅ Mahsulot scanner sahifaga uzatildi',
      product
    });

  } catch (err) {
    console.error('❌ Webhook xatosi:', err);
    return res.status(500).json({ message: 'Server xatosi' });
  }
});

// Sotuvni saqlash
app.post("/api/save-sale", async (req, res) => {
  const { login, name, barcode, quantity, price } = req.body;

  if (!login || !barcode || !name || !quantity || !price) {
    console.warn("⚠️ Ma'lumotlar to'liq emas:", req.body);
    return res.status(400).json({ message: "❌ Sotuv ma'lumotlari to'liq emas" });
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    const userDir = path.join(__dirname, "login", login);
    const jsonFilePath = path.join(userDir, `${login}.json`);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    let data = {};
    if (fs.existsSync(jsonFilePath)) {
      try {
        const raw = fs.readFileSync(jsonFilePath, "utf-8");
        data = JSON.parse(raw);
      } catch (err) {
        console.warn("⚠️ Faylni o'qishda xatolik:", err.message);
        data = {};
      }
    }

    if (!data[today]) data[today] = [];

    const existing = data[today].find(item => item.barcode === barcode);

    if (existing) {
      existing.quantity += quantity;
      existing.total = existing.quantity * existing.price;
    } else {
      data[today].push({
        name,
        barcode,
        quantity,
        price,
        total: quantity * price
      });
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), "utf-8");

    console.log(`✅ Faylga yozildi: ${jsonFilePath}`);
    res.json({ message: "✅ Sotuv saqlandi", saved: true });
  } catch (err) {
    console.error("❌ Faylga yozishda xatolik:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Mahsulotlarni olish
app.get("/api/products/:login", (req, res) => {
  const login = req.params.login;
  const jsonFilePath = path.join(__dirname, "login", login, `${login}.json`);

  if (!fs.existsSync(jsonFilePath)) {
    return res.status(404).json({ message: "❌ Fayl topilmadi" });
  }

  try {
    const raw = fs.readFileSync(jsonFilePath, "utf-8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      const merged = {};
      data.forEach(entry => {
        if (entry.products) {
          Object.entries(entry.products).forEach(([date, items]) => {
            if (!merged[date]) merged[date] = [];
            merged[date].push(...items);
          });
        }
      });
      return res.json(merged);
    }

    res.json(data);
  } catch (err) {
    console.error("❌ JSON faylni o'qishda xatolik:", err);
    res.status(500).json({ message: "❌ Faylni o'qib bo'lmadi" });
  }
});

// Narxni yangilash
app.post("/api/update-price", (req, res) => {
  const { login, barcode, price } = req.body;
  
  if (!login || !barcode || !price) {
    return res.status(400).json({ success: false, message: "Ma'lumot to'liq emas" });
  }

  const filePath = path.join(__dirname, "login", login, `${login}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Fayl topilmadi" });
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    let updated = false;

    Object.entries(data).forEach(([date, products]) => {
      if (Array.isArray(products)) {
        products.forEach(item => {
          if (item.barcode === barcode) {
            item.price = price;
            item.total = item.quantity * price;
            updated = true;
          }
        });
      }
    });

    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return res.json({ success: true });
    } else {
      return res.status(404).json({ success: false, message: "Mahsulot topilmadi" });
    }
  } catch (err) {
    console.error("❌ JSON faylni o'qishda xatolik:", err);
    res.status(500).json({ success: false, message: "Ichki xatolik" });
  }
});

// Admin login
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { login, password } = req.body;

  const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    return res.status(500).json({ message: "Server konfiguratsiyasi xato" });
  }

  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    return res.json({ message: "Kirish muvaffaqiyatli" });
  } else {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri!" });
  }
});

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

  if (!login) {
    return res.status(400).json({ message: "Login kerak" });
  }

  try {
    const user = await User.findOneAndUpdate(
      { login },
      { blocked: false, active: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });
    }

    const socketIds = userSockets[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => {
        io.to(id).emit('userActivated');
      });
    }

    res.json({ message: `${login} blokdan chiqarildi va aktiv qilindi.` });
  } catch (err) {
    console.error("❌ Activate qilish xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Logout
app.post('/api/logout', async (req, res) => {
  try {
    const { login, deviceId } = req.body;

    if (!login || !deviceId) {
      return res.status(400).json({ message: 'Login va deviceId kerak' });
    }

    const user = await User.findOne({ login });
    if (!user) {
      return res.status(404).json({ message: 'Foydalanuvchi topilmadi.' });
    }

    if (user.desktopDeviceId === deviceId) {
      user.desktopDeviceId = null;
    }
    if (user.mobileDeviceId === deviceId) {
      user.mobileDeviceId = null;
    }

    user.active = false;
    await user.save();

    return res.status(200).json({ 
      success: true, 
      message: 'Logout muvaffaqiyatli!' 
    });
  } catch (err) {
    console.error('❌ Logout xatoligi:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Server xatoligi' 
    });
  }
});

// Foydalanuvchini bloklash
app.post('/api/block-user', async (req, res) => {
  const { login } = req.body;

  if (!login) {
    return res.status(400).json({ message: "Login kerak" });
  }

  try {
    const user = await User.findOneAndUpdate(
      { login },
      { blocked: true, active: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });
    }

    const socketIds = userSockets[login];
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(id => {
        io.to(id).emit('forceLogout');
      });
    }

    res.json({ message: `${login} bloklandi.` });
  } catch (err) {
    console.error("❌ Block qilish xatosi:", err);
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

  if (!login || !deviceId) {
    return res.status(400).json({ 
      active: false, 
      reason: "Login va deviceId kerak" 
    });
  }

  try {
    const user = await User.findOne({ login });

    if (!user) {
      return res.json({ 
        active: false, 
        reason: "Foydalanuvchi topilmadi" 
      });
    }

    if (user.blocked) {
      return res.json({ 
        active: false, 
        reason: "Siz bloklangansiz!" 
      });
    }

    if (
      user.desktopDeviceId !== deviceId &&
      user.mobileDeviceId !== deviceId
    ) {
      return res.json({ 
        active: false, 
        reason: "Noto'g'ri sessiya!" 
      });
    }

    return res.json({ active: user.active });
  } catch (err) {
    console.error("❌ Status tekshirish xatosi:", err);
    res.status(500).json({ 
      active: false, 
      reason: "Server xatosi" 
    });
  }
});

// Ro'yxatdan o'tish
app.post('/api/register', async (req, res) => {
  const { login, password, role } = req.body;

  if (!login || !password) {
    return res.status(400).json({ message: 'Login va parol majburiy' });
  }

  try {
    const existingUser = await User.findOne({ login });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu login allaqachon mavjud' });
    }

    const newUser = new User({
      login,
      password,
      role: role || 'cashier'
    });

    await newUser.save();
    res.status(201).json({
      message: '✅ Foydalanuvchi yaratildi',
      user: {
        login: newUser.login,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error('❌ Ro\'yxatdan o\'tishda xato:', err);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// Mahsulotlarni sinxronlash
app.post("/api/sync-products", (req, res) => {
  if (!req.body.products || !Array.isArray(req.body.products)) {
    return res.status(400).json({ message: "❌ Mahsulotlar massivi kerak" });
  }

  syncedProducts = req.body.products;
  console.log(`📦 ${syncedProducts.length} ta mahsulot sinxronlandi`);
  res.json({ 
    message: "✅ Sinxronlash tugadi",
    count: syncedProducts.length 
  });
});

// Loginni tasdiqlash
app.post("/api/confirm-login", async (req, res) => {
  const { login, deviceId, confirm } = req.body;

  if (!login || !deviceId) {
    return res.status(400).json({ message: "❌ Login va deviceId kerak" });
  }

  try {
    const user = await User.findOne({ login });
    if (!user) {
      return res.status(404).json({ message: "❌ Foydalanuvchi topilmadi" });
    }

    if (!confirm) {
      return res.json({ 
        message: "🚫 Qurilma rad etildi, kirish bekor qilindi." 
      });
    }

    const oldDeviceIds = [];
    if (user.mobileDeviceId && user.mobileDeviceId !== deviceId) {
      oldDeviceIds.push(user.mobileDeviceId);
    }
    if (user.desktopDeviceId && user.desktopDeviceId !== deviceId) {
      oldDeviceIds.push(user.desktopDeviceId);
    }

    // User-Agent orqali qurilma turini aniqlash
    const userAgent = req.headers['user-agent'] || "";
    if (/mobile/i.test(userAgent)) {
      user.mobileDeviceId = deviceId;
    } else {
      user.desktopDeviceId = deviceId;
    }
    
    user.active = true;
    await user.save();

    // Eski qurilmalarga xabar yuborish
    oldDeviceIds.forEach(oldId => {
      const socketIds = userSockets[login] || [];
      socketIds.forEach(sid => {
        io.to(sid).emit("requestDeviceConfirm", { 
          login, 
          newDeviceId: deviceId 
        });
      });
    });

    res.json({ message: "✅ Qurilma tasdiqlandi va sessiya o'tkazildi." });

  } catch (err) {
    console.error("❌ confirm-login xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================
// 🖨️ ESC/POS PRINTER LISTENER
// ====================================
const escposServer = net.createServer((printerSocket) => {
  console.log('🔌 Printer ulandi:', printerSocket.remoteAddress);

  printerSocket.on('data', (data) => {
    try {
      const { parse } = require('escpos-parser');
      const parsed = parse(data);
      console.log('🧾 Printerdan kelgan signal:', JSON.stringify(parsed, null, 2));

      const textLines = parsed
        .filter(item => item.type === 'text')
        .map(item => item.value);

      const previewText = textLines.join('\n');
      console.log('🧾 Chek preview:', previewText);
      io.emit('chekPreview', previewText);
    } catch (err) {
      console.error('ESC/POS parse xatosi:', err);
    }
  });

  printerSocket.on('end', () => {
    console.log('❌ Printer uzildi:', printerSocket.remoteAddress);
  });

  printerSocket.on('error', (err) => {
    console.error('❌ Printer socket xatosi:', err);
  });
});

escposServer.listen(9100, () => {
  console.log('🟢 ESC/POS listener port 9100 da ishlayapti');
});

// ====================================
// 🌐 CATCH-ALL ROUTE (SPA uchun)
// ====================================
app.get('*', (req, res, next) => {
  // Agar API route bo'lsa, keyingisiga o'tkazish
  if (req.path.startsWith('/api')) {
    return next();
  }
  
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

// 404 handler
app.use((req, res, next) => {
  if (!res.headersSent) {
    res.status(404).json({ 
      message: 'API endpoint topilmadi',
      path: req.path 
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server xatosi:', err.stack);
  
  // CSRF xatosi
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ 
      message: 'CSRF token xato yoki mavjud emas' 
    });
  }
  
  // CORS xatosi
  if (err.message === 'CORS policy violation') {
    return res.status(403).json({ 
      message: 'CORS: Origin ruxsat berilmagan' 
    });
  }

  if (!res.headersSent) {
    res.status(500).json({ 
      message: 'Server xatosi',
      error: config.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ====================================
// 🚀 SERVER LAUNCH
// ====================================
const PORT = config.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║   ✅ SERVER ISHGA TUSHDI               ║
║   🌐 Port: ${PORT}                      ║
║   🔧 Muhit: ${config.NODE_ENV}         ║
║   🔌 Socket.IO: Faol                   ║
║   🖨️  ESC/POS: Port 9100               ║
╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal qabul qilindi, server to\'xtatilmoqda...');
  server.close(() => {
    console.log('✅ Server yopildi');
    process.exit(0);
  });
});

module.exports = { io, server };