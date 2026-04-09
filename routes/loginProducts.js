const express = require("express");
const verifyToken = require('../middleware/verifyToken');
const AuditService = require('../services/auditService');
const User = require('../models/User');
const ShopType = require('../models/ShopType');
const Product = require('../models/Product');

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

    // 🛡️ Agar hech qanday kategoriya biriktirilmagan bo'lsa, mahsulotlar ko'rinmaydi
    if (!effectiveCategories || effectiveCategories.length === 0) {
      return res.json([]);
    }

    const products = await Product.find({ 
      login: safeLogin,
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
        { login: safeLogin, barcode: { $eq: safeBarcode } },
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

// POST /update-price/:login
// ====================================================================
router.post("/update-price/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const { barcode, price } = req.body;
  try {
    const sBarcode = sanitizeBarcode(barcode);
    const sPrice   = sanitizeNumber(price, 'price');

    const updated = await Product.findOneAndUpdate(
      { login: safeLogin, barcode: sBarcode },
      { $set: { price: sPrice } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ====================================================================
// POST /update-base-price/:login
// ====================================================================
router.post("/update-base-price/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const { barcode, basePrice } = req.body;
  try {
    const sBarcode   = sanitizeBarcode(barcode);
    const sBasePrice = sanitizeNumber(basePrice, 'basePrice');

    const updated = await Product.findOneAndUpdate(
      { login: safeLogin, barcode: sBarcode },
      { $set: { basePrice: sBasePrice } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ====================================================================
// POST /update-quantity/:login
// ====================================================================
router.post("/update-quantity/:login", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const { barcode, quantity } = req.body;
  try {
    const sBarcode = sanitizeBarcode(barcode);
    const sQty     = sanitizeNumber(quantity, 'quantity');

    const updated = await Product.findOneAndUpdate(
      { login: safeLogin, barcode: sBarcode },
      { $set: { quantity: sQty } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ====================================================================
// POST /update-or-add-user-product
// ====================================================================
router.post("/update-or-add-user-product", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.body.login);
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  const { barcode, name, price, basePrice, quantity, category } = req.body;

  try {
    const sBarcode   = sanitizeBarcode(barcode);
    const sName      = sanitizeName(name);
    const sPrice     = sanitizeNumber(price, 'price');
    const sBasePrice = sanitizeNumber(basePrice || 0, 'basePrice');
    const sQty       = sanitizeNumber(quantity || 0, 'quantity');
    const sCategory  = sanitizeCategory(category);

    const updated = await Product.findOneAndUpdate(
      { login: safeLogin, barcode: sBarcode },
      {
        $set: {
          name:      sName,
          price:     sPrice,
          basePrice: sBasePrice,
          quantity:  sQty,
          category:  sCategory
        }
      },
      { upsert: true, new: true }
    );

    // 🏷️ Kategoriya userda va ShopType da borligini tekshirish
    if (sCategory) {
      await User.updateOne(
        { login: safeLogin },
        { $addToSet: { shopCategories: sCategory } }
      );
      const user = await User.findOne({ login: safeLogin });
      if (user?.shopType) {
        await ShopType.updateOne(
          { value: user.shopType },
          { $addToSet: { categories: sCategory } }
        );
      }
    }

    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ====================================================================
// DELETE /delete-product/:login/:barcode
// ====================================================================
router.delete("/delete-product/:login/:barcode", verifyToken, csrfProtection, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }

  try {
    const sBarcode = sanitizeBarcode(req.params.barcode);
    const deleted = await Product.findOneAndDelete({ login: safeLogin, barcode: sBarcode });

    if (!deleted) return res.status(404).json({ message: "Mahsulot topilmadi" });

    // 📈 Audit log
    await AuditService.logUserAction({
      login: req.user.login,
      action: 'DELETE_PRODUCT',
      status: 'SUCCESS',
      details: { barcode: sBarcode }
    });

    res.json({ success: true, message: "Mahsulot o'chirildi" });
  } catch (err) {
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
    if (safeQuery.includes("mahsulotlar")) {
      const products = await Product.find({ login: safeLogin }).lean();
      return res.json({ type: 'products', data: products });
    }

    if (safeQuery.includes("sotilgan")) {
      const products = await Product.find({ login: safeLogin, sold: { $gt: 0 } }).lean();
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