const express = require('express');
const client = require('prom-client');

const router = express.Router();

// 1. Standart metrikalarni yoqish (CPU, Memory, Event Loop delay)
const register = client.register;
client.collectDefaultMetrics({
    register,
    prefix: 'shoxpos_node_', // Barcha standart metrikalarga prefiks beradi
});

// 2. HTTP so'rovlar davomiyligi (Siz yozgan kod, biroz optimallashgan)
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP soʻrovlarining davomiyligi (sekundda)',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5] // Javob berish vaqti chegaralari
});

// 3. ACTIVE USERS: Hozirda ishlov berilayotgan so'rovlar
const activeRequests = new client.Gauge({
    name: 'shoxpos_active_requests_count',
    help: 'Hozirgi vaqtda serverda ishlanayotgan soʻrovlar soni'
});

// 4. BUSINESS METRIC: Savdolar soni (ShoxPosPro uchun)
const totalSales = new client.Counter({
    name: 'shoxpos_sales_total',
    help: 'Jami amalga oshirilgan savdolar soni',
    labelNames: ['payment_type'] // cash, card, shoxpay
});

// 5. BUSINESS METRIC: Keshbek miqdori (ShoxPay uchun)
const totalCashbackGiven = new client.Counter({
    name: 'shoxpay_cashback_given_total',
    help: 'Mijozlarga berilgan jami keshbek miqdori'
});

// Middleware: Har bir so'rovni o'lchash
router.use((req, res, next) => {
    activeRequests.inc(); // So'rov boshlandi
    const end = httpRequestDuration.startTimer();

    res.on('finish', () => {
        activeRequests.dec(); // So'rov tugadi
        end({ 
            method: req.method, 
            route: req.baseUrl + (req.route ? req.route.path : req.path), 
            status_code: res.statusCode 
        });
    });
    next();
});

// Metrikalarni chiqarish endpointi
router.get('/', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (ex) {
        res.status(500).end(ex);
    }
});

// Tashqaridan foydalanish uchun eksport qilish
module.exports = {
    router,
    totalSales,
    totalCashbackGiven
};