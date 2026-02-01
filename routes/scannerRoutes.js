const express = require('express');
const fs = require('fs');
const path = require('path');
const products = require("../data/products.json");
const router = express.Router();

// 🔹 Sinxronlangan mahsulotlar uchun vaqtinchalik saqlovchi
let syncedProducts = [];

// 🟢 Barcha mahsulotlarni olish
router.get("/", (req, res) => {
  res.json(products);
});
// 🟢 Mahsulotlarni sinxronlash
router.post("/sync-products", (req, res) => {
  syncedProducts = req.body.products || [];
  console.log(`📦 ${syncedProducts.length} ta mahsulot sinxronlandi`);
  res.json({ message: "✅ Sinxronlash tugadi" });
});

// 🟢 Webhook: Scanner ilovadan kelgan barcode/QR code
router.post('/scanner-hook', async (req, res) => {
  const { code, login, quantity = 1 } = req.body;

  if (!code || !login)
    return res.status(400).json({ message: '❌ Barcode va login kerak' });

  const loginDir = path.join(__dirname, '..', 'login');
  if (!fs.existsSync(loginDir)) fs.mkdirSync(loginDir, { recursive: true });

  const jsonFilePath = path.join(loginDir, `${login}.json`);
  let data = [];
  if (fs.existsSync(jsonFilePath)) {
    try {
      data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
    } catch {
      data = [];
    }
  }

  let product = syncedProducts.find(p => p.barcode === String(code).trim());

  // 🔍 Agar sinxron productlar orasida topilmasa — kategoriyalardan qidiramiz
  if (!product) {
    const categoriesDir = path.join(__dirname, '..', 'public', 'categories');
    if (fs.existsSync(categoriesDir)) {
      const categoryFiles = fs.readdirSync(categoriesDir).filter(f => f.endsWith('.json'));
      for (const file of categoryFiles) {
        const fileData = JSON.parse(fs.readFileSync(path.join(categoriesDir, file)));
        const found = fileData.find(p => p.barcode === String(code).trim());
        if (found) {
          product = found;
          break;
        }
      }
    }
  }

  // 🔍 Agar hali topilmasa — mxik_codes.json dan izlaymiz
  if (!product) {
    const mxikPath = path.join(__dirname, '..', 'public', 'mxik_codes.json');
    if (fs.existsSync(mxikPath)) {
      const mxikData = JSON.parse(fs.readFileSync(mxikPath, 'utf-8'));
      product = mxikData.find(p => p.barcode === String(code).trim());
    }
  }

  if (!product)
    return res.status(404).json({ message: '❌ Mahsulot topilmadi' });

  // ✅ JSON faylga mahsulotni yozamiz
  data.push({
    barcode: product.barcode,
    name: product.name,
    soldAt: new Date().toLocaleString('uz-UZ'),
    quantity,
    price: product.price
  });

  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
  res.json({ message: '✅ Mahsulot qo‘shildi', product });
});


// 🧾 Sotuvlarni saqlash (save-sale)
router.post("/save-sale", async (req, res) => {
  const { login, name, barcode, quantity, price } = req.body;

  if (!login || !barcode || !name || !quantity || !price) {
    console.warn("⚠️ Ma'lumotlar to‘liq emas:", req.body);
    return res.status(400).json({ message: "❌ Sotuv ma'lumotlari to‘liq emas" });
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    const userDir = path.join(__dirname, "..", "login", login);
    const jsonFilePath = path.join(userDir, `${login}.json`);

    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    let data = {};
    if (fs.existsSync(jsonFilePath)) {
      const raw = fs.readFileSync(jsonFilePath, "utf-8");
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
    }

    if (!data[today]) data[today] = [];

    const existing = data[today].find(item => item.barcode === barcode);

    if (existing) {
      existing.quantity += quantity;
      existing.total = existing.quantity * existing.price;
    } else {
      data[today].push({
        name,
        barcode,
        quantity,
        price,
        total: quantity * price
      });
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), "utf-8");
    res.json({ message: "✅ Sotuv saqlandi", saved: true });
  } catch (err) {
    console.error("❌ Faylga yozishda xatolik:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});


// 🧾 Foydalanuvchining barcha mahsulotlarini olish
router.get("/products/:login", (req, res) => {
  const login = req.params.login;
  const jsonFilePath = path.join(__dirname, "..", "login", login, `${login}.json`);

  if (!fs.existsSync(jsonFilePath)) {
    return res.status(404).json({ message: "❌ Fayl topilmadi" });
  }

  try {
    const raw = fs.readFileSync(jsonFilePath, "utf-8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      const merged = {};
      data.forEach(entry => {
        Object.entries(entry.products).forEach(([date, items]) => {
          if (!merged[date]) merged[date] = [];
          merged[date].push(...items);
        });
      });
      return res.json(merged);
    }

    res.json(data);
  } catch (err) {
    console.error("❌ JSON faylni o‘qishda xatolik:", err);
    res.status(500).json({ message: "❌ Faylni o‘qib bo‘lmadi" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const category = req.query.category || "";

    const filter = {
      $or: [
        { name: { $regex: q, $options: "i" } },
        { barcode: { $regex: q, $options: "i" } }
      ]
    };
    if (category) filter.category = category;

    const products = await Product.find(filter).limit(50); // faqat 50 ta qaytar
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "❌ Qidiruv xatosi", error: err.message });
  }
});


// 🧾 Narxlarni yangilash
router.post("/update-price", (req, res) => {
  const { login, barcode, price } = req.body;
  const filePath = path.join(__dirname, "..", "login", login, `${login}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "Fayl topilmadi" });
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    let updated = false;

    Object.entries(data).forEach(([date, products]) => {
      if (Array.isArray(products)) {
        products.forEach(item => {
          if (item.barcode === barcode) {
            item.price = price;
            item.total = item.quantity * price;
            updated = true;
          }
        });
      }
    });

    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return res.json({ success: true });
    } else {
      return res.status(404).json({ success: false, message: "Mahsulot topilmadi" });
    }
  } catch (err) {
    console.error("❌ JSON faylni o‘qishda xatolik:", err);
    res.status(500).json({ success: false, message: "Ichki xatolik" });
  }
});

module.exports = router;
