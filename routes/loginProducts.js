const express = require("express");
const mongoose = require("mongoose");
const verifyToken = require('../middleware/verifyToken');
const AuditService = require('../services/auditService');
const User = require('../models/User');
const ShopType = require('../models/ShopType');

module.exports = (csrfProtection) => {
  const router = express.Router();

// ====================================================================
// 🛡️ SANITIZERS
// ====================================================================
function sanitizeLogin(value) {
  if (!value || typeof value !== 'string') throw new Error("login noto'g'ri");
  // ✅ Collection nomiga tushadigan login — faqat xavfsiz belgilar
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(value)) throw new Error("login formati noto'g'ri");
  return value.toLowerCase().trim();
}

function sanitizeBarcode(value) {
  if (!value || typeof value !== 'string') throw new Error("barcode noto'g'ri");
  if (!/^[a-zA-Z0-9\-_]{1,64}$/.test(value)) throw new Error("barcode formati noto'g'ri");
  return value.trim();
}

function sanitizeNumber(value, field = 'field') {
  const num = Number(value);
  if (isNaN(num) || num < 0) throw new Error(`${field} musbat son bo'lishi kerak`);
  return num;
}

function sanitizeCategory(value) {
  if (!value || typeof value !== 'string') return '';
  if (/\$/.test(value)) throw new Error("category da noto'g'ri belgi");
  return value.trim().slice(0, 64);
}

function sanitizeName(value) {
  if (!value || typeof value !== 'string') return 'Nomsiz mahsulot';
  if (/\$/.test(value)) throw new Error("name da noto'g'ri belgi");
  return value.trim().slice(0, 128);
}

// ====================================================================
// 🔹 Dinamik model — faqat sanitizatsiyadan o'tgan login
// ====================================================================
function getProductModel(safeLogin) {
  const collectionName = `products_${safeLogin}`;
  const modelName = `Product_${safeLogin}`;

  if (mongoose.models[modelName]) return mongoose.models[modelName];

  const schema = new mongoose.Schema({
    name:      String,
    barcode:   String,
    basePrice: Number,
    price:     Number,
    category:  String,
    quantity:  Number,
    sold:      { type: Number, default: 0 }
  });

  return mongoose.model(modelName, schema, collectionName);
}

// ====================================================================
// GET /products/:login
// ====================================================================
router.get("/products/:login", verifyToken, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    
    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const user = await User.findOne({ login: safeLogin });
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi" });

    let effectiveCategories = user.shopCategories || [];
    if (effectiveCategories.length === 0 && user.shopType) {
      const typeData = await ShopType.findOne({ value: user.shopType });
      if (typeData) {
        effectiveCategories = typeData.categories;
      }
    }

    const Product = getProductModel(safeLogin);
    
    // 🛡️ Agar hech qanday kategoriya biriktirilmagan bo'lsa, mahsulotlar ko'rinmaydi
    if (!effectiveCategories || effectiveCategories.length === 0) {
      return res.json([]);
    }

    const products = await Product.find({ 
      category: { $in: effectiveCategories } 
    });
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /sync-products/:login
// ====================================================================
router.post("/sync-products/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    
    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const { products } = req.body;
  if (!Array.isArray(products)) {
    return res.status(400).json({ message: "Noto'g'ri format" });
  }

  try {
    const Product = getProductModel(safeLogin);
    
    // Sync logic (replace/upsert) - log it
    await AuditService.logUserAction({
      login: req.user.login,
      action: 'SYNC_PRODUCTS',
      status: 'SUCCESS',
      details: { count: products.length }
    });

    for (const p of products) {
      let safeBarcode, safeName, safePrice, safeBasePrice, safeQty, safeCategory;
      try {
        safeBarcode  = sanitizeBarcode(p.barcode);
        safeName     = sanitizeName(p.name);
        safePrice    = sanitizeNumber(p.price, 'price');
        safeBasePrice= sanitizeNumber(p.basePrice, 'basePrice');
        safeQty      = sanitizeNumber(p.quantity, 'quantity');
        safeCategory = sanitizeCategory(p.category);
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }

      await Product.updateOne(
        { barcode: { $eq: safeBarcode } },
        {
          $set: {
            name:      safeName,
            price:     safePrice,
            basePrice: safeBasePrice,
            quantity:  safeQty,
            category:  safeCategory
          },
          $setOnInsert: { sold: sanitizeNumber(p.sold || 0, 'sold') }
        },
        { upsert: true }
      );

      // 🏷️ Kategoriya userda va ShopType da borligini tekshirish (Sync paytida)
      if (safeCategory) {
        const user = await User.findOne({ login: safeLogin });
        if (user) {
          if (!user.shopCategories.includes(safeCategory)) {
            await User.updateOne(
              { login: safeLogin },
              { $addToSet: { shopCategories: safeCategory } }
            );
          }
          if (user.shopType) {
            await ShopType.updateOne(
              { value: user.shopType },
              { $addToSet: { categories: safeCategory } }
            );
          }
        }
      }
    }

    res.json({ message: "✅ Sinxronlash muvaffaqiyatli" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /update-price/:login
// ====================================================================
router.post("/update-price/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin, safeBarcode, safePrice;
  try {
    safeLogin   = sanitizeLogin(req.params.login);

    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    safeBarcode = sanitizeBarcode(req.body.barcode);
    safePrice   = sanitizeNumber(req.body.newPrice, 'newPrice');
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const Product = getProductModel(safeLogin);
    await Product.updateOne(
      { barcode: { $eq: safeBarcode } },
      { $set: { price: safePrice } }
    );
    res.json({ message: "✅ Narx yangilandi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /update-base-price/:login
// ====================================================================
router.post("/update-base-price/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin, safeBarcode, safeBasePrice;
  try {
    safeLogin     = sanitizeLogin(req.params.login);

    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    safeBarcode   = sanitizeBarcode(req.body.barcode);
    safeBasePrice = sanitizeNumber(req.body.newBasePrice, 'newBasePrice');
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const Product = getProductModel(safeLogin);

    const updated = await Product.updateOne(
      { barcode: { $eq: safeBarcode } },
      { $set: { basePrice: safeBasePrice } }
    );

    if (updated.matchedCount === 0) {
      return res.status(404).json({ message: "Mahsulot topilmadi" });
    }

    const updatedProduct = await Product.findOne({ barcode: { $eq: safeBarcode } });
    res.json({ message: "✅ Ulgurji narx yangilandi", product: updatedProduct });
  } catch (err) {
    console.error("❌ Base price update xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /delete-product/:login
// ====================================================================
router.post("/delete-product/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin, safeBarcode;
  try {
    safeLogin   = sanitizeLogin(req.params.login);

    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    safeBarcode = sanitizeBarcode(req.body.barcode);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const Product = getProductModel(safeLogin);
    const deleted = await Product.deleteOne({ barcode: { $eq: safeBarcode } });

    if (deleted.deletedCount === 0) {
      return res.status(404).json({ message: "Mahsulot topilmadi" });
    }
    res.json({ message: "✅ Mahsulot o'chirildi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /update-or-add-user-product
// ====================================================================
router.post("/update-or-add-user-product", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin, safeBarcode, safeName, safePrice, safeBasePrice, safeQty, safeCategory;
  try {
    safeLogin     = sanitizeLogin(req.body.login);

    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    safeBarcode   = sanitizeBarcode(req.body.barcode);
    safeName      = sanitizeName(req.body.name);
    safePrice     = sanitizeNumber(req.body.price     ?? 0, 'price');
    safeBasePrice = sanitizeNumber(req.body.basePrice ?? 0, 'basePrice');
    safeQty       = sanitizeNumber(req.body.quantity  ?? 0, 'quantity');
    safeCategory  = sanitizeCategory(req.body.category ?? '');
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const Product = getProductModel(safeLogin);

    const updated = await Product.findOneAndUpdate(
      { barcode: { $eq: safeBarcode } },
      {
        $set: {
          name:      safeName,
          price:     safePrice,
          basePrice: safeBasePrice,
          category:  safeCategory,
          quantity:  safeQty
        }
      },
      { upsert: true, new: true }
    );

    // 🏷️ YANGI: Kategoriya userda va ShopType da borligini tekshirish
    if (safeCategory) {
      const user = await User.findOne({ login: safeLogin });
      if (user) {
        if (!user.shopCategories.includes(safeCategory)) {
          await User.updateOne(
            { login: safeLogin },
            { $addToSet: { shopCategories: safeCategory } }
          );
        }
        if (user.shopType) {
          await ShopType.updateOne(
            { value: user.shopType },
            { $addToSet: { categories: safeCategory } }
          );
        }
      }
    }

    res.json({
      success: true,
      message: "Mahsulot saqlandi",
      product: updated
    });
  } catch (err) {
    console.error("/update-or-add-user-product xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ====================================================================
// POST /ai-query/:login
// ====================================================================
router.post("/ai-query/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);

    // 🛡️ A01: Broken Access Control
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }


  const query = req.body.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ message: "query majburiy" });
  }

  // ✅ query faqat o'qiladi, DB'ga tushmaydi
  const safeQuery = query.toLowerCase().trim();

  try {
    const Product = getProductModel(safeLogin);

    if (safeQuery.includes("mahsulotlar")) {
      const products = await Product.find({}).lean();
      return res.json({ type: 'products', data: products });
    }

    if (safeQuery.includes("sotilgan")) {
      const products = await Product.find({ sold: { $gt: 0 } }).lean();
      return res.json({ type: 'sold', data: products });
    }

    return res.json({ type: 'text', data: "Savolingizga mos ma'lumot topilmadi." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

  return router;
};