const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Dinamik Sales model
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
    paymentMethod: { type: String, default: 'cash' },
    soldAt: { type: Date, default: Date.now }
  });
  return mongoose.model(modelName, schema, collectionName);
}

// Dinamik Debts model
function getDebtsModel(login) {
  const collectionName = `debts_${login}`;
  if (mongoose.models[collectionName]) return mongoose.models[collectionName];
  const schema = new mongoose.Schema({
    name: String, phone: String, amount: Number,
    lastPayment: { type: Date, default: Date.now }
  }, { timestamps: true });
  return mongoose.model(collectionName, schema, collectionName);
}

// Dinamik Products model
function getProductModel(login) {
  const collectionName = `products_${login}`;
  const modelName = `Product_${login}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({
    barcode: String,
    name: String,
    basePrice: Number,
    price: Number,
    category: String,
    quantity: Number,
    sold: { type: Number, default: 0 }
  });
  return mongoose.model(modelName, schema, collectionName);
}

// Savolga ma'lumot kerakligini aniqlash
function needsData(question) {
  const lower = question.toLowerCase();
  const keywords = [
    'sotil', 'sotuv', 'hisobot', 'daromad', 'foyda', 'mahsulot',
    'kategoriya', 'top', 'bugun', 'hafta', 'oy', 'qancha', 'necha',
    'summasi', 'miqdori', 'zaxira', 'tahlil', 'statistika', 'savdo',
    'narx', 'trend', 'eng', 'ko\'p', 'kam', 'zarar', 'marja'
  ];
  return keywords.some(k => lower.includes(k));
}

// Ma'lumotlar kontekstini yaratish
async function buildFullContext(login) {
  try {
    const Sales = getSalesModel(login);
    const Product = getProductModel(login);

    const [allSales, allProducts] = await Promise.all([
      Sales.find().sort({ soldAt: -1 }).lean(),
      Product.find().lean()
    ]);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now); monthStart.setDate(now.getDate() - 30);

    const filterByDate = (sales, from) =>
      sales.filter(s => s.soldAt && new Date(s.soldAt) >= from);

    const calcStats = (sales) => ({
      total: sales.reduce((s, i) => s + (i.total || 0), 0),
      profit: sales.reduce((s, i) => s + ((i.price || 0) - (i.basePrice || 0)) * (i.quantity || 1), 0),
      qty: sales.reduce((s, i) => s + (i.quantity || 0), 0),
      count: sales.length
    });

    const todayStats = calcStats(filterByDate(allSales, todayStart));
    const weekStats = calcStats(filterByDate(allSales, weekStart));
    const monthStats = calcStats(filterByDate(allSales, monthStart));
    const allStats = calcStats(allSales);

    // Top mahsulotlar
    const productMap = {};
    allSales.forEach(s => {
      const key = s.barcode || s.name || 'unknown';
      if (!productMap[key]) productMap[key] = { name: s.name, qty: 0, total: 0, profit: 0, barcode: s.barcode };
      productMap[key].qty += s.quantity || 0;
      productMap[key].total += s.total || 0;
      productMap[key].profit += ((s.price || 0) - (s.basePrice || 0)) * (s.quantity || 1);
    });
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    // Kategoriya tahlili
    const catMap = {};
    allSales.forEach(s => {
      const cat = s.category || 'Noma\'lum';
      if (!catMap[cat]) catMap[cat] = { total: 0, qty: 0 };
      catMap[cat].total += s.total || 0;
      catMap[cat].qty += s.quantity || 0;
    });

    // Kam zaxira
    const lowStock = allProducts
      .filter(p => (p.quantity || 0) < 10)
      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
      .slice(0, 20);

    // Zarar mahsulotlar
    const lossProducts = allProducts.filter(p => (p.price || 0) < (p.basePrice || 0));

    // Qarzdorlar
    let debtsContext = "  Ma'lumot yo'q";
    try {
      const Debts = getDebtsModel(login);
      const allDebts = await Debts.find({}).lean();
      const totalDebt = allDebts.reduce((s, d) => s + (d.amount || 0), 0);
      if (allDebts.length > 0) {
        const top10debts = allDebts.sort((a, b) => b.amount - a.amount).slice(0, 10);
        debtsContext = `  Jami qarzdorlar: ${allDebts.length} ta | Umumiy qarz: ${totalDebt.toLocaleString()} so'm\n` +
          top10debts.map(d => `  - ${d.name} (${d.phone}): ${d.amount.toLocaleString()} so'm`).join('\n');
      } else {
        debtsContext = "  Qarzdor yo'q ✅";
      }
    } catch(e) { debtsContext = "  Qarzlar yuklanmadi"; }


    // To'lov usullari
    const paymentMap = {};
    allSales.forEach(s => {
      const pm = s.paymentMethod || 'cash';
      paymentMap[pm] = (paymentMap[pm] || 0) + (s.total || 0);
    });

    return `
=== ${login.toUpperCase()} DO'KONI — REAL MA'LUMOTLAR ===
Sana: ${now.toLocaleDateString('uz-UZ')} ${now.toLocaleTimeString('uz-UZ')}

📅 BUGUNGI KUN:
  Savdo: ${todayStats.total.toLocaleString()} so'm
  Foyda: ${todayStats.profit.toLocaleString()} so'm
  Sotilgan: ${todayStats.qty} dona (${todayStats.count} operatsiya)

📅 7 KUNLIK:
  Savdo: ${weekStats.total.toLocaleString()} so'm
  Foyda: ${weekStats.profit.toLocaleString()} so'm
  Sotilgan: ${weekStats.qty} dona

📅 30 KUNLIK:
  Savdo: ${monthStats.total.toLocaleString()} so'm
  Foyda: ${monthStats.profit.toLocaleString()} so'm
  Sotilgan: ${monthStats.qty} dona

📅 JAMI (BARCHA VAQT):
  Savdo: ${allStats.total.toLocaleString()} so'm
  Foyda: ${allStats.profit.toLocaleString()} so'm
  Sotilgan: ${allStats.qty} dona (${allStats.count} yozuv)

🏆 TOP 15 MAHSULOT (summa bo'yicha):
${topProducts.map((p, i) => `  ${i + 1}. ${p.name || 'Noma\'lum'}: ${p.total.toLocaleString()} so'm | ${p.qty} dona | Foyda: ${p.profit.toLocaleString()} so'm`).join('\n')}

📊 KATEGORIYA TAHLILI:
${Object.entries(catMap).sort((a, b) => b[1].total - a[1].total).map(([cat, s]) => `  ${cat}: ${s.total.toLocaleString()} so'm (${s.qty} dona)`).join('\n')}

💳 TO'LOV USULLARI:
${Object.entries(paymentMap).map(([pm, total]) => `  ${pm}: ${total.toLocaleString()} so'm`).join('\n')}

⚠️ KAM ZAXIRA (10 dan kam):
${lowStock.length > 0 ? lowStock.map(p => `  ${p.name} (${p.barcode}): ${p.quantity || 0} dona`).join('\n') : '  Yetarli zaxira bor'}

❌ ZARAR MAHSULOTLAR (narx < xarid narxi):
${lossProducts.length > 0 ? lossProducts.map(p => `  ${p.name}: sotuv ${p.price} so'm | xarid ${p.basePrice} so'm | zarar: ${((p.basePrice || 0) - (p.price || 0)).toLocaleString()} so'm`).join('\n') : '  Zarar mahsulot yo\'q ✅'}

📦 MAHSULOTLAR BAZA:
  Jami tur: ${allProducts.length} ta
  Jami zaxira: ${allProducts.reduce((s, p) => s + (p.quantity || 0), 0)} dona
  O'rtacha narx: ${allProducts.length > 0 ? Math.round(allProducts.reduce((s, p) => s + (p.price || 0), 0) / allProducts.length).toLocaleString() : 0} so'm

💳 QARZDORLAR:
${debtsContext}
`;
  } catch (err) {
    console.error('Context yaratishda xato:', err);
    return 'Ma\'lumotlarni yuklashda xato yuz berdi.';
  }
}

// 📌 OpenAI ChatGPT endpoint
router.post('/ask-openai', async (req, res) => {
  const { question, login, systemOverride } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });

  try {
    let systemPrompt = systemOverride || '';
    if (!systemOverride && login && needsData(question)) {
      const context = await buildFullContext(login);
      systemPrompt = `Sen do'kon boshqaruv tizimining AI yordamchisisisan. O'zbek tilida javob ber. ${context}`;
    } else if (!systemOverride) {
      systemPrompt = 'Sen do\'kon boshqaruv tizimining AI yordamchisisisan. O\'zbek tilida javob ber.';
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ]
      })
    });

    if (!response.ok) throw new Error(`OpenAI API xatosi: ${response.status}`);
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    console.error("❌ OpenAI xatosi:", error.message);
    res.status(500).json({ error: "OpenAI bilan aloqa xatosi" });
  }
});

// 📌 Gemini Pro endpoint
router.post('/ask-gemini', async (req, res) => {
  const { question, login, systemOverride } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });

  try {
    let contextText = systemOverride || '';
    if (!systemOverride && login && needsData(question)) {
      contextText = await buildFullContext(login);
    }

    const systemPrompt = `Sen do'kon boshqaruv tizimining AI yordamchisisisan. O'zbek tilida javob ber.\n${contextText}\n\nSavol: `;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + question }] }]
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    res.json({ answer: data?.candidates?.[0]?.content?.parts?.[0]?.text || "Javob olinmadi" });
  } catch (error) {
    if (error.message?.includes("429")) {
      return res.status(429).json({ error: "Limit tugadi. Iltimos, bir ozdan keyin urinib ko'ring." });
    }
    res.status(500).json({ error: "Tizimda xatolik yuz berdi." });
  }
});

// 📌 Grok AI endpoint
router.post('/ask-grok', async (req, res) => {
  const { question, login, systemOverride } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });

  try {
    let systemPrompt = systemOverride || '';
    if (!systemOverride && login && needsData(question)) {
      const context = await buildFullContext(login);
      systemPrompt = `Sen do'kon boshqaruv tizimining AI yordamchisisisan. O'zbek tilida javob ber.\n${context}`;
    } else if (!systemOverride) {
      systemPrompt = 'Sen do\'kon boshqaruv tizimining AI yordamchisisisan. O\'zbek tilida javob ber.';
    }

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "grok-4-latest",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ],
        stream: false,
        temperature: 0.7
      })
    });

    if (!response.ok) throw new Error(`Grok API xatosi: ${response.status}`);
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    console.error("❌ Grok xatosi:", error.message);
    res.status(500).json({ error: "Grok bilan aloqa xatosi" });
  }
});

// 📌 DeepSeek AI endpoint — ASOSIY AI AGENT
router.post('/ask-deepseek', async (req, res) => {
  const { question, login, systemOverride } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });

  try {
    let systemPrompt = '';

    // Frontend systemOverride yuborilgan bo'lsa (Ai.tsx sahifasi)
    if (systemOverride) {
      systemPrompt = systemOverride;
    } else if (login) {
      // Avtomatik ma'lumot olish
      const context = await buildFullContext(login);
      systemPrompt = `Sen professional savdo tahlilchisi va biznes maslahatchisisisan. 
Sening vazifang do'kon ma'lumotlarini real vaqtda tahlil qilib, amaliy maslahatlar berishdir.

QOIDALAR:
1. Faqat berilgan ma'lumotlarga asoslan
2. Raqamlarni aniq ko'rsat
3. Har doim amaliy tavsiyalar ber
4. O'zbek tilida javob ber
5. Markdown formatidan foydalan

${context}`;
    } else {
      systemPrompt = 'Sen do\'kon boshqaruv tizimining AI yordamchisisisan. O\'zbek tilida javob ber.';
    }

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`DeepSeek API xatosi: ${response.status} — ${JSON.stringify(errData)}`);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "❌ Javob olinmadi";
    res.json({ answer });
  } catch (error) {
    console.error("❌ DeepSeek xatosi:", error.message);
    res.status(500).json({ error: "DeepSeek bilan aloqa xatosi: " + error.message });
  }
});

module.exports = router;