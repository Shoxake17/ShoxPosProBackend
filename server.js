// server.js - ShoxPosPro Backend (Production Ready)
'use strict';

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');

// Konfiguratsiya va Baza
const config = require('./config');
const connectDB = require('./config/db');
const { initIO } = require('./socket');



// Middlewarelar
const verifyToken = require('./middleware/verifyToken');
const apiLimiter = require('./middleware/apiRateLimit');

// Ma'lumotlar bazasiga ulanish
connectDB();

const app = express();
const server = http.createServer(app);

// Proxy ortida turganda (Nginx/Heroku) IP ni to'g'ri aniqlash uchun
app.set('trust proxy', 1);

// ====================================
// 🔒 CORS SOZLAMALARI
// ====================================
const allowedOrigins = [
    'https://pos.ondex.uz',
    'https://pos.ondex.uz',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:8081',
    'http://localhost:19006',
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS policy violation'));
        }
    },
    credentials: true, // HttpOnly Cookie ishlashi uchun shart
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'CSRF-Token', 'X-CSRF-Token', 'X-Requested-With'],
    exposedHeaders: ['CSRF-Token', 'X-CSRF-Token'],
}));

// HELMET (XAVFSIZLIK HEADERLARI)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:", "blob:", "res.cloudinary.com"],
            connectSrc: [
                "'self'",
                'ws:', 'wss:',
                'http://localhost:3000',
                'http://localhost:3001',
                'http://127.0.0.1:3000',
                'https://cdn.jsdelivr.net',
                'https://freeipapi.com',
                'https://free.freeipapi.com',
                'https://ipapi.co',
                'https://flagcdn.com',
                'https://cbu.uz',
                'https://generativelanguage.googleapis.com',
            ],
            fontSrc: ["'self'", 'data:'],
            workerSrc: ["'self'", 'blob:', 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false, // Ba'zi rasm resurslari uchun
}));

// ====================================
// 📦 ASOSIY MIDDLEWARE'LAR (TARTIB MUHIM)
// ====================================
// Qurt buyurtmasi webhook'i imzosi XOM tana ustida hisoblanadi: faqat shu yo'l uchun saqlanadi.
app.use(express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
        if (req.originalUrl && req.originalUrl.startsWith('/api/qurt-orders/webhook')) req.rawBody = buf;
    },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(config.COOKIE_SECRET)); // CSRF dan oldin turishi shart

// ====================================
// 🔒 CSRF HIMOYA
// ====================================
const csrfProtection = csrf({
    cookie: {
        key: '_csrf',
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    },
    value: (req) => {
        return req.headers['csrf-token'] ||
               req.headers['x-csrf-token'] ||
               req.headers['xsrf-token'] ||
               req.headers['x-xsrf-token'] ||
               (req.body && req.body._csrf);
    }
});

// Rate Limit
const csrfLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ message: 'Juda ko\'p so\'rov. Keyinroq urinib ko\'ring.' });
    },
});

// Global limitlarni qo'llash
app.use('/api', apiLimiter);

// Do'kon kategoriyasi (qurt va h.k.) bo'yicha API cheklovi: marshrutlardan OLDIN,
// shunda har qanday yangi marshrut ham avtomatik qo'riqlanadi (ro'yxatda yo'q = yopiq).
app.use('/api', require('./services/storeAccess').storeCategoryGuard);

// ====================================
// 🔑 CSRF TOKEN ENDPOINT
// ====================================
app.get('/api/csrf-token', csrfLimiter, csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

// Static fayllar
app.use(express.static(path.join(__dirname, 'public', 'dist')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// ====================================
// 🛣️ ROUTERLARNI YUKLASH
// ====================================
const authRouter = require('./routes/auth')(csrfProtection);
const productRoutes = require('./routes/productRoutes')(csrfProtection);
const loginProductRoutes = require('./routes/loginProducts')(csrfProtection);
const scanProductsRouter = require('./routes/scanProducts')(csrfProtection);
const debtsRoutes = require('./routes/debts')(csrfProtection);
const salesRoutes = require('./routes/salesRoutes')(csrfProtection);
const ondexAuthRouter = require('./routes/ondexAuth')(csrfProtection);
const storeOrdersRoutes = require('./routes/storeOrders')(csrfProtection);
const pharmacyRoutes = require('./routes/pharmacyRoutes')(csrfProtection);
const { router: metricsRouter } = require('./routes/metrics');
// Socket ulanishi talab qiladigan routerlar
const io = socketIo(server, {
    path: '/socket.io/',
    cors: { origin: allowedOrigins, credentials: true }
});
initIO(io);

// OLIB TASHLANDI (OnDex Merchant web, ADR-000/002): AI, ichki chat, admin, obuna,
// Telegram userbot, server printer tekshiruvi — ular OnDex markaziy servislariga o'tdi.
const userRoutes = require('./routes/userRoutes')(io);
const pushRoutes = require('./routes/pushRoutes');

// API Endpointlarni bog'lash
app.use('/metrics', metricsRouter);
app.use('/api/users', verifyToken, userRoutes); // Auth middleware bilan
app.use('/api/push', verifyToken, pushRoutes);

app.use('/api', ondexAuthRouter);
app.use('/api', authRouter);
if (!require('./services/ondexSso').isConfigured()) {
    console.warn('⚠️  OnDex orqali kirish SOZLANMAGAN (ONDEX_API_URL, SSO_CLIENT_SECRET, SSO_REDIRECT_URI) — hech kim kira olmaydi.');
}
app.use('/api', storeOrdersRoutes);
app.use('/api/products', loginProductRoutes);
app.use('/api/products', productRoutes);
app.use('/api', scanProductsRouter);
app.use('/api', debtsRoutes);
app.use('/api', salesRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
// ====================================
// 🌐 CATCH-ALL (SPA SUPPORT)
// ====================================
// API so'rovlaridan boshqa barcha so'rovlarni React/Vite index.html ga yo'naltirish
app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ message: 'API endpoint topilmadi' });
    }
    const indexPath = path.join(__dirname, 'public', 'dist', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend fayllari topilmadi. Iltimos build qiling.');
    }
});

// ====================================
// ❌ XATOLIKLARNI BOSHQARISH
// ====================================
app.use((err, req, res, next) => {
    if (config.NODE_ENV === 'development') {
        console.error('❌ Server xatosi:', err.stack);
    }

    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({
            success: false,
            message: 'Xavfsiz sessiya muddati tugagan. Iltimos, sahifani yangilang.'
        });
    }

    if (err.message === 'CORS policy violation') {
        return res.status(403).json({ success: false, message: 'CORS: Ruxsat etilmagan kirish.' });
    }

    res.status(err.status || 500).json({
        success: false,
        message: 'Serverda xatolik yuz berdi.',
        error: config.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ====================================
// 🚀 SERVER START
// ====================================
const PORT = config.PORT || 3000;
// Qurt mahsulotlari: OnDex'ga yuborilmay qolganlarini davriy qayta yuboradi.
require('./services/qurtSync').startRetryLoop();

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
✅ SHOXPOSPRO SERVER ISHGA TUSHDI
🌐 Port: ${PORT}
🔧 Muhit: ${config.NODE_ENV}
🔐 Xavfsizlik: CORS, Helmet, CSRF faol
    `);
});

// SIGTERM - Graceful shutdown
process.on('SIGTERM', () => {
    console.log("👋 Server to'xtatilmoqda...");
    server.close(() => {
        process.exit(0);
    });
});

module.exports = { app, server, io };