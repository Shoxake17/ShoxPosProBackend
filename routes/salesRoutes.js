const express = require('express');
const mongoose = require('mongoose');
const verifyToken = require('../middleware/verifyToken');
const AuditService = require('../services/auditService');
const User = require('../models/User');
const ShopType = require('../models/ShopType');
const SalesBucket = require('../models/SalesBucket');
const zlib = require('zlib');

module.exports = (csrfProtection) => {
  const router = express.Router();

  // 📈 Prometheus metrikalarini import qilamiz
  const { totalSales, totalCashbackGiven } = require('./metrics'); 

// 🔹 Dinamik Product model
function getProductModel(login) {
  // 🛡️ A03: Input validation
  if (!/^[a-zA-Z0-9_-]+$/.test(login)) {
    throw new Error("Login formati noto'g'ri!");
  }
  const collectionName = `products_${login}`;
  const modelName = `Product_${login}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({
    name: String,
    barcode: String,
    basePrice: Number,
    price: Number,
    category: String,
    quantity: Number,
    sold: { type: Number, default: 0 }
  });
  return mongoose.model(modelName, schema, collectionName);
}

// 🔹 Dinamik Sales model
function getSalesModel(login) {
  const collectionName = `sales_${login}`;
  const modelName = `Sale_${login}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({
    barcode: String,
    name: String,
    quantity: Number,
    price: Number,
    basePrice: Number,
    category: String,
    total: Number,
    paymentMethod: { type: String, default: 'cash' },
    soldAt: { type: Date, default: Date.now } 
  });
  return mongoose.model(modelName, schema, collectionName);
}

// ✅ Sotuvlarni saqlash - To'liq Monitoring bilan
router.post('/sell-product/:login', verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login } = req.params;
    const { sales, paymentMethod, cashbackAmount } = req.body;

    // 🛡️ A01: Broken Access Control
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    if (!sales || !Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ success: false, message: 'Sales bo\'sh yoki noto\'g\'ri formatda' });
    }

    const Product = getProductModel(login);
    const Sales = getSalesModel(login);
    const savedSales = [];
    const currentDate = new Date();
    const pMethod = paymentMethod || 'cash';

    // Bucket uchun yig'iladigan massiv
    const bucketPayload = [];

    for (const item of sales) {
      const { barcode, name, quantity, price, category, total } = item;

      if (!barcode || !name || typeof quantity !== "number") {
        return res.status(400).json({ success: false, message: "Noto'g'ri ma'lumot formatida" });
      }

      // 1️⃣ PRODUCT yangilash
      const product = await Product.findOne({ barcode });
      if (product) {
        product.quantity = Math.max(0, product.quantity - quantity);
        product.sold = (product.sold || 0) + quantity;
        await product.save();
      } else {
        await Product.create({
          barcode, name, quantity: 0, sold: quantity,
          price: price || 0, basePrice: item.basePrice || 0, category: category || ""
        });
      }

      // 🏷️ YANGI: Kategoriya userda va ShopType da borligini tekshirish (Sotuv paytida)
      if (category) {
        const user = await User.findOne({ login: safeLogin });
        if (user) {
          if (!user.shopCategories.includes(category)) {
            await User.updateOne(
              { login: safeLogin },
              { $addToSet: { shopCategories: category } }
            );
          }
          if (user.shopType) {
            await ShopType.updateOne(
              { value: user.shopType },
              { $addToSet: { categories: category } }
            );
          }
        }
      }

      // 2️⃣ SALE saqlash
      const todayStart = new Date(currentDate.setHours(0, 0, 0, 0));
      const todayEnd = new Date(currentDate.setHours(23, 59, 59, 999));

      const existingSale = await Sales.findOne({
        barcode: barcode,
        paymentMethod: pMethod,
        soldAt: { $gte: todayStart, $lte: todayEnd }
      });

      if (existingSale) {
        existingSale.quantity += quantity;
        existingSale.total = existingSale.quantity * price;
        existingSale.soldAt = new Date();
        await existingSale.save();
        savedSales.push(existingSale);
      } else {
        const saleRecord = await Sales.create({
          barcode, name, quantity, price,
          basePrice: product?.basePrice || item.basePrice || 0,
          category: category || "",
          total: total || (price * quantity),
          paymentMethod: pMethod,
          soldAt: new Date()
        });
        savedSales.push(saleRecord);
      }

      // Bucketga yozish uchun tayyor ma'lumot
      bucketPayload.push({
        barcode, name,
        quantity, price,
        basePrice: (product?.basePrice || item.basePrice || 0),
        category: category || "",
        total: total || (price * quantity),
        paymentMethod: pMethod,
        soldAt: new Date()
      });

      // 📈 PROMETHEUS: Har bir mahsulot uchun login va to'lov turi bo'yicha hisoblash
      totalSales.labels({ 
        payment_type: pMethod, 
        login: login 
      }).inc();
    }

    // � Sotilganlar (Sotilgan.tsx) uchun: Bucket (gzip) ga saqlash
    // 7 kunlik bo'lib guruhlaymiz
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const bucketIndex = Math.floor(dayOfYear / 7);
    const periodStart = new Date(now.getFullYear(), 0, bucketIndex * 7 + 1);
    const periodEnd   = new Date(now.getFullYear(), 0, (bucketIndex + 1) * 7);
    periodStart.setHours(0, 0, 0, 0);
    periodEnd.setHours(23, 59, 59, 999);

    let bucket = await SalesBucket.findOne({ login: safeLogin, periodStart });
    let existing = [];
    if (bucket) {
      try {
        const decompressed = zlib.gunzipSync(bucket.data).toString('utf8');
        existing = JSON.parse(decompressed);
      } catch {
        existing = [];
      }
    }
    const merged = existing.concat(bucketPayload);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(merged), 'utf8'));

    if (bucket) {
      bucket.data = gz;
      bucket.periodEnd = periodEnd;
      await bucket.save();
    } else {
      await SalesBucket.create({
        login: safeLogin,
        periodStart,
        periodEnd,
        data: gz
      });
    }

    // �💰 KESHBEK MONITORINGI
    if (cashbackAmount && typeof cashbackAmount === 'number') {
      totalCashbackGiven.inc(cashbackAmount);
    }

    res.json({ 
      success: true,
      message: `${savedSales.length} ta mahsulot sotildi`,
      count: savedSales.length,
      sales: savedSales
    });

    // 📈 Audit log
    await AuditService.logUserAction({
      login: req.user.login,
      action: 'SELL_PRODUCT',
      status: 'SUCCESS',
      details: { count: savedSales.length, paymentMethod: pMethod }
    });

  } catch (err) {
    console.error("❌ Sell-product xatosi:", err);
    res.status(500).json({ success: false, message: "Server xatosi", error: err.message });
  }
});

// ✅ Sotuvlarni yuklash
router.get('/sales/:login', verifyToken, async (req, res) => {
  try {
    const { login } = req.params;
    
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    const Sales = getSalesModel(login);
    const reports = await Sales.find().sort({ soldAt: -1 }).lean();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Sotuvlarni yuklashda xatolik' });
  }
});

// 🔹 Sotilganlar (Sotilgan.tsx) uchun — bucketlardan o'qish
router.get('/sold-buckets/:login', verifyToken, async (req, res) => {
  try {
    const { login } = req.params;
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    const buckets = await SalesBucket.find({ login: safeLogin }).sort({ periodStart: -1 });
    const all = [];
    for (const b of buckets) {
      try {
        const json = zlib.gunzipSync(b.data).toString('utf8');
        const arr = JSON.parse(json);
        all.push(...arr);
      } catch {}
    }
    res.json(all);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Bucketlarni yuklashda xatolik' });
  }
});

router.get('/sold-buckets/:login/by-date', verifyToken, async (req, res) => {
  try {
    const { login } = req.params;
    const { startDate, endDate } = req.query;
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }
    const start = startDate ? new Date(startDate) : null;
    const end   = endDate   ? new Date(endDate)   : null;

    const buckets = await SalesBucket.find({ login: safeLogin }).sort({ periodStart: -1 });
    let filtered = [];
    for (const b of buckets) {
      try {
        const json = zlib.gunzipSync(b.data).toString('utf8');
        const arr = JSON.parse(json);
        for (const s of arr) {
          const d = new Date(s.soldAt);
          if (start && d < start) continue;
          if (end && d > end) continue;
          filtered.push(s);
        }
      } catch {}
    }
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Bucketlarni filtrlashda xatolik' });
  }
});

router.get('/sales/:login/by-date', verifyToken, async (req, res) => {
  try {
    const { login } = req.params;
    const { startDate, endDate } = req.query;

    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    const Sales = getSalesModel(login);
    const query = {};
    if (startDate || endDate) {
      query.soldAt = {};
      if (startDate) query.soldAt.$gte = new Date(startDate);
      if (endDate) query.soldAt.$lte = new Date(endDate);
    }
    const reports = await Sales.find(query).sort({ soldAt: -1 }).lean();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/sales/:login/stats', verifyToken, async (req, res) => {
  try {
    const { login } = req.params;

    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    const Sales = getSalesModel(login);
    const stats = await Sales.aggregate([
      { $group: { _id: '$category', totalSales: { $sum: '$total' }, totalQuantity: { $sum: '$quantity' }, count: { $sum: 1 } } },
      { $sort: { totalSales: -1 } }
    ]);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/sales/:login/:id', verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login, id } = req.params;

    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Ruxsat etilmagan!' });
    }

    const Sales = getSalesModel(login);
    const deleted = await Sales.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Sotuv topilmadi' });
    
    // 📈 Audit log
    await AuditService.logUserAction({
      login: req.user.login,
      action: 'DELETE_SALE',
      status: 'SUCCESS',
      details: { saleId: id }
    });

    res.json({ success: true, message: 'Sotuv o\'chirildi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

  return router;
};
