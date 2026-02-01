const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// 🔹 Dinamik loginProducts modeli yaratish
function getProductModel(login) {
  const collectionName = `products_${login}`;
  if (mongoose.models[collectionName]) return mongoose.models[collectionName];

  const schema = new mongoose.Schema({
    name: String,
    barcode: String,
    basePrice: Number,
    price: Number,
    category: String,
    quantity: Number,
    sold: { type: Number, default: 0 }
  });

  return mongoose.model(collectionName, schema, collectionName);
}

// 🔹 Umumiy products modeli (OverwriteModelError oldini olish)
const Product = mongoose.models.Product || mongoose.model("Product", new mongoose.Schema({
  name: String,
  barcode: String,
  basePrice: Number,
  price: Number,
  category: String,
  quantity: Number
}), "products");

// 🔹 Scan API (barcode yoki nom orqali qidiruv)
router.get("/scan-product/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { barcode, name } = req.query;
    const LoginProduct = getProductModel(login);

    // 1️⃣ Avvalo loginProducts'dan qidirish
    let product = null;
    if (barcode) {
      product = await LoginProduct.findOne({ barcode });
    } else if (name) {
      product = await LoginProduct.findOne({ name: new RegExp(name, "i") });
    }

    // 2️⃣ Agar loginProductsda topilmasa, umumiy products'dan qidirish
    if (!product) {
      if (barcode) {
        product = await Product.findOne({ barcode });
      } else if (name) {
        product = await Product.findOne({ name: new RegExp(name, "i") });
      }
      if (product) product.sold = 0; // umumiy bazadan topilganda sold=0
    }

    if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });
    res.json(product);

  } catch (err) {
    console.error("❌ Scan product xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

module.exports = router;
