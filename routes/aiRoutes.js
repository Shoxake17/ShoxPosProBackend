const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Dinamik Sales model (salesRoutes.js dan olingan)
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
    soldAt: { type: Date, default: Date.now } 
  });

  return mongoose.model(modelName, schema, collectionName);
}

// Savolga ma'lumot kerakligini aniqlash funksiyasi
function needsData(question) {
  const lower = question.toLowerCase();
  const keywords = ['sotil', 'sotuv', 'hisobot', 'daromad', 'foyda', 'mahsulot', 'kategoriya', 'top', 'bugun', 'hafta', 'oy', 'qancha', 'necha', 'summasi', 'miqdori'];
  return keywords.some(k => lower.includes(k));
}

// 📌 OpenAI ChatGPT endpoint
router.post('/ask-openai', async (req, res) => {
  const { question, login } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Savol kiritilmagan' });
  }

  try {
    let dataSummary = '';
    if (login && needsData(question)) {
      const Sales = getSalesModel(login);
      const sales = await Sales.find().sort({ soldAt: -1 }).lean();
      dataSummary = `Foydalanuvchining savoliga javob berishda quyidagi savdo ma'lumotlaridan foydalaning (JSON formatida, soldAt - sana va vaqt, quantity - miqdor, total - umumiy summa, va h.k.):\n${JSON.stringify(sales, null, 2)}\n\nMa'lumotlarni tahlil qilib, agregatlar (summa, son, va h.k.) hisoblang va javobni o'zbek tilida bering agar savol o'zbek tilida bo'lsa. Bugungi sana: ${new Date().toLocaleDateString('uz-UZ')}.`;
    }

    const systemPrompt = `You are a helpful AI assistant for a store management system. Respond in Uzbek if the query is in Uzbek. ${dataSummary}`;

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

    if (!response.ok) {
      throw new Error(`OpenAI API xatosi: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "❌ Javob olinmadi";
    
    res.json({ answer });
  } catch (error) {
    console.error("❌ OpenAI xatosi:", error.message);
    res.status(500).json({ error: "OpenAI bilan aloqa xatosi" });
  }
});

// 📌 Gemini Pro endpoint
router.post('/ask-gemini', async (req, res) => {
  const { question, login } = req.body; // JSON bodydan questionni oladi

  if (!question) {
    return res.status(400).json({ error: 'Savol kiritilmagan' });
  }

  try {
    let dataSummary = '';
    if (login && needsData(question)) {
      const Sales = getSalesModel(login);
      const sales = await Sales.find().sort({ soldAt: -1 }).lean();
      dataSummary = `Foydalanuvchining savoliga javob berishda quyidagi savdo ma'lumotlaridan foydalaning (JSON formatida, soldAt - sana va vaqt, quantity - miqdor, total - umumiy summa, va h.k.):\n${JSON.stringify(sales, null, 2)}\n\nMa'lumotlarni tahlil qilib, agregatlar (summa, son, va h.k.) hisoblang va javobni o'zbek tilida bering agar savol o'zbek tilida bo'lsa. Bugungi sana: ${new Date().toLocaleDateString('uz-UZ')}.`;
    }

    const systemPrompt = `You are a helpful AI assistant for a store management system. Respond in Uzbek if the query is in Uzbek. ${dataSummary}\n\nUser query: `;

    // Siz test qilgan va ishlayotgan URL:
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt + question }] }]
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Javob olinmadi";
    res.json({ answer });

  }  catch (error) {
    if (error.message.includes("429")) {
        return res.status(429).json({ error: "Limit tugadi. Iltimos, bir ozdan keyin urinib ko'ring." });
    }
    res.status(500).json({ error: "Tizimda xatolik yuz berdi." });
}
});

// 📌 Grok AI endpoint
router.post('/ask-grok', async (req, res) => {
  const { question, login } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Savol kiritilmagan' });
  }

  try {
    let dataSummary = '';
    if (login && needsData(question)) {
      const Sales = getSalesModel(login);
      const sales = await Sales.find().sort({ soldAt: -1 }).lean();
      dataSummary = `Foydalanuvchining savoliga javob berishda quyidagi savdo ma'lumotlaridan foydalaning (JSON formatida, soldAt - sana va vaqt, quantity - miqdor, total - umumiy summa, va h.k.):\n${JSON.stringify(sales, null, 2)}\n\nMa'lumotlarni tahlil qilib, agregatlar (summa, son, va h.k.) hisoblang va javobni o'zbek tilida bering agar savol o'zbek tilida bo'lsa. Bugungi sana: ${new Date().toLocaleDateString('uz-UZ')}.`;
    }

    const systemPrompt = `You are a helpful AI assistant for a store management system. Respond in Uzbek if the query is in Uzbek. ${dataSummary}`;

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

    if (!response.ok) {
      throw new Error(`Grok API xatosi: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "❌ Javob olinmadi";
    
    res.json({ answer });
  } catch (error) {
    console.error("❌ Grok xatosi:", error.message);
    res.status(500).json({ error: "Grok bilan aloqa xatosi" });
  }
});


// 📌 DeepSeek AI endpoint
router.post('/ask-deepseek', async (req, res) => {
  const { question, login } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Savol kiritilmagan' });
  }

  try {
    let dataSummary = '';
    if (login && needsData(question)) {
      const Sales = getSalesModel(login);
      const sales = await Sales.find().sort({ soldAt: -1 }).lean();
      dataSummary = `Foydalanuvchining savoliga javob berishda quyidagi savdo ma'lumotlaridan foydalaning (JSON formatida, soldAt - sana va vaqt, quantity - miqdor, total - umumiy summa, va h.k.):\n${JSON.stringify(sales, null, 2)}\n\nMa'lumotlarni tahlil qilib, agregatlar (summa, son, va h.k.) hisoblang va javobni o'zbek tilida bering agar savol o'zbek tilida bo'lsa. Bugungi sana: ${new Date().toLocaleDateString('uz-UZ')}.`;
    }

    const systemPrompt = `You are a helpful AI assistant for a store management system. Respond in Uzbek if the query is in Uzbek. ${dataSummary}`;

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}` // .env faylda saqlanadi
      },
      body: JSON.stringify({
        model: "deepseek-chat", // DeepSeek model nomi (docs’dan tanlanadi)
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ],
        stream: false,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API xatosi: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "❌ Javob olinmadi";

    res.json({ answer });
  } catch (error) {
    console.error("❌ DeepSeek xatosi:", error.message);
    res.status(500).json({ error: "DeepSeek bilan aloqa xatosi" });
  }
});


module.exports = router;