const express = require("express");
const mongoose = require("mongoose");
const { escapeRegex } = require("../utils/escapeRegex");
const verifyToken = require('../middleware/verifyToken');

module.exports = (csrfProtection) => {
  const router = express.Router();

const Product = require("../models/Product");
const ProductBase = require("../models/ProductBase");

// 🔹 Scan API (barcode yoki nom orqali qidiruv)
router.get("/scan-product/:login", verifyToken, async (req, res) => {
  try {
    const { login } = req.params;
    const { barcode, name } = req.query;

    // 🛡️ A01: Broken Access Control
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin) {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    // 1️⃣ Avvalo shaxsiy mahsulotlardan (Shared products collection) qidirish
    let product = null;
    if (barcode) {
      product = await Product.findOne({ login: safeLogin, barcode });
    } else if (name && typeof name === 'string') {
      const safeName = escapeRegex(name, 200);
      if (safeName) product = await Product.findOne({ login: safeLogin, name: new RegExp(safeName, "i") });
    }

    // 2️⃣ Agar shaxsiy bazada topilmasa, umumiy global bazadan (products_base) qidirish
    if (!product) {
      if (barcode) {
        product = await ProductBase.findOne({ barcode });
      } else if (name && typeof name === 'string') {
        const safeName = escapeRegex(name, 200);
        if (safeName) product = await ProductBase.findOne({ name: new RegExp(safeName, "i") });
      }
      if (product) {
        // Global bazadan topilganda, u shaxsiy bazaga o'tmagani uchun source: 'global' belgisini beramiz
        const pObj = product.toObject();
        pObj.source = 'global';
        pObj.sold = 0;
        return res.json(pObj);
      }
    }

    if (!product) return res.status(404).json({ message: "Mahsulot topilmadi" });
    
    const pObj = product.toObject();
    pObj.source = 'user';
    res.json(pObj);

  } catch (err) {
    console.error("❌ Scan product xatosi:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

  return router;
};
