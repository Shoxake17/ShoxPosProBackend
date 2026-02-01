const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const allowedPath = './allowedUsers.json';

const path = require('path'); 
const usersPath = path.join(__dirname, '../data/users.json')

const axios = require('axios');
const FormData = require('form-data');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

process.env.NTBA_FIX_350 = true;

const upload = multer({ dest: 'uploads/' });

const bot1 = new TelegramBot(process.env.BOT1_TOKEN, { polling: false });
const bot2 = new TelegramBot(process.env.BOT2_TOKEN, { polling: true });
const bot3 = new TelegramBot(process.env.BOT3_TOKEN, { polling: true });

const bot1ChatIds = process.env.BOT1_CHAT_IDS?.split(',').map(id => id.trim()) || [];
const bot2ChatIds = process.env.BOT2_CHAT_IDS?.split(',').map(id => id.trim()) || [];
const bot3ChatIds = process.env.BOT3_CHAT_IDS?.split(',').map(id => id.trim()) || [];

const chekStore = new Map();
const reportStore = new Map();
const redis = require('../utils/redis');
const { scheduleDelete } = require('../utils/messageCleaner');
const { handleQrCashback } = require('../models/qrCashback');
const userState = new Map(); // chatId => { hasSentMyId: true }




let users = [];
if (fs.existsSync(usersPath)) {
  const raw = fs.readFileSync(usersPath);
  users = JSON.parse(raw);
}

// 📁 Faylni xavfsiz o‘chirish
async function safeUnlink(filePath) {
  try {
    await fs.promises.unlink(filePath);
    console.log(`🧹 Fayl o‘chirildi: ${filePath}`);
  } catch (err) {
    console.warn("⚠️ Faylni o‘chirishda xatolik:", err.message);
  }
}

function readUsersFromFile(path) {
  try {
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, 'utf-8'));
    }
  } catch (err) {
    console.warn("⚠️ Foydalanuvchilarni o‘qishda xatolik:", err.message);
  }
  return [];
}

// 📥 Foydalanuvchini qo‘shish
function registerUser(userId) {
  if (!users.includes(userId)) {
    users.push(userId);
    try {
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      console.log(`📥 Ro‘yxatga qo‘shildi: ${userId}`);
    } catch (err) {
      console.warn(`❌ registerUser yozishda xatolik:`, err.message);
    }
  }
  return users.length;
}





function getUserCount() {
  try {
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      return users.length;
    }
  } catch (err) {
    console.warn("⚠️ Foydalanuvchilarni o‘qishda xatolik:", err.message);
  }
  return 0;
}

//ShoxPosPro 1Bot

// 📤 Excel faylni Bot1 foydalanuvchilarga yuborish
async function sendExcelViaBot1(filePath, fileName) {
  const results = [];
  const safeFileName = path.basename(fileName);

  for (const chatId of bot1ChatIds) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', fs.createReadStream(filePath), {
      filename: safeFileName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${process.env.BOT1_TOKEN}/sendDocument`,
        form,
        { headers: form.getHeaders() }
      );
      results.push({ chatId, success: res.data.ok });
    } catch (err) {
      console.error(`❌ Bot1: ${chatId} ga yuborilmadi:`, err.message);
      results.push({ chatId, success: false });
    }
  }

  return results;
}

// 📦 Excel faylni yuborish
router.post('/send-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Fayl topilmadi' });

  const filePath = req.file.path;
  const fileName = req.file.originalname;

  try {
    const results = await sendExcelViaBot1(filePath, fileName);
    await safeUnlink(filePath);

    const allSuccess = results.every(r => r.success);
    const failed = results.filter(r => !r.success).map(r => r.chatId);

    return res.status(allSuccess ? 200 : 207).json({
      success: allSuccess,
      message: allSuccess ? '✅ Excel fayl yuborildi' : `⚠️ Ba'zilariga yuborilmadi: ${failed.join(', ')}`,
      details: results
    });
  } catch (err) {
    console.error('❌ Bot1 xatolik:', err.message);
    return res.status(500).json({ success: false, message: 'Telegramga yuborishda xatolik' });
  }
});

// 📊 Hisobotni saqlash
router.post('/store-report', (req, res) => {
  const { id, date, items, summary } = req.body;
  if (!id || !date || !Array.isArray(items)) {
    console.log("⚠️ Hisobot noto‘liq:", { id, date, items });
    return res.status(400).json({ success: false, message: "Ma'lumotlar to‘liq emas" });
  }

  reportStore.set(String(id), { date, items, summary });

  setTimeout(() => {
    reportStore.delete(String(id));
    console.log(`🧹 Hisobot ${id} avtomatik o‘chirildi`);
  }, 10 * 60 * 1000);

  console.log("✅ Hisobot saqlandi:", { id, itemCount: items.length });
  res.json({ success: true, message: "✅ Hisobot saqlandi", id });
});




// 📊 Hisobotni bot3 orqali yuborish


// 🧾 QR Chekni saqlash
router.post('/store-chek', (req, res) => {
  const { id, text, qr } = req.body;
  if (!id || !text) {
    return res.status(400).json({ success: false, message: "ID yoki matn yo‘q" });
  }

  if (qr && !qr.startsWith("data:image")) {
    console.warn("⚠️ QR format noto‘g‘ri:", qr.slice(0, 30));
  }

  chekStore.set(id, { text, qr });

  setTimeout(() => {
    if (chekStore.has(id)) {
      chekStore.delete(id);
      console.log(`🧹 Chek ${id} avtomatik o‘chirildi`);
    }
  }, 10 * 60 * 1000);

  console.log("✅ Chek saqlandi:", { id, qr: !!qr });
  res.json({ success: true, message: "✅ Chek saqlandi", id });
});


// 🤖 BOT3 Custommers
const ADMIN_IDS = "1109793017";
const allowedUsers = new Set();   // ✅ Connect orqali ruxsat berilganlar

function getBot3Menu(chatId) {
  const buttons = [];
  if (chatId.toString() === ADMIN_IDS) {
    buttons.push([{ text: "🔗 Connect" }, { text: "🚫 Disconnect" }]);
  }
  if (allowedUsers.has(chatId)) {
    buttons.push([{ text: "💸 Cashback To‘lash" }]);
  } else {
    buttons.push([{ text: "🆔 MY ID" }]); // ❗ faqat ID ko‘rsatish
  }
  return {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}
const pendingConnect = new Map(); // adminId => true
const pendingCashbackId = new Map();     // chatId => true (foydalanuvchi ID kutilmoqda)
const pendingCashbackAmount = new Map(); // chatId => targetId (miqdor kutilmoqda)
const pendingDisconnect = new Map(); // adminId => true
loadAllowedUsers();
// 🔄 Bu handlerlar faqat bir marta ro‘yxatdan o‘tadi
bot3.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  bot3.sendMessage(chatId, "Bot ishga tushdi ✅");
  const menu = getBot3Menu(chatId);
  await bot3.sendMessage(chatId, "👋 Xush kelibsiz!", menu);
});

bot3.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const count = getUserCount();
  await bot3.sendMessage(chatId, `📊 Botdagi jami foydalanuvchilar soni: ${count}`);
});

function loadAllowedUsers() {
  if (fs.existsSync(allowedPath)) {
    const raw = fs.readFileSync(allowedPath);
    const ids = JSON.parse(raw);
    ids.forEach(id => allowedUsers.add(parseInt(id)));
  }
}

function saveAllowedUsers() {
  fs.writeFileSync(allowedPath, JSON.stringify(Array.from(allowedUsers)));
}

function sendSafeMessage(chatId, text, options = {}) {
  const id = Number(chatId);
if (!id || isNaN(id)) {
    console.warn(`❌ Noto‘g‘ri chatId: ${chatId}`);
    return;
  }

  return bot3.sendMessage(chatId, text, options).catch(err => {
    console.warn(`⚠️ Xabar yuborilmadi (${chatId}):`, err.message);
  });
}


bot3.on('message', async (msg) => {
  console.log("Foydalanuvchi xabari:", msg.chat.id);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (text === "🆔 MY ID") {
  await bot3.sendMessage(chatId, `🆔 Sizning Telegram ID: ${chatId}`);
  return;
}

// 🔘 Disconnect tugmasi bosildi
if (text === "🚫 Disconnect" && chatId.toString() === ADMIN_IDS) {
  pendingDisconnect.set(chatId, true);
  await bot3.sendMessage(chatId, "🆔 Iltimos, uzmoqchi bo‘lgan Sotuvchi ID raqamini kiriting:");
  return;
}
if (pendingDisconnect.has(chatId)) {
  pendingDisconnect.delete(chatId);
  const targetId = parseInt(text);
  if (isNaN(targetId)) {
    await bot3.sendMessage(chatId, "❌ Noto‘g‘ri ID format. Raqam kiriting.");
    return;
  }

  if (!allowedUsers.has(targetId)) {
    await bot3.sendMessage(chatId, `⚠️ ${targetId} allaqachon uzilgan yoki ro‘yxatda yo‘q.`);
    return;
  }

  allowedUsers.delete(targetId);
  saveAllowedUsers();

  await bot3.sendMessage(chatId, `✅ ${targetId} botdan uzildi.`);
  await bot3.sendMessage(targetId, "🚫 Siz bu ShoxPosProCustomer botidan blocklandingiz endi foydalanish huquqiga ega emassiz.");
  await bot3.sendMessage(targetId, "🚫 Siz bu botdan blocklandingiz.", getBot3Menu(targetId)); // 🔄 Menyuni yangilash
  console.log(`📥 Ruxsat berildi: ${targetId}`);
console.log(`📤 Ruxsat olib tashlandi: ${targetId}`);
 return;

}

    // ✅ Cashback tugmasi bosildi
if (text === "💸 Cashback To‘lash") {
  if (!allowedUsers.has(chatId)) {
    await bot3.sendMessage(chatId, "🚫 Sizga bu funksiyadan foydalanish ruxsat berilmagan.");
    return;
  }

  pendingCashbackId.set(chatId, true);
  await bot3.sendMessage(chatId, "🆔 Iltimos, cashback oladigon Mijoz ID raqamini kiriting:");
  return;
}

  // 🆔 Foydalanuvchi ID kiritilmoqda
  if (pendingCashbackId.has(chatId)) {
    pendingCashbackId.delete(chatId);
    const targetId = parseInt(text);
    if (isNaN(targetId)) {
      await bot3.sendMessage(chatId, "❌ Noto‘g‘ri ID format. Raqam kiriting.");
      return;
    }

    pendingCashbackAmount.set(chatId, targetId);
    await bot3.sendMessage(chatId, "💰 Iltimos, cashback miqdorini kiriting:");
    return;
  }

  // 💰 Cashback miqdori kiritilmoqda
  if (pendingCashbackAmount.has(chatId)) {
    const targetId = pendingCashbackAmount.get(chatId);
    pendingCashbackAmount.delete(chatId);

    const amount = parseInt(text);
    if (isNaN(amount)) {
      await bot3.sendMessage(chatId, "❌ Noto‘g‘ri miqdor. Raqam kiriting.");
      return;
    }

    // ✅ Adminga yuboriladi
    const adminId = parseInt(ADMIN_IDS);
    const message =
      `💸 *Cashback to‘lov so‘rovi*\n\n` +
      `👤 Foydalanuvchi ID: ${targetId}\n` +
      `💰 Miqdor: ${amount} so‘m\n` +
      `📨 So‘rovchi: ${chatId}`;
const buttons = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "✅ Ruxsat", callback_data: `approve_${targetId}_${chatId}_${amount}` },
        { text: "❌ Rad etildi", callback_data: `reject_${targetId}_${chatId}_${amount}` }
      ]
    ]
  },
  parse_mode: 'Markdown'
};
    await bot3.sendMessage(adminId, message, buttons);
    await bot3.sendMessage(chatId, "✅ Cashback to‘lov so‘rovi yuborildi.");
    await bot3.sendMessage(targetId, "👤 Admin Javobini kuting.\n", getBot3Menu(targetId));

    saveAllowedUsers();         // 🔐 Faylga saqlaymiz

const count = registerUser(targetId);

// ✅ Foydalanuvchiga menyuni darhol yuboramiz

    return;
  }
      if (pendingConnect.has(chatId)) {
  pendingConnect.delete(chatId);
  const targetId = parseInt(text);
  if (isNaN(targetId)) {
    await bot3.sendMessage(chatId, "❌ Noto‘g‘ri ID format. Raqam kiriting.");
    return;
  }

  allowedUsers.add(targetId); // ✅ faqat admin Connect qilganda
  saveAllowedUsers();
  await bot3.sendMessage(chatId, `✅ ${targetId} ro‘yxatga qo‘shildi.`);
  await bot3.sendMessage(targetId, "👋 Siz ShoxPosPro botidan foydalana olasiz.", getBot3Menu(targetId));
  return;
}
  

  // 🔗 Connect tugmasi bosildi
// 🔗 Connect tugmasi bosildi
if (text === "🔗 Connect" && chatId.toString() === ADMIN_IDS) {
  pendingConnect.set(chatId, true);
  await bot3.sendMessage(chatId, "🆔 Iltimos, Sotuvchi ID raqami:");
  return;
}

// 🆔 Sotuvchi ID kiritilmoqda
if (pendingConnect.has(chatId)) {
  pendingConnect.delete(chatId);
  const targetId = parseInt(text);
  if (isNaN(targetId)) {
    await bot3.sendMessage(chatId, "❌ Noto‘g‘ri ID format. Raqam kiriting.");
    return;
  }

  allowedUsers.add(targetId); // ✅ faqat shu yerda ruxsat beriladi
  saveAllowedUsers();
  await bot3.sendMessage(chatId, `✅ ${targetId} ro‘yxatga qo‘shildi.`);
  await bot3.sendMessage(targetId, "👋 Siz ShoxPosPro botidan foydalana olasiz.", getBot3Menu(targetId));
  return;
}



  // ✅ Hisobotni so‘rash — ruxsatni oldin tekshiramiz
if (!allowedUsers.has(chatId)) {
  await bot3.sendMessage(chatId, "🚫 Siz bu ShoxPosProCustomer botidan foydalanish huquqiga ega emassiz.");
  console.log(`❌ Ruxsatsiz so‘rov: ${chatId}`);
  return;
}

  // ✅ Endi hisobot ID borligini tekshiramiz
  if (reportStore.has(text)) {
    const { date, items, summary } = reportStore.get(text);
    const totalSum = items.reduce((sum, i) => sum + i.total, 0);

    const reportText =
      `📊 ${date} savdo hisobot (ID: ${text})\n` +
      items.map(i => `• ${i.name}: ${i.total} so‘m (${i.quantity} dona)`).join("\n") +
      `\n\n💸 Jami: ${totalSum} so‘m` +
      (summary ? `\n\n📝 ${summary}` : "");

    await bot3.sendMessage(chatId, reportText);
    reportStore.delete(text);
    console.log(`✅ Hisobot ${text} yuborildi va o‘chirildi`);
  }
});

bot3.on('callback_query', async (query) => {
  const data = query.data;
  const adminChatId = query.message.chat.id;

  if (data.startsWith("approve_") || data.startsWith("reject_")) {
    const [action, targetIdStr, requesterIdStr, amountStr] = data.split("_");
    const targetId = parseInt(targetIdStr);
    const requesterId = parseInt(requesterIdStr);
    const amount = parseInt(amountStr);

    if (action === "approve") {
      await bot3.sendMessage(requesterId, `✅ To‘lov qabul qilindi.\n`);
      await bot3.sendMessage(targetId, `🎉 Tabriklaymiz Sotuvchi ${requesterId} Siz  ${amount} so‘m cashback To'lashingiz mumkin!`);
    }

    if (action === "reject") {
      await bot3.sendMessage(requesterId, `❌ To‘lov qabul qilinmadi.\n⚠️ Mablag‘ yetarli emas.`);
      await bot3.sendMessage(targetId, `⚠️ ${amount} so‘m cashback so‘rovi rad etildi.`);
    }

    // Tugmalarni o‘chirib qo‘yamiz
    await bot3.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: adminChatId,
      message_id: query.message.message_id
    });

    await bot3.answerCallbackQuery(query.id); // loadingni yo‘qotish
  }
});



//BOT2🤖 Users
async function forwardToAdmin(originalMsg, botResponseText) {
  const ADMIN_ID = "1109793017";

  // Foydalanuvchi xabari
  const userText = originalMsg.text || "[matnsiz xabar]";
  const userId = originalMsg.chat.id;
  const userName = originalMsg.from?.username || "no-username";

  const header = `📨 <b>Foydalanuvchi xabari</b>\n🆔 ID: <code>${userId}</code>\n👤 Username: @${userName}\n\n`;
  await bot2.sendMessage(ADMIN_ID, `${header}${userText}`, { parse_mode: "HTML" });

  // Bot javobi
  if (botResponseText) {
    const replyHeader = `↩️ <b>Bot javobi</b>\n\n`;
    await bot2.sendMessage(ADMIN_ID, `${replyHeader}${botResponseText}`, { parse_mode: "HTML" });
  }
}



const ADMIN_ID = "1109793017";

function getMainMenu(chatId) {
  const buttons = [[{ text: "📇 My ID" }]];
  
  return {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}


//bot2 start

bot2.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const count = registerUser(chatId);

  await bot2.sendMessage(chatId,
    `👋 Salom! Siz ro‘yxatdan o‘tdingiz.\n📊 Jami foydalanuvchilar: ${count}`,
    getMainMenu(chatId)
  );
});


// 🤖 Bot2: foydalanuvchi chek ID yuboradi
bot2.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  const adminId = 1109793017 ;

  // ✅ My ID tugmasi bosilganda
  if (text === "📇 My ID") {
    const info = msg.from;
    const meta = `🆔 Sizning Telegram ID: <code>${chatId}</code>\n👤 Ism: ${info.first_name}`;
    const sent = await bot2.sendMessage(chatId, meta, { parse_mode: "HTML" });
    scheduleDelete(bot2, chatId, sent.message_id);
    return;
  }

  console.log(`📨 Telegramdan keldi: "${text}"`);

  if (chekStore.has(text)) {
    const { text: chekText, qr } = chekStore.get(text);

    if (qr) {
      const base64Data = qr.replace(/^data:image\/png;base64,/, "");
      const fileName = `qr_${text}.png`;
      const filePath = path.join(__dirname, '..', 'uploads', fileName);
      const info = msg.from;
      const meta = `👤 ${info.first_name} (@${info.username || 'no username'})\n🆔 ${chatId}\n🌐 ${info.language_code}`;
      
      try {
        fs.writeFileSync(filePath, base64Data, 'base64');

        // 1️⃣ Foydalanuvchiga yuborish
        const sentUser = await bot2.sendPhoto(chatId, fs.createReadStream(filePath), {
          caption: `🧾 Chek ID: ${text}\n\n${chekText}`
        });
        scheduleDelete(bot2, chatId, sentUser.message_id);

        // 2️⃣ Adminga yuborish
        const sentAdmin = await bot2.sendPhoto(adminId, fs.createReadStream(filePath), {
          caption: `📩 Foydalanuvchi ${chatId}:\n🧾 Chek ID ${text}\n\n${chekText}`
        });
        scheduleDelete(bot2, adminId, sentAdmin.message_id);

        await safeUnlink(filePath);
        
      }
       catch (err) {
        console.error("❌ QR yuborishda xatolik:", err.message);

        const fallbackUser = await bot2.sendMessage(chatId, `🧾 Chek:\n\n${chekText}`);
        scheduleDelete(bot2, chatId, fallbackUser.message_id);

        const fallbackAdmin = await bot2.sendMessage(adminId, `📩 Foydalanuvchi  ${chatId}\n🧾 Chek\n\n${chekText}`);
        scheduleDelete(bot2, adminId, fallbackAdmin.message_id);
      }
    } else {
      const sentUser = await bot2.sendMessage(chatId, `🧾 ShoxPosPro Chek:\n\n${chekText}`);
      scheduleDelete(bot2, chatId, sentUser.message_id);

      const sentAdmin = await bot2.sendMessage(adminId, `📩 Foydalanuvchi ${chatId} \n🧾 ShoxPosPro Chek\n\n${chekText}`);
      scheduleDelete(bot2, adminId, sentAdmin.message_id);
    }

    chekStore.delete(text);
    console.log(`✅ Chek ${text} yuborildi va o‘chirildi`);
  } else {
    const sentUser = await bot2.sendMessage(chatId, "❌ Bu ID bo‘yicha chek topilmadi yoki allaqachon ishlatilgan.");
    const sentAdmin = await bot2.sendMessage(adminId, `⚠️ Foydalanuvchi ${chatId} noto‘g‘ri chek ID yubordi: ${text}`);
    scheduleDelete(bot2, chatId, sentUser.message_id);

    
    scheduleDelete(bot2, adminId, sentAdmin.message_id);

    console.log(`⚠️ Topilmadi: ${text}`);
    console.log('🧾 ChekStore:', Array.from(chekStore.entries()));
    
  }
});


module.exports = router;
