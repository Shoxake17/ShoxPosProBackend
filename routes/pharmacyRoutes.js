const express = require("express");
const mongoose = require("mongoose");
const verifyToken = require('../middleware/verifyToken');
const AuditService = require('../services/auditService');
const { escapeRegex, sanitizeString } = require("../utils/escapeRegex");

const PharmProduct = require("../models/PharmProduct");
const PharmBase = require("../models/PharmBase");
const PharmSale = require("../models/PharmSale");
const User = require("../models/User");
const ShopType = require("../models/ShopType");

module.exports = (csrfProtection) => {
  const router = express.Router();

  // ====================================================================
  // SANITIZERS
  // ====================================================================
  function sanitizeLogin(value) {
    if (!value || typeof value !== 'string') throw new Error("login noto'g'ri");
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
    if (!value || typeof value !== 'string') return 'Nomsiz dori';
    if (/\$/.test(value)) throw new Error("name da noto'g'ri belgi");
    return value.trim().slice(0, 128);
  }

  function sanitizeText(value, maxLen = 500) {
    if (!value || typeof value !== 'string') return '';
    return value.trim().slice(0, maxLen);
  }

  // ====================================================================
  // PHARMACY ROUTES
  // ====================================================================

  // 0. Umumiy dorixona bazasini soni olish
  router.get("/pharm-base/count", verifyToken, async (req, res) => {
    try {
      const count = await PharmBase.countDocuments();
      res.json({ count });
    } catch (err) {
      console.error("❌ [pharm-base] count xato:", err);
      res.status(500).json({ error: "Server xatosi" });
    }
  });

  // 1. Dorilarni qidirish (Umumiy yoki Foydalanuvchi dorilar)
  router.get("/search", verifyToken, async (req, res) => {
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

      // Case: Foydalanuvchi login bilan qidirayotgan bo'lsa
      if (login) {
        const safeLogin = String(login).trim().toLowerCase();
        const userPharmProducts = await PharmProduct.find({ ...filter, login: safeLogin }).limit(50).sort({ name: 1 });
        
        // HAMISHA umumiy dorixona bazasidan qidir!
        const globalPharm = await PharmBase.find(filter).limit(50).sort({ name: 1 });
          
        const combined = [...userPharmProducts];
        const userBarcodes = new Set(userPharmProducts.map(p => p.barcode));
          
        for (const gp of globalPharm) {
          if (!userBarcodes.has(gp.barcode)) {
            const plainGp = gp.toObject();
            plainGp.isGlobal = true;
            combined.push(plainGp);
          }
        }
        return res.json(combined.slice(0, 50));
      }

      // Case: Faqat umumiy bazadan qidiruv
      const globalPharm = await PharmBase.find(filter).limit(50).sort({ name: 1 });
      res.json(globalPharm);

    } catch (err) {
      console.error("Dorilarni qidirishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 2. Foydalanuvchi dorilarini olish
  router.get("/user-pharm-products/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const products = await PharmProduct.find({ login: safeLogin }).sort({ name: 1 });
      res.json(products);
    } catch (err) {
      console.error("Foydalanuvchi dorilarini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 3. Yangi dori qo'shish
  router.post("/add-pharm", verifyToken, csrfProtection, async (req, res) => {
    try {
      let { 
        name, price, basePrice, barcode, category, quantity = 0, login,
        dosage, manufacturer, expiryDate, batchNumber, isPrescriptionRequired, 
        storageCondition, description, dosageForm, shelfNumber, rowNumber
      } = req.body;
      
      const safeLogin = sanitizeLogin(login);
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      name = sanitizeName(name);
      category = sanitizeCategory(category);
      barcode = sanitizeBarcode(String(barcode || ''));
      
      if (!login || !barcode || !name || !category) {
        return res.status(400).json({ message: "Majburiy maydonlar to'ldirilmagan!" });
      }

      const updated = await PharmProduct.findOneAndUpdate(
        { login: safeLogin, barcode },
        {
          $set: { 
            name, 
            price: Number(price || 0), 
            basePrice: Number(basePrice || 0), 
            category, 
            dosage: sanitizeText(dosage, 100),
            manufacturer: sanitizeText(manufacturer, 200),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            batchNumber: sanitizeText(batchNumber, 100),
            isPrescriptionRequired: Boolean(isPrescriptionRequired),
            storageCondition: sanitizeText(storageCondition, 200),
            description: sanitizeText(description, 2000),
            dosageForm: sanitizeText(dosageForm, 100),
            shelfNumber: sanitizeText(shelfNumber, 50),
            rowNumber: sanitizeText(rowNumber, 50)
          },
          $inc: { quantity: Number(quantity), incomingQuantity: Number(quantity) }
        },
        { upsert: true, new: true }
      );

      const user = await User.findOne({ login: safeLogin });
      if (user) {
        if (!user.shopCategories.includes(category)) {
          await User.updateOne({ login: safeLogin }, { $addToSet: { shopCategories: category } });
        }
        if (user.shopType) {
          await ShopType.updateOne({ value: user.shopType }, { $addToSet: { categories: category } });
        }
      }

      
      res.json({ message: "Dori qo'shildi", product: updated });
      
      await AuditService.logUserAction({
        login: req.user.login,
        action: 'ADD_PHARMACY_PRODUCT',
        status: 'SUCCESS',
        details: { barcode, name, quantity }
      });
    } catch (err) {
      console.error("Dori qo'shishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 4. Umumiy dorixona bazasiga qo'shish
  router.post("/add-to-pharm-base", verifyToken, csrfProtection, async (req, res) => {
    try {
      let { name, basePrice, barcode, category,
        dosage, manufacturer, storageCondition, sideEffects, description, composition, dosageForm, isPrescriptionRequired
      } = req.body;

      barcode = sanitizeBarcode(String(barcode || ''));
      name = sanitizeName(name);
      category = sanitizeCategory(category);

      if (!barcode || !name) {
        return res.status(400).json({ message: "Majburiy maydonlar to'ldirilmagan!" });
      }

      const pharmBase = new PharmBase({
        barcode, name, category,
        basePrice: Number(basePrice || 0),
        dosage: sanitizeText(dosage, 100),
        manufacturer: sanitizeText(manufacturer, 200),
        storageCondition: sanitizeText(storageCondition, 200),
        sideEffects: sanitizeText(sideEffects, 1000),
        description: sanitizeText(description, 2000),
        composition: sanitizeText(composition, 1000),
        dosageForm: sanitizeText(dosageForm, 100),
        isPrescriptionRequired: Boolean(isPrescriptionRequired),
      });

      await pharmBase.save();
      
      res.json({ message: "Dori umumiy bazaga qo'shildi", product: pharmBase });
    } catch (err) {
      console.error("Umumiy bazaga qo'shishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 5. Umumiy dorixona bazasini olish
  router.get("/all-pharm-base", verifyToken, async (req, res) => {
    try {
      const products = await PharmBase.find({}).sort({ name: 1 });
      res.json(products);
    } catch (err) {
      console.error("Umumiy dorixona bazasini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 6. Dorini o'chirish
  router.post("/delete-pharm", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, login } = req.body;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const sBarcode = sanitizeBarcode(barcode);
      const result = await PharmProduct.deleteOne({ login: safeLogin, barcode: sBarcode });
      
      if (result.deletedCount === 0) return res.status(404).json({ message: "Dori topilmadi" });
      
      res.json({ message: "Dori o'chirildi" });
    } catch (err) {
      console.error("Dori o'chirishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 7. Dorini narxini yangilash
  router.post("/update-pharm-price", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, newPrice, login } = req.body;
      const safeLogin = sanitizeLogin(login);
      const sBarcode = sanitizeBarcode(barcode);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const price = sanitizeNumber(newPrice, 'newPrice');
      
      const result = await PharmProduct.findOneAndUpdate(
        { login: safeLogin, barcode: sBarcode },
        { $set: { price } },
        { new: true }
      );
      
      if (!result) return res.status(404).json({ message: "Dori topilmadi" });
      
      res.json({ message: "Narx yangilandi", product: result });
    } catch (err) {
      console.error("Narx yangilashda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 8. Dorini asosiy (chiqim) narxini yangilash
  router.post("/update-pharm-base-price", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, newBasePrice, login } = req.body;
      const safeLogin = sanitizeLogin(login);
      const sBarcode = sanitizeBarcode(barcode);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const basePrice = sanitizeNumber(newBasePrice, 'newBasePrice');
      
      const result = await PharmProduct.findOneAndUpdate(
        { login: safeLogin, barcode: sBarcode },
        { $set: { basePrice } },
        { new: true }
      );
      
      if (!result) return res.status(404).json({ message: "Dori topilmadi" });
      
      res.json({ message: "Asosiy narx yangilandi", product: result });
    } catch (err) {
      console.error("Asosiy narx yangilashda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 9. Dorini miqdorini yangilash
  router.post("/update-pharm-quantity", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, newQuantity, login } = req.body;
      const safeLogin = sanitizeLogin(login);
      const sBarcode = sanitizeBarcode(barcode);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const quantity = sanitizeNumber(newQuantity, 'newQuantity');
      
      const result = await PharmProduct.findOneAndUpdate(
        { login: safeLogin, barcode: sBarcode },
        { $set: { quantity } },
        { new: true }
      );
      
      if (!result) return res.status(404).json({ message: "Dori topilmadi" });
      
      res.json({ message: "Miqdor yangilandi", product: result });
    } catch (err) {
      console.error("Miqdor yangilashda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 10. Dorini umumiy ma'lumotlarini yangilash (barcode, partiya va retseptdan tashqari)
  router.post("/update-pharm-product-info", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { barcode, login, ...updates } = req.body;
      const safeLogin = sanitizeLogin(login);
      const sBarcode = sanitizeBarcode(barcode);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const allowedUpdates = [
        'name', 'category', 'dosage', 'manufacturer', 
        'price', 'basePrice', 'quantity', 'expiryDate', 
        'shelfNumber', 'rowNumber', 'description'
      ];

      const sanitizedUpdates = {};
      allowedUpdates.forEach(key => {
        if (updates[key] !== undefined) {
          if (['price', 'basePrice', 'quantity'].includes(key)) {
            sanitizedUpdates[key] = sanitizeNumber(updates[key], key);
          } else if (['name', 'dosage', 'manufacturer', 'shelfNumber', 'rowNumber', 'description'].includes(key)) {
            sanitizedUpdates[key] = sanitizeText(String(updates[key]), 500);
          } else {
            sanitizedUpdates[key] = updates[key];
          }
        }
      });

      const result = await PharmProduct.findOneAndUpdate(
        { login: safeLogin, barcode: sBarcode },
        { $set: sanitizedUpdates },
        { new: true }
      );

      if (!result) return res.status(404).json({ message: "Dori topilmadi" });

      res.json({ message: "Ma'lumotlar yangilandi", product: result });
    } catch (err) {
      console.error("Ma'lumotlar yangilashda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 8. Dorixona kirim bazasi
  router.get("/pharm-kirim/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const products = await PharmProduct.find({ login: safeLogin }).sort({ addedAt: -1 });
      res.json(products.map(p => ({
        _id: p._id,
        barcode: p.barcode,
        name: p.name,
        basePrice: p.basePrice,
        price: p.price,
        quantity: p.quantity,
        incomingQuantity: p.incomingQuantity,
        category: p.category,
        dosage: p.dosage,
        manufacturer: p.manufacturer,
        shelfNumber: p.shelfNumber,
        rowNumber: p.rowNumber,
        addedAt: p.addedAt
      })));
    } catch (err) {
      console.error("Kirim bazasini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 7. Foydalanuvchi dorixonami tekshirish
  router.get("/is-pharmacy", verifyToken, async (req, res) => {
    try {
      const { login } = req.query;
      if (!login) {
        return res.status(400).json({ isPharmacy: false });
      }
      
      const safeLogin = String(login).trim().toLowerCase();
      const user = await User.findOne({ login: safeLogin });
      
      if (!user) {
        return res.json({ isPharmacy: false });
      }
      
      res.json({ isPharmacy: user.shopType === 'dorixona' });
    } catch (err) {
      console.error(err);
      res.json({ isPharmacy: false });
    }
  });

  // 8. Dorixonani sotish
  router.post("/sell-pharm", verifyToken, csrfProtection, async (req, res) => {
    try {
      console.log("📤 Request body:", req.body);
      let { login, items, paymentMethod = "naqd" } = req.body;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      if (!Array.isArray(items) || items.length === 0) {
        console.log("❌ Items not array or empty:", items);
        return res.status(400).json({ message: "Sotuv uchun dori yo'q!" });
      }

      let totalAmount = 0;
      const saleItems = [];

      for (const item of items) {
        console.log("🔄 Processing item:", item);
        const barcode = sanitizeBarcode(String(item.barcode || ''));
        const quantity = sanitizeNumber(Number(item.quantity) || Number(item.count), 'miqdor');
        const price = sanitizeNumber(Number(item.price), 'narx');

        const product = await PharmProduct.findOne({ login: safeLogin, barcode });
        if (!product) {
          console.log("❌ Product not found:", barcode);
          return res.status(404).json({ message: `${item.name} topilmadi!` });
        }

        if ((product.quantity || 0) < quantity) {
          console.log("❌ Not enough stock:", product.quantity, "needed:", quantity);
          return res.status(400).json({ message: `${item.name} yetarli emas!` });
        }

        const total = price * quantity;
        totalAmount += total;
        saleItems.push({
          barcode,
          name: sanitizeName(item.name),
          quantity,
          price,
          basePrice: product.basePrice || 0,
          total,
          dosage: sanitizeText(product.dosage, 100),
          manufacturer: sanitizeText(product.manufacturer, 200),
        });

        await PharmProduct.updateOne(
          { _id: product._id },
          { $inc: { quantity: -quantity, sold: quantity } }
        );
      }

      const sale = new PharmSale({
        login: safeLogin,
        items: saleItems,
        totalAmount,
        paymentMethod,
        soldAt: new Date(),
      });
      await sale.save();


      await AuditService.logUserAction({
        login: req.user.login,
        action: 'SELL_PHARMACY',
        status: 'SUCCESS',
        details: { totalAmount, paymentMethod, itemCount: items.length }
      });

      console.log("✅ Sale saved successfully!");
      res.json({ message: "Sotuv amalga oshirildi!", sale });
    } catch (err) {
      console.error("❌ Dorixona sotishda xato:", err);
      res.status(400).json({ message: err.message || "Server xatosi" });
    }
  });

  // 9. Foydalanuvchi dorixona sotuvlarini olish
  router.get("/pharm-sales/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = sanitizeLogin(login);

      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const sales = await PharmSale.find({ login: safeLogin }).sort({ soldAt: -1 }).limit(100);
      res.json(sales);
    } catch (err) {
      console.error("Dorixona sotuvlarini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 10. Dorini barcode, partiya raqami yoki nomi bo'yicha topish
  router.get("/pharm-info/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const { q } = req.query;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Qidiruv so'rovi kerak!" });
      }

      const safeQ = escapeRegex(q.trim(), 200);
      const product = await PharmProduct.findOne({
        login: safeLogin,
        $or: [
          { barcode: { $regex: safeQ, $options: "i" } },
          { name: { $regex: safeQ, $options: "i" } },
          { batchNumber: { $regex: safeQ, $options: "i" } }
        ]
      });

      if (!product) {
        return res.status(404).json({ message: "Dori topilmadi!" });
      }

      res.json(product);
    } catch (err) {
      console.error("Dori ma'lumotlarini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 11. Dorixona AI uchun ma'lumotlar
  router.get("/pharm-ai-data/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = sanitizeLogin(login);
      
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }
      
      const [products, sales] = await Promise.all([
        PharmProduct.find({ login: safeLogin }),
        PharmSale.find({ login: safeLogin }).sort({ soldAt: -1 }).limit(100)
      ]);
      
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todaySales = sales.filter(s => new Date(s.soldAt) >= todayStart);
      const todayTotal = todaySales.reduce((s, sale) => s + (sale.totalAmount || 0), 0);
      
      res.json({
        products: products.map(p => ({
          barcode: p.barcode,
          name: p.name,
          price: p.price,
          basePrice: p.basePrice,
          quantity: p.quantity,
          category: p.category,
          dosage: p.dosage,
          manufacturer: p.manufacturer,
          shelfNumber: p.shelfNumber,
          rowNumber: p.rowNumber
        })),
        sales: sales.map(s => ({
          totalAmount: s.totalAmount,
          paymentMethod: s.paymentMethod,
          soldAt: s.soldAt,
          items: s.items
        })),
        todayTotal,
        productCount: products.length,
        saleCount: sales.length
      });
    } catch (err) {
      console.error("AI ma'lumotlarini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 12. Foydalanuvchi dorilar soni va umumiy statistikasi
  router.get("/pharm-stats/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = sanitizeLogin(login);
      
      if (req.user.login !== safeLogin) {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const productCount = await PharmProduct.countDocuments({ login: safeLogin });
      const saleCount = await PharmSale.countDocuments({ login: safeLogin });
      const totalSoldAmount = await PharmSale.aggregate([
        { $match: { login: safeLogin } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } }
      ]);

      res.json({
        productCount,
        saleCount,
        totalSoldAmount: totalSoldAmount[0]?.total || 0,
      });
    } catch (err) {
      console.error("Dorixona statistikasini olishda xato:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  return router;
};
