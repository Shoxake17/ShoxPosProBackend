const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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
    soldAt: { type: Date, default: Date.now } 
  });

  return mongoose.model(modelName, schema, collectionName);
}

// ✅ Sotuvlarni saqlash - YANGILANGAN: Bir xil mahsulotlarni birlashtirib saqlash
router.post('/sell-product/:login', async (req, res) => {
  try {
    const { login } = req.params;
    const { sales } = req.body;

    console.log(`📥 ${login} uchun sotuv:`, {
      salesCount: sales?.length,
      sales
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

    for (const item of sales) {
      const { barcode, name, quantity, price, category, total } = item;

      if (!barcode || !name || typeof quantity !== "number") {
        return res.status(400).json({ 
          success: false,
          message: "Noto'g'ri ma'lumot formatida" 
        });
      }

      // 1️⃣ PRODUCTS-LOGIN: quantity kamayadi, sold oshadi
      const product = await Product.findOne({ barcode });
      
      if (product) {
        product.quantity = Math.max(0, product.quantity - quantity);
        product.sold = (product.sold || 0) + quantity;
        await product.save();
        console.log(`✅ Product yangilandi: ${name} (qoldiq: ${product.quantity})`);
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
        console.log(`✅ Yangi product yaratildi: ${name}`);
      }

      // 2️⃣ SALES-LOGIN: Bugungi sotuvni tekshirish
      const todayStart = new Date(currentDate.setHours(0, 0, 0, 0));
      const todayEnd = new Date(currentDate.setHours(23, 59, 59, 999));

      // Bugun shu barcode bilan sotuv bor yoki yo'q tekshirish
      const existingSale = await Sales.findOne({
        barcode: barcode,
        soldAt: { $gte: todayStart, $lte: todayEnd }
      });

      if (existingSale) {
        // Agar bugun sotilgan bo'lsa, sonini qo'shamiz
        existingSale.quantity += quantity;
        existingSale.total = existingSale.quantity * price;
        existingSale.soldAt = new Date(); // Vaqtni yangilaymiz
        await existingSale.save();
        
        savedSales.push(existingSale);
        console.log(`✅ Sale yangilandi: ${name} x${existingSale.quantity} (umumiy)`);
      } else {
        // Yangi sotuv yaratamiz
        const saleRecord = await Sales.create({
          barcode,
          name,
          quantity,
          price,
          basePrice: product?.basePrice || item.basePrice || 0,
          category: category || "",
          total: total || (price * quantity),
          soldAt: new Date()
        });

        savedSales.push(saleRecord);
        console.log(`✅ Yangi sale saqlandi: ${name} x${quantity}`);
      }
    }

    console.log(`🎉 ${login} uchun jami ${savedSales.length} ta sotuv saqlandi`);

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

// ✅ Sotuvlarni olish - sales-login papkadan
router.get('/sales/:login', async (req, res) => {
  try {
    const { login } = req.params;
    

    const Sales = getSalesModel(login);
    const reports = await Sales.find().sort({ soldAt: -1 }).lean();
    
    
    res.json(reports);

  } catch (err) {
    console.error('❌ Sotuvlarni yuklashda xato:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Sotuvlarni yuklashda xatolik yuz berdi' 
    });
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
    console.error('❌ Sana bo\'yicha sotuvlarni yuklashda xato:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ✅ Kategoriya bo'yicha statistika
router.get('/sales/:login/stats', async (req, res) => {
  try {
    const { login } = req.params;
    const Sales = getSalesModel(login);

    const stats = await Sales.aggregate([
      {
        $group: {
          _id: '$category',
          totalSales: { $sum: '$total' },
          totalQuantity: { $sum: '$quantity' },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalSales: -1 } }
    ]);

    res.json(stats);

  } catch (err) {
    console.error('❌ Statistikani yuklashda xato:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ✅ Sotuvni o'chirish
router.delete('/sales/:login/:id', async (req, res) => {
  try {
    const { login, id } = req.params;
    const Sales = getSalesModel(login);

    const deleted = await Sales.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'Sotuv topilmadi' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Sotuv o\'chirildi' 
    });

  } catch (err) {
    console.error('❌ Sotuvni o\'chirishda xato:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

module.exports = router;