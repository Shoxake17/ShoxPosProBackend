const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductBase = require("../models/ProductBase");
const User = require("../models/User");
const ShopType = require("../models/ShopType");
const fetch = require("node-fetch").default;
const { escapeRegex, sanitizeString } = require("../utils/escapeRegex");
const verifyToken = require("../middleware/verifyToken");
const AuditService = require("../services/auditService");

module.exports = (csrfProtection) => {
  const router = express.Router();

  // 1. Qidiruv (Umumiy yoki Foydalanuvchi mahsulotlari)
  // MUHIM: Bu route "/" dan yuqorida bo'lishi kerak
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

      // Case 1: Foydalanuvchi login bilan qidirayotgan bo'lsa
      if (login) {
        const safeLogin = String(login).trim().toLowerCase();
        const userProducts = await Product.find({ ...filter, login: safeLogin }).limit(50).sort({ name: 1 });
        
        // Agar user bazasidan topilmasa (yoki kam bo'lsa), global bazadan qidir
        if (userProducts.length < 5 || (filter.$or && filter.$or.some(f => f.barcode))) {
          const globalProducts = await ProductBase.find(filter).limit(50).sort({ name: 1 });
          
          const combined = [...userProducts];
          const userBarcodes = new Set(userProducts.map(p => p.barcode));
          
          for (const gp of globalProducts) {
            if (!userBarcodes.has(gp.barcode)) {
              const plainGp = gp.toObject();
              plainGp.isGlobal = true;
              combined.push(plainGp);
            }
          }
          return res.json(combined.slice(0, 50));
        }
        return res.json(userProducts);
      }

      // Case 2: Faqat umumiy bazadan qidiruv
      const globalProducts = await ProductBase.find(filter).limit(50).sort({ name: 1 });
      res.json(globalProducts);

    } catch (err) {
      console.error("Qidiruv xatosi:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 2. Umumiy mahsulotlar soni
  // MUHIM: Bu route "/" dan yuqorida bo'lishi kerak
  router.get("/count", async (req, res) => {
    try {
      const count = await ProductBase.countDocuments();
      res.json({ count });
    } catch (err) {
      console.error("Count xatosi:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 3. Tashqi API lardan barcode bo'yicha qidiruv
  router.get("/lookup", verifyToken, async (req, res) => {
    let { barcode } = req.query;
    if (!barcode) return res.status(400).json({ message: "Barcode kerak!" });

    barcode = String(barcode).trim();
    if (!/^[a-zA-Z0-9]+$/.test(barcode)) {
      return res.status(400).json({ message: "Barcode formati noto'g'ri!" });
    }

    try {
      const offRes = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      if (offRes.ok) {
        const data = await offRes.json();
        if (data.status === 1 && data.product?.product_name) {
          return res.json({ source: "OpenFoodFacts", name: data.product.product_name, barcode });
        }
      }
      res.json({ source: "none", message: "Mahsulot topilmadi", barcode });
    } catch (err) {
      console.error("Tashqi API xatosi:", err);
      res.status(500).json({ message: "Tashqi API xatosi" });
    }
  });

  // 4. Foydalanuvchi mahsulotlarini olish (Shared products dan)
  router.get("/user-products/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      const products = await Product.find({ login: safeLogin }).sort({ name: 1 });
      res.json(products);
    } catch (err) {
      console.error("Foydalanuvchi mahsulotlarini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 5. Kirim ma'lumotlarini olish (KirimBazasi uchun)
  router.get("/incoming/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      const items = await Product.find({ login: safeLogin, incomingQuantity: { $gt: 0 } })
        .sort({ updatedAt: -1 })
        .lean();
      const formatted = items.map(item => ({
        id: item._id.toString(),
        name: item.name,
        barcode: item.barcode,
        basePrice: item.basePrice,
        price: item.price || 0,
        quantity: item.incomingQuantity || 1,
        category: item.category || "",
        addedAt: new Date(item.updatedAt).toISOString().split('T')[0]
      }));
      res.json(formatted);
    } catch (err) {
      console.error("Kirimlarni olishda xato:", err);
      res.json([]);
    }
  });

  // 6. Yangi mahsulot qo'shish (Shared products)
  router.post("/add", verifyToken, csrfProtection, async (req, res) => {
    try {
      let { name, price, basePrice, barcode, category, quantity = 0, login } = req.body;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      name = sanitizeString(name, 300);
      category = sanitizeString(category, 200);
      barcode = sanitizeString(String(barcode || ''), 100);

      if (!login || !barcode || !name || !category) {
        return res.status(400).json({ message: "Majburiy maydonlar to'ldirilmagan!" });
      }

      const updated = await Product.findOneAndUpdate(
        { login: safeLogin, barcode },
        {
          $set: { name, price: Number(price || 0), basePrice: Number(basePrice || 0), category, quantity: 0 },
          $inc: { incomingQuantity: Number(quantity) }
        },
        { upsert: true, new: true }
      );

      // Kategoriyalarni yangilash
      const user = await User.findOne({ login: safeLogin });
      if (user) {
        if (!user.shopCategories.includes(category)) {
          await User.updateOne({ login: safeLogin }, { $addToSet: { shopCategories: category } });
        }
        if (user.shopType) {
          await ShopType.updateOne({ value: user.shopType }, { $addToSet: { categories: category } });
        }
      }

      res.json({ message: "Mahsulot qo'shildi", product: updated });
      await AuditService.logUserAction({
        login: req.user.login,
        action: 'ADD_PRODUCT',
        status: 'SUCCESS',
        details: { barcode, name, quantity }
      });
    } catch (err) {
      console.error("Mahsulot qo'shishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 7. Narxni yangilash
  router.post("/update-price", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, newPrice, login } = req.body;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      const updated = await Product.findOneAndUpdate(
        { login: safeLogin, barcode },
        { $set: { price: Number(newPrice) } },
        { new: true }
      );
      if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });
      await AuditService.logUserAction({
        login: req.user.login,
        action: 'UPDATE_PRICE',
        status: 'SUCCESS',
        details: { barcode, newPrice }
      });
      res.json({ message: "Narx yangilandi", product: updated });
    } catch (err) {
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 8. Umumiy baza listi (Pagination bilan)
  // MUHIM: Bu route "/" dan yuqorida bo'lishi kerak yoki pastdagi route'larni o'zgartirish kerak
  router.get("/all", verifyToken, async (req, res) => {
    try {
      const page = parseInt(req.query.page || 1);
      const limit = parseInt(req.query.limit || 50);
      const skip = (page - 1) * limit;

      const products = await ProductBase.find({}).sort({ name: 1 }).skip(skip).limit(limit);
      res.json(products);
    } catch (err) {
      console.error("Umumiy mahsulotlarni olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 9. Miqdorni yangilash
  router.post("/update-quantity", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, newQuantity, login } = req.body;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      const updated = await Product.findOneAndUpdate(
        { login: safeLogin, barcode },
        { $set: { quantity: Number(newQuantity) } },
        { new: true }
      );
      if (!updated) return res.status(404).json({ message: "Mahsulot topilmadi" });
      res.json({ message: "Miqdor yangilandi", product: updated });
    } catch (err) {
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 10. Mahsulotni o'chirish
  router.post("/delete-product", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, login } = req.body;
      const safeLogin = String(login || '').trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      const result = await Product.deleteOne({ login: safeLogin, barcode });
      if (result.deletedCount === 0) return res.status(404).json({ message: "Mahsulot topilmadi" });
      res.json({ message: "Mahsulot o'chirildi" });
    } catch (err) {
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  return router;
};
