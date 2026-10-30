const express = require('express');
const client = require('prom-client');

const router = express.Router();

// 1. Standart metrikalarni yoqish
const register = client.register;
client.collectDefaultMetrics({
    register,
    prefix: 'shoxpos_node_',
});

// 2. HTTP so'rovlar davomiyligi
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP soʻrovlarining davomiyligi (sekundda)',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5]
});

// 3. ACTIVE USERS: Hozirda ishlov berilayotgan so'rovlar
const activeRequests = new client.Gauge({
    name: 'shoxpos_active_requests_count',
    help: 'Hozirgi vaqtda serverda ishlanayotgan soʻrovlar soni'
});

// 4. BUSINESS METRIC: Savdolar soni
const totalSales = new client.Counter({
    name: 'shoxpos_sales_total',
    help: 'Jami amalga oshirilgan savdolar soni',
    labelNames: ['payment_type', 'login'] 
});

// ==========================================
// 🚀 MUHIM: METRIKALARNI INITIALIZE QILISH
// Bu qism Grafanada "No Data" xatosini yo'qotadi
// ==========================================
totalSales.labels({ payment_type: 'cash' }).inc(0);
totalSales.labels({ payment_type: 'card' }).inc(0);
totalSales.labels({ payment_type: 'shoxpay' }).inc(0);
activeRequests.set(0);

// Middleware: Har bir so'rovni o'lchash
router.use((req, res, next) => {
    activeRequests.inc();
    const end = httpRequestDuration.startTimer();

    res.on('finish', () => {
        activeRequests.dec();
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

module.exports = {
    router,
    totalSales
};