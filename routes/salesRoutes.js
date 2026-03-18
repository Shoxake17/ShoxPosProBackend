const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
// 📈 Prometheus metrikalarini import qilamiz
const { totalSales, totalCashbackGiven } = require('./metrics'); 

// 🔹 Dinamik Product model
function getProductModel(login) {
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
    paymentMethod: { type: String, default: 'cash' }, // To'lov turi uchun maydon
    soldAt: { type: Date, default: Date.now } 
  });

  return mongoose.model(modelName, schema, collectionName);
}

// ✅ Sotuvlarni saqlash - Metrikalar bilan integratsiya qilingan
router.post('/sell-product/:login', async (req, res) => {
  try {
    const { login } = req.params;
    // To'lov turi va keshbek ma'lumotlarini body'dan olamiz
    const { sales, paymentMethod, cashbackAmount } = req.body;

    console.log(`📥 ${login} uchun sotuv:`, {
      salesCount: sales?.length,
      paymentMethod,
      cashbackAmount
    });

    if (!sales || !Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sales bo\'sh yoki noto\'g\'ri formatda'
      });
    }

    const Product = getProductModel(login);
    const Sales = getSalesModel(login);

    const savedSales = [];
    const currentDate = new Date();
    const pMethod = paymentMethod || 'cash'; // Default to'lov turi

    for (const item of sales) {
      const { barcode, name, quantity, price, category, total } = item;

      if (!barcode || !name || typeof quantity !== "number") {
        return res.status(400).json({ 
          success: false,
          message: "Noto'g'ri ma'lumot formatida" 
        });
      }

      // 1️⃣ PRODUCT yangilash
      const product = await Product.findOne({ barcode });
      
      if (product) {
        product.quantity = Math.max(0, product.quantity - quantity);
        product.sold = (product.sold || 0) + quantity;
        await product.save();
      } else {
        await Product.create({
          barcode,
          name,
          quantity: 0,
          sold: quantity,
          price: price || 0,
          basePrice: item.basePrice || 0,
          category: category || ""
        });
      }

      // 2️⃣ SALE saqlash (Bugungi sotuvni birlashtirish)
      const todayStart = new Date(currentDate.setHours(0, 0, 0, 0));
      const todayEnd = new Date(currentDate.setHours(23, 59, 59, 999));

      const existingSale = await Sales.findOne({
        barcode: barcode,
        paymentMethod: pMethod, // To'lov turi bo'yicha ajratish
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
          barcode,
          name,
          quantity,
          price,
          basePrice: product?.basePrice || item.basePrice || 0,
          category: category || "",
          total: total || (price * quantity),
          paymentMethod: pMethod,
          soldAt: new Date()
        });
        savedSales.push(saleRecord);
      }

      // 📈 PROMETHEUS: Har bir mahsulot savdosi uchun hisoblagichni oshirish
      totalSales.labels({ payment_type: pMethod }).inc();
    }

    // 💰 PROMETHEUS: Agar keshbek berilgan bo'lsam, summani qo'shish
    if (cashbackAmount && typeof cashbackAmount === 'number') {
      totalCashbackGiven.inc(cashbackAmount);
    }

    res.json({ 
      success: true,
      message: `${savedSales.length} ta mahsulot sotildi`,
      count: savedSales.length,
      sales: savedSales
    });

  } catch (err) {
    console.error("❌ Sell-product xatosi:", err);
    res.status(500).json({ 
      success: false,
      message: "Server xatosi",
      error: err.message
    });
  }
});

// ✅ Sotuvlarni olish
router.get('/sales/:login', async (req, res) => {
  try {
    const { login } = req.params;
    const Sales = getSalesModel(login);
    const reports = await Sales.find().sort({ soldAt: -1 }).lean();
    res.json(reports);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Sotuvlarni yuklashda xatolik' });
  }
});

// ✅ Sana bo'yicha sotuvlarni olish
router.get('/sales/:login/by-date', async (req, res) => {
  try {
    const { login } = req.params;
    const { startDate, endDate } = req.query;
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

// ✅ Kategoriya bo'yicha statistika
router.get('/sales/:login/stats', async (req, res) => {
  try {
    const { login } = req.params;
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

// ✅ Sotuvni o'chirish
router.delete('/sales/:login/:id', async (req, res) => {
  try {
    const { login, id } = req.params;
    const Sales = getSalesModel(login);
    const deleted = await Sales.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Sotuv topilmadi' });
    res.json({ success: true, message: 'Sotuv o\'chirildi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;