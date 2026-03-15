require("dotenv").config();

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const fetch = require("node-fetch").default;
const { escapeRegex, sanitizeString } = require("../utils/escapeRegex");

// Dinamik products model
function getProductModel(login) {
  if (!login) {
    throw new Error("Login talab qilinadi!");
  }

  const collectionName = `products_${login.trim().toLowerCase()}`;

  if (mongoose.models[collectionName]) {
    return mongoose.models[collectionName];
  }

  const schema = new mongoose.Schema({
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, default: "" },
    quantity: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    basePrice: { type: Number, default: 0 }
  }, { timestamps: true });

  return mongoose.model(collectionName, schema, collectionName);
}

// Dinamik incoming model (Kirim bazasi uchun)
function getIncomingModel(login) {
  if (!login) {
    throw new Error("Login talab qilinadi!");
  }

  const collectionName = `incoming_${login.trim().toLowerCase()}`;

  if (mongoose.models[collectionName]) {
    return mongoose.models[collectionName];
  }

  const schema = new mongoose.Schema({
    name: { type: String, required: true },
    barcode: { type: String, required: true, unique: true },
    basePrice: { type: Number, required: true },
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 1 },
    category: { type: String, default: "" },
    addedAt: { type: Date, default: Date.now }
  }, { timestamps: true });

  return mongoose.model(collectionName, schema, collectionName);
}

// 1. Yangi mahsulot qo'shish – products + incoming ga saqlash
router.post("/add", async (req, res) => {
  try {
    let { name, price, basePrice, barcode, category, quantity = 0, login } = req.body;
    name = sanitizeString(name, 300);
    category = sanitizeString(category, 200);
    barcode = sanitizeString(String(barcode || ''), 100);

    if (!login || !barcode || !name || !category) {
      return res.status(400).json({ message: "Majburiy maydonlar to'ldirilmagan!" });
    }

    const UserProduct = getProductModel(login);

    // Yangi mahsulot qo'shish yoki mavjudini yangilash
    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      {
        $set: {
          name,
          price: Number(price || 0),
          basePrice: Number(basePrice || 0),
          category,
          quantity: 0,  // ← MaxsulotBazasi uchun miqdor 0 (sotuv uchun)
        },
        $inc: { incomingQuantity: Number(quantity) }  // ← Kirim miqdori alohida qo'shiladi
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Mahsulot muvaffaqiyatli qo'shildi", product: updated });
  } catch (err) {
    console.error("Mahsulot qo'shishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// 2. Umumiy mahsulotlarni olish
router.get("/", async (req, res) => {
  try {
    const products = await Product.find({}).sort({ name: 1 });
    res.json(products);
  } catch (err) {
    console.error("Umumiy mahsulotlarni olishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// 3. Foydalanuvchi mahsulotlarini olish
router.get("/user-products/:login", async (req, res) => {
  try {
    const { login } = req.params;
    if (!login) return res.status(400).json({ message: "Login kerak!" });

    const UserProduct = getProductModel(login);
    const products = await UserProduct.find({}).sort({ name: 1 });
    res.json(products);
  } catch (err) {
    console.error("Foydalanuvchi mahsulotlarini olishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// 4. Kirim ma'lumotlarini olish (KirimBazasi uchun)
router.get("/incoming/:login", async (req, res) => {
  try {
    const { login } = req.params;
    if (!login) return res.status(400).json({ message: "Login kerak!" });

    const Incoming = getIncomingModel(login);
    const items = await Incoming.find({})
      .sort({ addedAt: -1 })
      .lean();

    const formatted = items.map(item => ({
      id: item._id.toString(),
      name: item.name,
      barcode: item.barcode,
      basePrice: item.basePrice,
      price: item.price || 0,
      quantity: item.quantity || 1,
      category: item.category || "",
      addedAt: new Date(item.addedAt).toISOString().split('T')[0]
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Kirimlarni olishda xato:", err);
    // Collection hali mavjud bo'lmasa – bo'sh massiv qaytar
    res.json([]);
  }
});

// 5. Kirim qo'shish (agar alohida kerak bo'lsa)
router.post("/incoming/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { name, barcode, basePrice, price = 0, quantity = 1, category = "" } = req.body;

    if (!name || !barcode || basePrice == null) {
      return res.status(400).json({ message: "Majburiy maydonlar: name, barcode, basePrice" });
    }

    const Incoming = getIncomingModel(login);
    const updated = await Incoming.findOneAndUpdate(
      { barcode },
      {
        name: name.trim(),
        basePrice: Number(basePrice),
        price: Number(price),
        quantity: Number(quantity),
        category: category.trim()
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: "Kirim bazasiga qo'shildi",
      data: {
        id: updated._id.toString(),
        name: updated.name,
        barcode: updated.barcode,
        basePrice: updated.basePrice,
        price: updated.price,
        quantity: updated.quantity,
        category: updated.category,
        addedAt: new Date(updated.addedAt).toISOString().split('T')[0]
      }
    });
  } catch (err) {
    console.error("Kirim qo'shishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Qolgan route'lar (update-price, delete-product, search va boshqalar)
router.post("/update-price", async (req, res) => {
  try {
    const { barcode, newPrice, login } = req.body;
    if (!login || !barcode || newPrice == null) {
      return res.status(400).json({ message: "Login, barcode va newPrice kerak!" });
    }

    const UserProduct = getProductModel(login);
    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      { $set: { price: Number(newPrice) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

    res.json({ message: "Narx yangilandi", product: updated });
  } catch (err) {
    console.error("Narx yangilash xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

router.post("/update-quantity", async (req, res) => {
  try {
    const { barcode, newQuantity, login } = req.body;
    if (!login || !barcode || newQuantity == null) {
      return res.status(400).json({ message: "Login, barcode va newQuantity kerak!" });
    }

    const UserProduct = getProductModel(login);
    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      { $set: { quantity: Number(newQuantity) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

    res.json({ message: "Miqdor yangilandi", product: updated });
  } catch (err) {
    console.error("Miqdor yangilash xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

router.post("/delete-product", async (req, res) => {
  try {
    const { barcode, login } = req.body;
    if (!login || !barcode) {
      return res.status(400).json({ message: "Login va barcode kerak!" });
    }

    const UserProduct = getProductModel(login);
    const result = await UserProduct.deleteOne({ barcode });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Mahsulot topilmadi" });
    }

    res.json({ message: "Mahsulot foydalanuvchi ro'yxatidan o'chirildi" });
  } catch (err) {
    console.error("O'chirish xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const { q = "", category = "", login } = req.query;

    let filter = {};
    if (q && typeof q === 'string') {
      const safeQ = escapeRegex(q, 200);
      if (safeQ) {
        filter.$or = [
          { name: { $regex: safeQ, $options: "i" } },
          { barcode: { $regex: safeQ, $options: "i" } }
        ];
      }
    }
    if (category) filter.category = category;

    if (login) {
      const UserProduct = getProductModel(login);
      const products = await UserProduct.find(filter).limit(50).sort({ name: 1 });
      return res.json(products);
    }

    const products = await Product.find(filter).limit(50).sort({ name: 1 });
    res.json(products);
  } catch (err) {
    console.error("Qidiruv xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

router.get("/count", async (req, res) => {
  try {
    const count = await Product.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Ulgurji narxni (basePrice) yangilash uchun alohida endpoint
router.post("/update-base-price", async (req, res) => {
  try {
    const { barcode, newBasePrice, login } = req.body;
    if (!login || !barcode || newBasePrice == null) {
      return res.status(400).json({ message: "Login, barcode va newBasePrice kerak!" });
    }

    const UserProduct = getProductModel(login);
    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      { $set: { basePrice: Number(newBasePrice) } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

    res.json({ message: "Ulgurji narx yangilandi", product: updated });
  } catch (err) {
    console.error("Ulgurji narx yangilash xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Kirim miqdorini faqat qo'shish (minus bo'lmasin)
router.post("/add-quantity", async (req, res) => {
  try {
    const { barcode, addAmount, login } = req.body;
    if (!login || !barcode || !addAmount || addAmount <= 0) {
      return res.status(400).json({ message: "Login, barcode va musbat addAmount kerak!" });
    }

    const UserProduct = getProductModel(login);
    const product = await UserProduct.findOne({ barcode });

    if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });

    const newQuantity = (product.quantity || 0) + Number(addAmount);

    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      { $set: { quantity: newQuantity } },
      { new: true }
    );

    res.json({ message: "Miqdor qo'shildi", product: updated });
  } catch (err) {
    console.error("Kirim miqdorini qo'shishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});


// Qo'shilgan sanani o'zgartirish
router.post("/update-date", async (req, res) => {
  try {
    const { barcode, newDate, login } = req.body; // newDate – string (masalan: "28.12.2025")
    if (!login || !barcode) {
      return res.status(400).json({ message: "Login va barcode kerak!" });
    }

    const UserProduct = getProductModel(login);
    const updated = await UserProduct.findOneAndUpdate(
      { barcode },
      { $set: { createdAt: newDate } }, // string sifatida saqlaymiz
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });

    res.json({ message: "Qo'shilgan sana yangilandi", product: updated });
  } catch (err) {
    console.error("Sana yangilash xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

router.get("/lookup", async (req, res) => {
  const { barcode } = req.query;
  if (!barcode) return res.status(400).json({ message: "Barcode kerak!" });

  try {
    const offRes = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    if (offRes.ok) {
      const data = await offRes.json();
      if (data.status === 1 && data.product?.product_name) {
        return res.json({
          source: "OpenFoodFacts",
          name: data.product.product_name,
          barcode
        });
      }
    }

    if (process.env.UPCDB_API_KEY) {
      const upcRes = await fetch(`https://api.upcdatabase.org/product/${barcode}?apikey=${process.env.UPCDB_API_KEY}`);
      if (upcRes.ok) {
        const data = await upcRes.json();
        if (data.title) {
          return res.json({ source: "UPCDatabase", name: data.title, barcode });
        }
      }
    }

    res.json({ source: "none", message: "Mahsulot topilmadi", barcode });
  } catch (err) {
    console.error("Tashqi API xatosi:", err);
    res.status(500).json({ message: "Tashqi API xatosi" });
  }
});

module.exports = router;