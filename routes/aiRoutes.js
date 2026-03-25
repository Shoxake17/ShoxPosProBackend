const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Dinamik Sales model
function getSalesModel(login) {
  const collectionName = `sales_${login}`;
  const modelName = `Sale_${login}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({
    barcode: String, name: String, quantity: Number, price: Number,
    basePrice: Number, category: String, total: Number,
    paymentMethod: { type: String, default: 'cash' },
    soldAt: { type: Date, default: Date.now }
  });
  return mongoose.model(modelName, schema, collectionName);
}

// Dinamik Products model
function getProductModel(login) {
  const collectionName = `products_${login}`;
  const modelName = `Product_${login}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({
    barcode: String, name: String, basePrice: Number, price: Number,
    category: String, quantity: Number, sold: { type: Number, default: 0 }
  });
  return mongoose.model(modelName, schema, collectionName);
}

// Ma'lumotlar kontekstini yaratish (faqat frontend so'raganda)
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
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now); monthStart.setDate(now.getDate() - 30);

    const filterByDate = (sales, from) => sales.filter(s => s.soldAt && new Date(s.soldAt) >= from);
    const calcStats = (sales) => ({
      total:  sales.reduce((s, i) => s + (i.total || 0), 0),
      profit: sales.reduce((s, i) => s + ((i.price || 0) - (i.basePrice || 0)) * (i.quantity || 1), 0),
      qty:    sales.reduce((s, i) => s + (i.quantity || 0), 0),
      count:  sales.length
    });

    const todayStats = calcStats(filterByDate(allSales, todayStart));
    const weekStats  = calcStats(filterByDate(allSales, weekStart));
    const monthStats = calcStats(filterByDate(allSales, monthStart));
    const allStats   = calcStats(allSales);

    const productMap = {};
    allSales.forEach(s => {
      const key = s.barcode || s.name || 'unknown';
      if (!productMap[key]) productMap[key] = { name: s.name, qty: 0, total: 0, profit: 0 };
      productMap[key].qty    += s.quantity || 0;
      productMap[key].total  += s.total || 0;
      productMap[key].profit += ((s.price || 0) - (s.basePrice || 0)) * (s.quantity || 1);
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.total - a.total).slice(0, 15);

    const catMap = {};
    allSales.forEach(s => {
      const cat = s.category || "Noma'lum";
      if (!catMap[cat]) catMap[cat] = { total: 0, qty: 0 };
      catMap[cat].total += s.total || 0;
      catMap[cat].qty   += s.quantity || 0;
    });

    const lowStock    = allProducts.filter(p => (p.quantity || 0) < 10).sort((a, b) => (a.quantity||0)-(b.quantity||0)).slice(0, 20);
    const lossProducts = allProducts.filter(p => (p.price || 0) < (p.basePrice || 0));

    const paymentMap = {};
    allSales.forEach(s => {
      const pm = s.paymentMethod || 'cash';
      paymentMap[pm] = (paymentMap[pm] || 0) + (s.total || 0);
    });

    return `
=== ${login.toUpperCase()} DO'KONI — REAL MA'LUMOTLAR ===
Sana: ${now.toLocaleDateString('uz-UZ')} ${now.toLocaleTimeString('uz-UZ')}

📅 BUGUNGI KUN:
  Savdo: ${todayStats.total.toLocaleString()} so'm | Foyda: ${todayStats.profit.toLocaleString()} so'm | ${todayStats.qty} dona (${todayStats.count} op.)

📅 7 KUNLIK:
  Savdo: ${weekStats.total.toLocaleString()} so'm | Foyda: ${weekStats.profit.toLocaleString()} so'm | ${weekStats.qty} dona

📅 30 KUNLIK:
  Savdo: ${monthStats.total.toLocaleString()} so'm | Foyda: ${monthStats.profit.toLocaleString()} so'm | ${monthStats.qty} dona

📅 JAMI:
  Savdo: ${allStats.total.toLocaleString()} so'm | Foyda: ${allStats.profit.toLocaleString()} so'm | ${allStats.count} yozuv

🏆 TOP 15 MAHSULOT:
${topProducts.map((p, i) => `  ${i+1}. ${p.name||"Noma'lum"}: ${p.total.toLocaleString()} so'm | ${p.qty} dona | Foyda: ${p.profit.toLocaleString()} so'm`).join('\n')}

📊 KATEGORIYALAR:
${Object.entries(catMap).sort((a,b)=>b[1].total-a[1].total).map(([c,s])=>`  ${c}: ${s.total.toLocaleString()} so'm (${s.qty} dona)`).join('\n')}

💳 TO'LOV USULLARI:
${Object.entries(paymentMap).map(([pm,t])=>`  ${pm}: ${t.toLocaleString()} so'm`).join('\n')}

⚠️ KAM ZAXIRA:
${lowStock.length > 0 ? lowStock.map(p=>`  ${p.name} (${p.barcode}): ${p.quantity||0} dona`).join('\n') : '  Yetarli'}

❌ ZARAR MAHSULOTLAR:
${lossProducts.length > 0 ? lossProducts.map(p=>`  ${p.name}: sotuv ${p.price} | xarid ${p.basePrice} | zarar: ${((p.basePrice||0)-(p.price||0)).toLocaleString()} so'm`).join('\n') : "  Yo'q ✅"}

📦 MAHSULOTLAR BAZA:
  Jami tur: ${allProducts.length} ta | Jami zaxira: ${allProducts.reduce((s,p)=>s+(p.quantity||0),0)} dona
`;
  } catch (err) {
    console.error('Context yaratishda xato:', err);
    return "Ma'lumotlarni yuklashda xato yuz berdi.";
  }
}

// ─────────────────────────────────────────────────────────────────
// UMUMIY HELPER — barcha endpointlar uchun system prompt yaratish
// useStore=true bo'lsa bazadan ma'lumot oladi, false bo'lsa oddiy AI
// ─────────────────────────────────────────────────────────────────
async function buildSystemPrompt({ systemOverride, useStore, login }) {
  // 1. Frontend o'zi to'liq system prompt yuborgan bo'lsa — shuni ishlatamiz
  if (systemOverride) return systemOverride;

  // 2. Do'kon rejimi — bazadan real ma'lumot olish
  if (useStore && login) {
    const context = await buildFullContext(login);
    return `Sen professional savdo tahlilchisi va biznes maslahatchisisisan.
Faqat berilgan ma'lumotlarga asoslan, raqamlarni aniq ko'rsat, amaliy tavsiyalar ber.
O'zbek tilida javob ber. Markdown formatidan foydalan.\n\n${context}`;
  }

  // 3. Oddiy AI rejimi — bazasiz, erkin javob
  return `Sen aqlli va foydali AI yordamchisisisan. 
Foydalanuvchi har qanday savol berishi mumkin: tahlil, maslahat, tarjima, kod, matematika va boshqalar.
O'zbek tilida, aniq va tushunarli javob ber. Markdown formatidan foydalan.`;
}

// ─── DeepSeek ─────────────────────────────────────────────────────────────────
router.post('/ask-deepseek', async (req, res) => {
  const { question, login, systemOverride, useStore } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });
  try {
    const systemPrompt = await buildSystemPrompt({ systemOverride, useStore, login });
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
        stream: false, temperature: 0.7, max_tokens: 2048
      })
    });
    if (!response.ok) throw new Error(`DeepSeek: ${response.status}`);
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    console.error("❌ DeepSeek:", error.message);
    res.status(500).json({ error: "DeepSeek bilan aloqa xatosi: " + error.message });
  }
});

// ─── Gemini ───────────────────────────────────────────────────────────────────
router.post('/ask-gemini', async (req, res) => {
  const { question, login, systemOverride, useStore } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });
  try {
    const systemPrompt = await buildSystemPrompt({ systemOverride, useStore, login });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + "\n\nSavol: " + question }] }] })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({ answer: data?.candidates?.[0]?.content?.parts?.[0]?.text || "Javob olinmadi" });
  } catch (error) {
    if (error.message?.includes("429")) return res.status(429).json({ error: "Limit tugadi." });
    res.status(500).json({ error: "Gemini bilan aloqa xatosi." });
  }
});

// ─── Grok ─────────────────────────────────────────────────────────────────────
router.post('/ask-grok', async (req, res) => {
  const { question, login, systemOverride, useStore } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });
  try {
    const systemPrompt = await buildSystemPrompt({ systemOverride, useStore, login });
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.XAI_API_KEY}` },
      body: JSON.stringify({
        model: "grok-4-latest",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
        stream: false, temperature: 0.7
      })
    });
    if (!response.ok) throw new Error(`Grok: ${response.status}`);
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    res.status(500).json({ error: "Grok bilan aloqa xatosi." });
  }
});

// ─── OpenAI ───────────────────────────────────────────────────────────────────
router.post('/ask-openai', async (req, res) => {
  const { question, login, systemOverride, useStore } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });
  try {
    const systemPrompt = await buildSystemPrompt({ systemOverride, useStore, login });
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }]
      })
    });
    if (!response.ok) throw new Error(`OpenAI: ${response.status}`);
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    res.status(500).json({ error: "OpenAI bilan aloqa xatosi." });
  }
});

// ─── Groqs ─────────────────────────────────────────────────────────────────────
router.post('/ask-groq-ai', async (req, res) => {
  const { question, login, systemOverride, useStore, groqModel } = req.body;
  if (!question) return res.status(400).json({ error: 'Savol kiritilmagan' });
  try {
    const systemPrompt = await buildSystemPrompt({ systemOverride, useStore, login });
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: groqModel || "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
        temperature: 0.7, max_tokens: 2048, stream: false
      })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Groq: ${response.status} — ${JSON.stringify(errData)}`);
    }
    const data = await response.json();
    res.json({ answer: data.choices?.[0]?.message?.content || "❌ Javob olinmadi" });
  } catch (error) {
    if (error.message?.includes("429")) return res.status(429).json({ error: "Groq limit tugadi." });
    res.status(500).json({ error: "Groq bilan aloqa xatosi: " + error.message });
  }
});

module.exports = router;