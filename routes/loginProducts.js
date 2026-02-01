const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// 🔹 Dinamik model yaratish (login asosida)
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

// ================== PRODUCTS ==================

// Foydalanuvchiga tegishli mahsulotlarni olish
router.get("/products/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const Product = getProductModel(login);
    const products = await Product.find({});
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Mahsulotlarni sinxronlash
router.post("/sync-products/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const Product = getProductModel(login);
    const { products } = req.body;
    if (!Array.isArray(products)) return res.status(400).json({ message: "Noto'g'ri format" });

    for (const p of products) {
      await Product.updateOne(
        { barcode: p.barcode },
        { 
          $set: { name: p.name, price: p.price, basePrice: p.basePrice, quantity: p.quantity, category: p.category },
          $setOnInsert: { sold: p.sold || 0 }
        },
        { upsert: true }
      );
    }

    res.json({ message: "✅ Sinxronlash muvaffaqiyatli" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Narxni yangilash
router.post("/update-price/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { barcode, newPrice } = req.body;
    const Product = getProductModel(login);

    await Product.updateOne({ barcode }, { $set: { price: newPrice } });
    res.json({ message: "✅ Narx yangilandi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Ulgurji narxni yangilash (basePrice)
router.post("/update-base-price/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { barcode, newBasePrice } = req.body;

    if (!barcode || newBasePrice == null) {
      return res.status(400).json({ message: "Barcode va yangi narx kerak" });
    }

    const Product = getProductModel(login);

    const updated = await Product.updateOne(
      { barcode: barcode },
      { $set: { basePrice: Number(newBasePrice) } }
    );

    if (updated.matchedCount === 0) {
      return res.status(404).json({ message: "Mahsulot topilmadi" });
    }
    const updatedProduct = await Product.findOne({ barcode });
    
    res.json({ message: "✅ Ulgurji narx yangilandi", product: updatedProduct });
  } catch (err) {
    console.error("❌ Base price update xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Mahsulotni o'chirish
router.post("/delete-product/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { barcode } = req.body;
    const Product = getProductModel(login);

    const deleted = await Product.deleteOne({ barcode });
    if (deleted.deletedCount === 0) return res.status(404).json({ message: "Mahsulot topilmadi" });

    res.json({ message: "✅ Mahsulot o'chirildi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Yangi mahsulot qo'shish yoki mavjudini yangilash (upsert)
router.post("/update-or-add-user-product", async (req, res) => {
  try {
    const { login, barcode, name, price = 0, basePrice = 0, quantity = 0, category = "" } = req.body;

    if (!login || !barcode) {
      return res.status(400).json({ message: "Login va barcode majburiy!" });
    }

    const Product = getProductModel(login);

    const updated = await Product.findOneAndUpdate(
      { barcode },
      {
        $set: {
          name: name || "Nomsiz mahsulot",
          price: Number(price),
          basePrice: Number(basePrice),
          category: category.trim(),
          quantity: Number(quantity)
        }
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: updated.isNew ? "Yangi mahsulot qo'shildi" : "Mahsulot yangilandi",
      product: updated
    });
  } catch (err) {
    console.error("/update-or-add-user-product xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// ================== AI ==================
// AI so'rovlariga javob berish
router.post("/ai-query/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { query } = req.body;

    const Product = getProductModel(login);

    if (query.toLowerCase().includes("mahsulotlar")) {
      const products = await Product.find({}).lean();
      return res.json({ type: 'products', data: products });
    }

    if (query.toLowerCase().includes("sotilgan")) {
      const products = await Product.find({ sold: { $gt: 0 } }).lean();
      return res.json({ type: 'sold', data: products });
    }

    return res.json({ type: 'text', data: "Savolingizga mos ma'lumot topilmadi." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

module.exports = router;