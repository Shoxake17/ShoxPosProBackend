require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const userState = {}; // Har bir chatId uchun holatni saqlaydi


// 🔐 Botni yaratamiz
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();
  const isAdmin = chatId === "1109793017";

  // 🧑‍💻 Foydalanuvchi nomini aniqlaymiz
  const username = msg.from.username
    ? `${msg.from.username}`
    : msg.from.first_name
    ? msg.from.first_name
    : "foydalanuvchi";

    
  const buttons = isAdmin
  ? [
      [{ text: "➕ Karta qo‘shish" }, { text: "🎁 Cashback" }],
      [{ text: "💰 My Balance" }, { text: "📋 Barcha kartalar" } ],
      [{ text: "🗑️ Karta o‘chirish" }]
    ]
  : [[{ text: "💰 My Balance" }]];


  const options = {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };

  bot.sendMessage(chatId, `👋 Xush kelibsiz: ${username}`, options);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;
  const isAdmin = chatId === "1109793017";

  // 🎁 Cashback tugmasi bosildi
if (text === "🎁 Cashback") {
  userState[chatId] = { step: 'awaitingCashbackId' };
  bot.sendMessage(chatId, "🆔 Karta ID yoki Telegram ID ni kiriting:\nMasalan: 1234567890123456 yoki 1109793017");
  return;
}

// 1️⃣ Karta egasini aniqlash
if (userState[chatId]?.step === 'awaitingCashbackId') {
  let card = null;
  try {
    if (/^\d{16}$/.test(text)) {
      const res = await axios.post('http://localhost:3000/check-id', { id: text });
      if (!res.data.exists) {
        bot.sendMessage(chatId, "❌ Karta topilmadi.");
        delete userState[chatId];
        return;
      }
      card = res.data.data;
    } else {
      const res = await axios.post('http://localhost:3000/check-owner', { ownerTelegramId: text });
      if (!res.data.exists || res.data.data.length === 0) {
        bot.sendMessage(chatId, "❌ Telegram ID bo‘yicha karta topilmadi.");
        delete userState[chatId];
        return;
      }
      card = res.data.data[0];
    }

    userState[chatId] = { step: 'awaitingCashbackAmount', targetCard: card };
    bot.sendMessage(chatId, `✅ Karta topildi: ${card.id}\n💰 Endi cashback miqdorini kiriting:`);
  } catch (err) {
    console.error("Cashback ID xatolik:", err.message);
    bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
    delete userState[chatId];
  }
  return;
}

// 2️⃣ Cashback miqdorini qabul qilish
if (userState[chatId]?.step === 'awaitingCashbackAmount') {
  const amount = parseInt(text);
  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(chatId, "❌ Cashback miqdori noto‘g‘ri! Iltimos, raqam kiriting.");
    return;
  }

  const card = userState[chatId].targetCard;
  const newBalance = card.balance + amount;

  try {
    const updateRes = await axios.put('http://localhost:3000/update-balance', {
      id: card.id,
      balance: newBalance,
      token: process.env.UPDATE_SECRET
    });

    if (updateRes.data.success) {
      bot.sendMessage(chatId, `✅ ${amount} so‘m cashback qo‘shildi.\n📈 Yangi balans: ${newBalance} so‘m`);

      const ownerId = card.ownerTelegramId;
      if (ownerId && ownerId !== chatId) {
        bot.sendMessage(ownerId, `🎉 Sizga ${amount} so‘m cashback tushdi!\n💼 ShoxPosPro tomonidan.`);
      }
    } else {
      bot.sendMessage(chatId, "❌ Balansni yangilashda xato.");
    }
  } catch (err) {
    console.error("Cashback miqdor xatolik:", err.message);
    bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
  }

  delete userState[chatId];
  return;
}

  // 🔘 Tugmalar
  if (text === "➕ Karta qo‘shish") {
    userState[chatId] = { step: 'awaitingAddCard' };
    bot.sendMessage(chatId, "🆔 Karta ID (16 xonali) va Telegram ID ni kiriting:\nMasalan: `1234567890123456 1109793017`");
    return;
  }

  if (userState[chatId]?.step === 'awaitingAddCard') {
    const [cardId, targetTelegramId] = text.split(" ");
    if (!cardId || !targetTelegramId) {
      bot.sendMessage(chatId, "❌ Format noto‘g‘ri. Iltimos, `KartaID TelegramID` tarzida kiriting.");
      return;
    }

    try {
      const checkRes = await axios.post('http://localhost:3000/check-owner', { ownerTelegramId: targetTelegramId });
      const userCards = checkRes.data.data || [];

      if (userCards.length > 0 && !isAdmin) {
        bot.sendMessage(chatId, "⚠️ Bu foydalanuvchining kartasi allaqachon mavjud.");
        return;
      }

      const res = await axios.post('http://localhost:3000/bot-save-id', {
        id: cardId,
        token: process.env.BOT_SECRET,
        ownerTelegramId: targetTelegramId
      });

      if (res.data.saved) {
        bot.sendMessage(chatId, `✅ Karta qo‘shildi: ${cardId}`);
        bot.sendMessage(targetTelegramId, `🎉 Sizga yangi karta yaratildi!\n💳 ID: ${cardId}`);
      } else {
        bot.sendMessage(chatId, `⚠️ ${res.data.message}`);
      }
    } catch (err) {
      console.error("Karta qo‘shish xatolik:", err.message);
      bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
    }

    delete userState[chatId];
    return;
  }

  if (text === "📋 Barcha kartalar") {
  if (!isAdmin) {
    bot.sendMessage(chatId, "❌ Sizda bu ma'lumotni ko‘rishga ruxsat yo‘q.");
    return;
  }

  try {
    const res = await axios.post('http://localhost:3000/check-owner', { ownerTelegramId: "all" }); // maxsus signal
    const cards = res.data.data || [];

    if (cards.length === 0) {
      bot.sendMessage(chatId, "📭 Hozircha hech qanday karta mavjud emas.");
      return;
    }

    for (const card of cards) {
      const createdAt = new Date(card.createdAt);
      const day = createdAt.getDate().toString().padStart(2, '0');
      const month = (createdAt.getMonth() + 1).toString().padStart(2, '0');
      const year = createdAt.getFullYear();

      bot.sendMessage(chatId,
        `💳 Karta ID: ${card.id}\n` +
        `👤 Egasi: ${card.ownerTelegramId}\n` +
        `📅 Yaratilgan: ${day}.${month}.${year}\n` +
        `💰 Cashback: ${card.balance} so‘m`
      );
    }
  } catch (err) {
    console.error("Barcha kartalar xatolik:", err.message);
    bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
  }
  return;
}

  // 🗑️ Karta o‘chirish
  if (text === "🗑️ Karta o‘chirish") {
    userState[chatId] = { step: 'awaitingDeleteCard' };
    bot.sendMessage(chatId, "🆔 Qaysi kartani o‘chirmoqchisiz? Karta ID ni kiriting:");
    return;
  }

  if (userState[chatId]?.step === 'awaitingDeleteCard') {
    const cardId = text;
    try {
      const res = await axios.delete('http://localhost:3000/delete-card', {
        data: {
          id: cardId,
          token: process.env.BOT_SECRET
        }
      });

      if (res.data.deleted) {
        bot.sendMessage(chatId, `✅ Karta o‘chirildi: ${cardId}`);
      } else {
        bot.sendMessage(chatId, `⚠️ ${res.data.message}`);
      }
    } catch (err) {
      console.error("O‘chirish xatolik:", err.message);
      bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
    }

    delete userState[chatId];
    return;
  }


if (text === "💰 My Balance") {
  try {
    const res = await axios.post('http://localhost:3000/check-owner', { ownerTelegramId: chatId });
    if (!res.data.exists || res.data.data.length === 0) {
      bot.sendMessage(chatId, "❌ Sizga tegishli karta topilmadi.");
      return;
    }

    const card = res.data.data[0]; // ✅ faqat birinchi kartani olamiz

    const createdAt = new Date(card.createdAt);
    const day = createdAt.getDate().toString().padStart(2, '0');
    const month = (createdAt.getMonth() + 1).toString().padStart(2, '0');
    const year = createdAt.getFullYear();
    bot.sendMessage(chatId,
      `💳 Karta ID: ${card.id}\n` +
      `👤 Egasi: ${card.ownerTelegramId}\n` +
      `📅 Yaratilgan: ${day}.${month}.${year}\n` +
      `💰 Cashback: ${card.balance} so‘m`
    );
  } catch (err) {
    console.error("Telegram bot xatolik:", err.message);
    bot.sendMessage(chatId, "❌ Server bilan bog‘lanishda xato.");
  }
}

  });