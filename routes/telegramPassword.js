const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const { verifyCode } = require('./telegramAuth.js'); // bot5'dan kodni tekshiruvchi funksiya

const bot4 = new TelegramBot(process.env.BOT4_TOKEN, { polling: true });
const bot4ChatIds = process.env.BOT4_CHAT_IDS?.split(',').map(id => id.trim()) || [];

// 🔐 Ro‘yxatdan o‘tgan foydalanuvchilarni saqlash
const verifiedUsers = new Set();


// 🧠 ID-Parol mapping
const accessMap = new Map();

// 🔐 Parolni tekshirish
router.post('/verify-password', (req, res) => {
  const { accessId, password } = req.body;
  const correct = accessMap.get(accessId);

  if (correct && password === correct) {
    accessMap.delete(accessId);
    return res.json({ success: true });
  }

  bot4ChatIds.forEach(chatId => {
    bot4.sendMessage(chatId, `🚫 Noto‘g‘ri parol urunishi:\nID: ${accessId}\nKiritilgan: ${password}`);
  });

  res.status(403).json({ success: false, message: '❌ Parol noto‘g‘ri yoki muddati o‘tgan' });
});

// 🧾 Parol yaratish
router.post('/request-password', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: 'ID kiritilmagan' });

  const password = Math.floor(100000 + Math.random() * 900000).toString();
  accessMap.set(id, password);

  // 🕒 TTL: 5 daqiqa
  setTimeout(() => {
    accessMap.delete(id);
  }, 5 * 60 * 1000);

  res.json({ success: true, message: 'Parol yaratildi, Telegramga yuborilmaydi' });
});

// 📤 Parolni Telegramga yuborish
router.post('/send-password-to-telegram', (req, res) => {
  const { id } = req.body;
  const password = accessMap.get(id);

  if (!password) {
    return res.status(404).json({ success: false, message: 'Parol topilmadi yoki muddati o‘tgan' });
  }

  bot4ChatIds.forEach(chatId => {
    bot4.sendMessage(chatId, `🛡️ Kirim dashboard uchun ID:\nID: ${id}\nParol: ${password}`)
      .catch(err => console.error(`❌ Yuborilmadi (${chatId}):`, err.message));
  });

  res.json({ success: true, message: 'Parol Telegramga yuborildi' });
});

// 📲 Bot4 xabarlar bilan ishlash
// 📲 Bot4 xabarlar bilan ishlash
bot4.on('message', msg => {
  const chatId = msg.chat.id.toString();
  const text = msg.text?.trim();

  // 🔐 Kod tekshirish (6 xonali)
  if (/^\d{6}$/.test(text)) {
    const isValid = verifyCode(chatId, text);

    if (isValid) {
      verifiedUsers.add(chatId); // ✅ Ro‘yxatdan o‘tganlar ro‘yxatiga qo‘shamiz
      bot4.sendMessage(chatId, `✅ Kod to‘g‘ri. Xush kelibsiz boshliq.`);

      const password = accessMap.get(chatId);
      if (password) {
        bot4.sendMessage(chatId, `🛡️ Sizning dashboard parolingiz:\nID: ${chatId}\nParol: ${password}`);
      } else {
        bot4.sendMessage(chatId, `ℹ️ 4 xonali parolni kiriting.`);
      }

    } else {
      bot4.sendMessage(chatId, `🚫 Kod noto‘g‘ri. Sizga bu botga kirish ruxsati berilmagan.`);
    }

  // 🔍 ID orqali parol so‘rash (4 xonali)
  } else if (/^\d{4}$/.test(text)) {
    if (!verifiedUsers.has(chatId)) {
      bot4.sendMessage(chatId, `🔒 Avval ro‘yxatdan o‘tish kodini yuboring (6 xonali). Keyin parolni olishingiz mumkin. Royhatdan o'tish uchun @ShoxPosProAuth_bot`);
      return;
    }

    const password = accessMap.get(text);
    if (password) {
      bot4.sendMessage(chatId, `🛡️ Kirim dashboard uchun parolingiz:\nID: ${text}\nParol: ${password}`);
    } else {
      bot4.sendMessage(chatId, `⚠️ Bu ID uchun parol topilmadi yoki muddati o‘tgan:\nID: ${text}`);
    }

  } else {
    bot4.sendMessage(chatId, `ℹ️ Iltimos, faqat 4 xonanali ID yuboring.`);
  }
});


module.exports = router;
