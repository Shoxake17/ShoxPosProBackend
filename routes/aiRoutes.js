const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const verifyToken = require('../middleware/verifyToken');
const ChatHistory = require('../models/ChatHistory');
const { encryptAndCompress, decryptAndDecompress } = require('../utils/chatCrypto');

module.exports = (csrfProtection) => {
  const router = express.Router();

// ─── Chat Tarixi Funksiyalari (Bucket Pattern + Encryption) ───────────

/** Xabarni saqlash (Optimallashtirilgan: Butun massivni bitta shifrda saqlash) */
async function saveChatMessage(login, role, content, modelId = 'shox-ai') {
  try {
    // Oxirgi to'lmagan bucketni topish
    let bucket = await ChatHistory.findOne({ login, isFull: false }).sort({ bucketId: -1 });

    let messages = [];
    if (bucket) {
      try {
        messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
      } catch (e) {
        console.error('Bucket dekripsiya xatosi, yangi massiv boshlanmoqda');
        messages = [];
      }
    } else {
      const lastBucket = await ChatHistory.findOne({ login }).sort({ bucketId: -1 });
      const newBucketId = lastBucket ? lastBucket.bucketId + 1 : 0;
      bucket = new ChatHistory({ login, bucketId: newBucketId, encryptedMessages: '' });
    }

    // Yangi xabarni qo'shish
    messages.push({ 
      role, 
      content, // Asl matn (saqlashdan oldin hammasi birga shifrlanadi)
      modelId,
      timestamp: new Date()
    });

    // Butun massivni siqish va shifrlash
    bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
    bucket.count = messages.length;

    if (bucket.count >= 500) {
      bucket.isFull = true;
    }

    await bucket.save();
  } catch (err) {
    console.error('Chat saqlashda xato:', err.message);
  }
}

/** Tarixni olish (Optimallashtirilgan) */
async function getChatHistory(login) {
  try {
    const buckets = await ChatHistory.find({ login }).sort({ bucketId: 1 }).lean();
    const allMessages = [];
    
    for (const bucket of buckets) {
      try {
        const messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
        for (const msg of messages) {
          allMessages.push({
            role: msg.role === 'assistant' ? 'ai' : 'user',
            content: msg.content,
            modelId: msg.modelId || 'shox-ai',
            timestamp: msg.timestamp
          });
        }
      } catch (e) {
        console.error(`Bucket ${bucket.bucketId} o'qishda xato:`, e.message);
      }
    }
    return allMessages;
  } catch (err) {
    console.error('Tarixni olishda xato:', err.message);
    return [];
  }
}

const Sale = require('../models/Sale');
const Debt = require('../models/Debt');
const Product = require('../models/Product');

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
    const safeLogin = String(login).trim().toLowerCase();

    const [allSales, allProducts] = await Promise.all([
      Sale.find({ login: safeLogin }).sort({ soldAt: -1 }).lean(),
      Product.find({ login: safeLogin }).lean()
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
      const allDebts = await Debt.find({ login: safeLogin }).lean();
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

// 📌 Chat tarixini olish
router.get('/ai/history/:login', verifyToken, async (req, res) => {
  const { login } = req.params;
  const safeLogin = String(login).trim().toLowerCase();
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }
  const history = await getChatHistory(safeLogin);
  res.json(history);
});

// 📌 Chat tarixini tozalash
router.delete('/ai/history/:login', verifyToken, csrfProtection, async (req, res) => {
  const { login } = req.params;
  const safeLogin = String(login).trim().toLowerCase();
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }
  await ChatHistory.deleteMany({ login: safeLogin });
  res.json({ success: true, message: "Tarix tozalandi" });
});

// 📌 Groq AI endpoint
router.post('/ask-groq-ai', verifyToken, csrfProtection, async (req, res) => {
  console.log(`[AI] Groq request: ${req.body.login}, model: ${req.body.groqModel}`);
  const { question, login, groqModel, systemOverride, modelId: feModelId } = req.body;
  if (!question || !login) return res.status(400).json({ error: 'Savol va login kiritilmagan' });

  const safeLogin = String(login).trim().toLowerCase();
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      console.error("❌ [Groq] API Key topilmadi");
      throw new Error("GROQ_API_KEY topilmadi. Iltimos, server sozlamalarini tekshiring.");
    }

    const groqModelId = groqModel || 'llama-3.3-70b-versatile';
    const historyModelId = feModelId || groqModelId;
    console.log(`[Groq] Saving user message...`);
    await saveChatMessage(safeLogin, 'user', question, historyModelId);

    let systemPrompt = systemOverride || 'Sen do\'kon boshqaruv tizimining AI yordamchisisisan. O\'zbek tilida javob ber.';
    if (!systemOverride && login && needsData(question)) {
      console.log(`[Groq] Building context...`);
      const context = await buildFullContext(login);
      systemPrompt += `\n${context}`;
    }

    console.log(`[Groq] Calling Groq API with model: ${groqModelId}`);
    const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: groqModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      timeout: 30000 // 30 soniya timeout
    });

    const answer = response.data.choices?.[0]?.message?.content || "❌ Javob olinmadi";

    await saveChatMessage(safeLogin, 'assistant', answer, historyModelId);
    res.json({ answer });
  } catch (error) {
    let errorMsg = "Groq bilan aloqa xatosi";
    if (error.response) {
      // API dan kelgan xato
      errorMsg = error.response.data?.error?.message || `Groq API Error: ${error.response.status}`;
      console.error(`❌ Groq API xatosi (${error.response.status}):`, JSON.stringify(error.response.data));
    } else if (error.request) {
      // So'rov yuborildi, lekin javob kelmadi
      errorMsg = "Groq serveridan javob olinmadi (Network error)";
      console.error(`❌ Groq Network xatosi:`, error.message);
    } else {
      // Boshqa xato
      errorMsg = error.message;
      console.error(`❌ Groq Controller xatosi:`, error.message);
    }

    res.status(500).json({ 
      error: errorMsg,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});



// 📌 ShoxAI endpoint 
router.post('/ask-shoxai', verifyToken, csrfProtection, async (req, res) => {
  const { question, login, systemOverride, modelId: feModelId } = req.body;
  if (!question || !login) return res.status(400).json({ error: 'Savol va login kiritilmagan' });

  // 🛡️ A01: Broken Access Control
  const safeLogin = String(login).trim().toLowerCase();
  console.log("🔑 [ShoxAI] req.user.login:", req.user.login, "vs safeLogin:", safeLogin);
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }

  try {
    const historyModelId = feModelId || 'shox-ai';
    // User xabarini saqlash
    await saveChatMessage(safeLogin, 'user', question, historyModelId);

    let systemPrompt = '';

    // Frontend systemOverride yuborilgan bo'lsa (Ai.tsx sahifasi)
    if (systemOverride) {
      systemPrompt = systemOverride;
    } else if (login) {
      // Avtomatik ma'lumot olish
      const context = await buildFullContext(login);
      systemPrompt = `Men Shoxrux tomonidan yaratilgan ShoxAi modeliman. Professional savdo tahlilchisi va biznes maslahatchisisisan. 
Sening vazifang do'kon ma'lumotlarini real vaqtda tahlil qilib, amaliy maslahatlar berishdir.

QOIDALAR:
1. Ismingni so'rashsa: "Men Shoxrux tomonidan yaratilgan ShoxAi modeliman" deb javob ber.
2. Faqat berilgan ma'lumotlarga asoslan
3. Raqamlarni aniq ko'rsat
4. Har doim amaliy tavsiyalar ber
5. O'zbek tilida javob ber
6. Markdown formatidan foydalan

${context}`;
    } else {
      systemPrompt = 'Men Shoxrux tomonidan yaratilgan ShoxAi modeliman. Do\'kon boshqaruv tizimining AI yordamchisisisan. O\'zbek tilida javob ber.';
    }

    const response = await axios.post("https://api.deepseek.com/v1/chat/completions", {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      timeout: 30000
    });

    const answer = response.data.choices?.[0]?.message?.content || "❌ Javob olinmadi";

    // AI javobini saqlash
    await saveChatMessage(safeLogin, 'assistant', answer, historyModelId);

    res.json({ answer });
  } catch (error) {
    let errorMsg = "ShoxAi  bilan aloqa xatosi";
    if (error.response) {
      errorMsg = error.response.data?.error?.message || `ShoxAi Modelida xatolik: ${error.response.status}`;
    } else if (error.request) {
      errorMsg = "ShoxAi serveridan javob olinmadi";
    } else {
      errorMsg = error.message;
    }
    console.error("❌ ShoxAi xatosi:", errorMsg);
    res.status(500).json({ error: errorMsg });
  }
});

// 📌 ShoxAi-Lite endpoint
router.post('/shoxai-lite', verifyToken, csrfProtection, async (req, res) => {
  const { question, login, systemOverride, modelId: feModelId } = req.body;
  
  if (!question || !login) {
    return res.status(400).json({ error: 'Savol va login kiritilmagan' });
  }

  const safeLogin = String(login).trim().toLowerCase();
  
  // 🛡️ Xavfsizlik tekshiruvi
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }

  try {
    // 1. Foydalanuvchi xabarini saqlash (Model ID yangilandi)
    const historyModelId = feModelId || 'gemini-2.5-flash';
    await saveChatMessage(safeLogin, 'user', question, historyModelId);

    // 2. Kontekstni tayyorlash
    let contextText = systemOverride || '';
    if (!systemOverride && login && needsData(question)) {
      console.log(`[ShoxAI Lite] Building data context for ${login}...`);
      contextText = await buildFullContext(login);
    }

    const systemPrompt = `Men Shoxrux tomonidan yaratilgan ShoxAi-Lite modelisan. Do'kon boshqaruv tizimining professional AI yordamchisisisan. O'zbek tilida javob ber.\n\n${contextText}`;


    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await axios.post(url, {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nFoydalanuvchi savoli: ${question}` }]
        }
      ],
      // ✨ Yangi: Javob sifatini nazorat qilish uchun parametrlar
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    }, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000 // 30 soniya
    });

    // 4. Javobni qabul qilish
    const answer = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!answer) {
      throw new Error("ShoxAI Lite modelidan bo'sh javob qaytdi yoki xavfsizlik filtri blokladi.");
    }

    // 5. AI javobini saqlash
    await saveChatMessage(safeLogin, 'assistant', answer, historyModelId);

    res.json({ answer });

  } catch (error) {
    let errorMsg = "ShoxAi Lite tizimida kutilmagan xatolik yuz berdi.";
    
    if (error.response) {
      const status = error.response.status;
      const remoteError = error.response.data?.error?.message || "";
      
      console.error(`❌ ShoxAI Lite API Error [Ushbu modelga hozirda talab yuqori. Talabning keskin o'sishi odatda vaqtinchalik. Iltimos, keyinroq qayta urinib ko'ring.]:`, remoteError);

      if (status === 429) {
        errorMsg = "ShoxAI Lite limiti tugadi. Iltimos, bir necha daqiqadan so'ng urinib ko'ring.";
      } else if (status === 404) {
        errorMsg = "Model topilmadi (ShoxAI Lite). Iltimos, model nomini tekshiring.";
      } else {
        errorMsg = `ShoxAI Lite xatosi: ${remoteError || status}`;
      }
    } else if (error.request) {
      console.error("❌ ShoxAI Lite Network Error: Serverdan javob kelmadi.");
      errorMsg = "Internet aloqasi yoki Google serverlari bilan bog'liq muammo.";
    } else {
      console.error("❌ Controller Error:", error.message);
      errorMsg = error.message;
    }

    res.status(500).json({ error: errorMsg });
  }
});

// 📌 OpenRouter AI endpoint
router.post('/ask-openrouter', verifyToken, csrfProtection, async (req, res) => {
  const { question, login, orModel, systemOverride, modelId: feModelId } = req.body;
  if (!question || !login) return res.status(400).json({ error: 'Savol va login kiritilmagan' });

  const safeLogin = String(login).trim().toLowerCase();
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }

  try {
    const orModelId = orModel || 'deepseek/deepseek-chat';
    const historyModelId = feModelId || orModelId;
    await saveChatMessage(safeLogin, 'user', question, historyModelId);

    let systemPrompt = systemOverride || 'Sen professional AI yordamchisan. O\'zbek tilida javob ber.';
    if (!systemOverride && login && needsData(question)) {
      const context = await buildFullContext(login);
      systemPrompt += `\n\n${context}`;
    }

    console.log(`[OpenRouter] Calling API with model: ${orModelId}`);
    const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: orModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ],
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://shoxpospro.uz",
        "X-Title": "ShoxPosPro"
      },
      timeout: 45000
    });

    const answer = response.data.choices?.[0]?.message?.content || "❌ Javob olinmadi";

    await saveChatMessage(safeLogin, 'assistant', answer, historyModelId);
    res.json({ answer });
  } catch (error) {
    let errorMsg = "OpenRouter bilan aloqa xatosi";
    if (error.response) {
      errorMsg = error.response.data?.error?.message || `OpenRouter API Error: ${error.response.status}`;
      console.error(`❌ OpenRouter API xatosi (${error.response.status}):`, JSON.stringify(error.response.data));
    } else {
      errorMsg = error.message;
      console.error(`❌ OpenRouter xatosi:`, error.message);
    }
    res.status(500).json({ error: errorMsg });
  }
});

// 📌 Together.ai endpoint
router.post('/ask-together', verifyToken, csrfProtection, async (req, res) => {
  const { question, login, togetherModel, systemOverride, modelId: feModelId } = req.body;
  if (!question || !login) return res.status(400).json({ error: 'Savol va login kiritilmagan' });

  const safeLogin = String(login).trim().toLowerCase();
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat etilmagan!" });
  }

  try {
    const tgModelId = togetherModel || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
    const historyModelId = feModelId || tgModelId;
    await saveChatMessage(safeLogin, 'user', question, historyModelId);

    let systemPrompt = systemOverride || 'Sen professional AI yordamchisan. O\'zbek tilida javob ber.';
    if (!systemOverride && login && needsData(question)) {
      const context = await buildFullContext(login);
      systemPrompt += `\n\n${context}`;
    }

    console.log(`[Together] Calling API with model: ${tgModelId}`);
    const response = await axios.post("https://api.together.xyz/v1/chat/completions", {
      model: tgModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ],
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 0.7,
      top_k: 50,
      repetition_penalty: 1,
      stop: ["<|eot_id|>", "<|file_separator|>"]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.TOGETHER_API_KEY}`
      },
      timeout: 40000
    });

    const answer = response.data.choices?.[0]?.message?.content || "❌ Javob olinmadi";
    await saveChatMessage(safeLogin, 'assistant', answer, historyModelId);

    res.json({ answer });
  } catch (error) {
    console.error("❌ Together.ai xatosi:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error?.message || "Together.ai aloqa xatosi" });
  }
});

  return router;
};