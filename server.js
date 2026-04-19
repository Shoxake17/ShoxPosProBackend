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
    'https://shoxpospro.uz',
    'https://www.shoxpospro.uz',
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
                'http://localhost:4000', // ShoxPay Backend ulanishi uchun
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
app.use(express.json({ limit: '2mb' }));
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
const aiRoutes = require('./routes/aiRoutes')(csrfProtection);
const debtsRoutes = require('./routes/debts')(csrfProtection);
const salesRoutes = require('./routes/salesRoutes')(csrfProtection);
const biometricRouter = require('./routes/biometricRoutes')(csrfProtection);
const authenticatorRouter = require('./routes/authenticatorRoutes')(csrfProtection);
const cashbackProxy = require('./routes/cashbackProxy')(csrfProtection);
const adminRoutes = require('./routes/adminRoutes')(csrfProtection);
const pharmacyRoutes = require('./routes/pharmacyRoutes')(csrfProtection);
const telegramRoutes = require('./routes/telegramRoutes')(csrfProtection);
const { router: metricsRouter } = require('./routes/metrics');
// Socket ulanishi talab qiladigan routerlar
const io = socketIo(server, {
    path: '/socket.io/',
    cors: { origin: allowedOrigins, credentials: true }
});
initIO(io);

const printerRoutes = require('./routes/printerRoutes')(io);
const userRoutes = require('./routes/userRoutes')(io);
const userChatRoutes = require('./routes/userChatRoutes')(csrfProtection, io);
const pushRoutes = require('./routes/pushRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');

// API Endpointlarni bog'lash
app.use('/metrics', metricsRouter);
app.use('/api/users', verifyToken, userRoutes); // Auth middleware bilan
app.use('/api/push', verifyToken, pushRoutes);
app.use('/api/cashback', verifyToken, cashbackProxy);

app.use('/api', authRouter);
app.use('/api', biometricRouter);
app.use('/api/google-auth', authenticatorRouter);
app.use('/api', aiRoutes);
app.use('/api/chat', userChatRoutes.router);
app.use('/api/printer', printerRoutes);
app.use('/api/products', loginProductRoutes);
app.use('/api/products', productRoutes);
app.use('/api', scanProductsRouter);
app.use('/api', debtsRoutes);
app.use('/api', salesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api', telegramRoutes);
// ====================================
// 🌐 CATCH-ALL (SPA SUPPORT)
// ====================================
// API so'rovlaridan boshqa barcha so'rovlarni React/Vite index.html ga yo'naltirish
app.get('*', (req, res) => {
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