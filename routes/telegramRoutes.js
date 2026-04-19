const express = require("express");
const verifyToken = require('../middleware/verifyToken');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const Debt = require('../models/Debt');
const Sale = require('../models/Sale');

module.exports = (csrfProtection) => {
  const router = express.Router();

  let telegramClient = null;
  let telegramReportBot = null;

  const initTelegramClient = async () => {
    if (telegramClient && telegramClient.connected) {
      return telegramClient;
    }

    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    const sessionString = process.env.TELEGRAM_SESSION_STRING;

    if (!apiId || !apiHash || !sessionString) {
      const missing = [];
      if (!apiId) missing.push('TELEGRAM_API_ID');
      if (!apiHash) missing.push('TELEGRAM_API_HASH');
      if (!sessionString) missing.push('TELEGRAM_SESSION_STRING');
      console.error("❌ Telegram konfiguratsiyasi yo'q:", missing.join(', '));
      return null;
    }

    const stringSession = new StringSession(sessionString);
    telegramClient = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 3,
    });

    try {
      await telegramClient.connect();
      console.log("✅ Telegram UserBot ulandi");
    } catch (error) {
      console.error("❌ Telegram ulanish xatosi:", error);
      telegramClient = null;
    }

    return telegramClient;
  };

  const sendTelegramMessage = async (phoneOrId, message, debtorName) => {
    const client = await initTelegramClient();
    if (!client) {
      throw new Error("Telegram konfiguratsiyasi to'liq emas. .env faylini tekshiring.");
    }

    try {
      const isPhone = phoneOrId.startsWith('+') || /^\d+$/.test(phoneOrId);
      
      if (isPhone) {
        const cleanPhone = phoneOrId.replace(/\D/g, "");
        const phoneFormats = [
          '+' + cleanPhone,
          cleanPhone,
          cleanPhone.startsWith('998') ? '+' + cleanPhone : '+998' + cleanPhone
        ];
        
        for (const format of phoneFormats) {
          try {
            console.log(`   - Trying phone: ${format}`);
            const entity = await client.getEntity(format);
            await client.sendMessage(entity, { message });
            console.log(`   ✅ Xabar yuborildi (${format})`);
            return { success: true };
          } catch (err) {
            console.log(`   ❌ Failed for ${format}`);
          }
        }
        
        if (debtorName) {
          try {
            console.log(`🔄 Kontaktni qo'shishga harakat qilinyapti: ${phoneOrId}`);
            await client.invoke(
              new Api.contacts.ImportContacts({
                contacts: [
                  new Api.InputPhoneContact({
                    clientId: BigInt(Date.now()),
                    phone: '+' + cleanPhone,
                    firstName: debtorName || "Qarzdor",
                    lastName: "",
                  }),
                ],
              })
            );
            
            console.log("✅ Kontakt qo'shildi, 3 soniya kutilmoqda...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            for (const format of phoneFormats) {
              try {
                const entity = await client.getEntity(format);
                await client.sendMessage(entity, { message });
                console.log(`✅ Xabar yuborildi (kontakt qo'shilgandan keyin)`);
                return { success: true };
              } catch (err) {
                continue;
              }
            }
          } catch (importErr) {
            console.error("❌ Kontakt qo'shishda xato:", importErr.message);
          }
        }
      } else {
        try {
          console.log(`   - Trying ID/Username: ${phoneOrId}`);
          const entity = await client.getEntity(phoneOrId);
          await client.sendMessage(entity, { message });
          console.log(`✅ Xabar yuborildi (ID/Username)`);
          return { success: true };
        } catch (err) {
          console.error(`❌ ID/Username uchun xato:`, err.message);
        }
      }

      throw new Error(
        "Bu telefon raqami yoki ID Telegram'da topilmadi. Iltimos:\n" +
        "1. Qarzdor Telegram'da ro'yxatdan o'tganligini tekshiring\n" +
        "2. Uni telegram kontaktlaringizga qo'shing\n" +
        "3. Telegram ilovasida bir marta xabar yuboring"
      );
    } catch (error) {
      console.error("❌ Xabar yuborishda yakuniy xato:", error.message);
      throw new Error(error.message);
    }
  };

  router.post("/telegram/send-debt-reminder", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { debtorName, debtorPhone, login, debtAmount } = req.body;

      if (!debtorName || !debtorPhone || !login) {
        return res.status(400).json({ message: "Barcha ma'lumotlarni kiriting" });
      }

      const safeLogin = String(login).trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const user = await User.findOne({ login: safeLogin });
      if (!user) {
        return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
      }

      const shopName = user.shopName || "do'kon";
      let message = `👋 Salom ${debtorName}\n🏪 ${shopName} do'konidan \n💸 Qarzingizni yopishingizni so'raymiz.`;
      
      if (debtAmount) {
        const formattedAmount = Number(debtAmount).toLocaleString('uz-UZ');
        message = `👋 Salom ${debtorName}\n🏪 ${shopName} do'konidan \n💸 Qarz miqdori: ${formattedAmount} so'm\nQarzingizni yopishingizni so'raymiz.`;
      }

      await sendTelegramMessage(debtorPhone, message, debtorName);

      res.json({ success: true, message: "Xabar yuborildi" });
    } catch (err) {
      console.error("❌ Xabar yuborishda xato:", err);
      res.status(500).json({ 
        success: false, 
        message: err.message || "Xabar yuborishda xato yuz berdi" 
      });
    }
  });

  router.post("/telegram/send-all-debt-reminders", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { login } = req.body;

      if (!login) {
        return res.status(400).json({ message: "Login kiritilmagan" });
      }

      const safeLogin = String(login).trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const user = await User.findOne({ login: safeLogin });
      if (!user) {
        return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
      }

      const debts = await Debt.find({ login: safeLogin }).lean();
      if (debts.length === 0) {
        return res.json({ success: true, message: "Qarzdorlar yo'q", sent: 0, total: 0 });
      }

      const shopName = user.shopName || "do'kon";
      let sentCount = 0;
      let failedCount = 0;
      const failures = [];

      for (const debt of debts) {
        try {
          let message = `👋 Salom ${debt.name}\n🏪 ${shopName} do'konidan \n💸 Qarzingizni yopishingizni so'raymiz.`;
          
          if (debt.amount) {
            const formattedAmount = Number(debt.amount).toLocaleString('uz-UZ');
            message = `👋 Salom ${debt.name}\n🏪 ${shopName} do'konidan \n💸 Qarz miqdori: ${formattedAmount} so'm\nQarzingizni yopishingizni so'raymiz.`;
          }
          
          await sendTelegramMessage(debt.phone, message, debt.name);
          sentCount++;
        } catch (err) {
          failedCount++;
          failures.push({ name: debt.name, phone: debt.phone, error: err.message });
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      res.json({ 
        success: true, 
        message: `${sentCount} ta xabar yuborildi${failedCount > 0 ? `, ${failedCount} ta xatolik` : ''}`,
        sent: sentCount,
        failed: failedCount,
        total: debts.length,
        failures
      });
    } catch (err) {
      console.error("❌ Barcha qarzdorlarga xabar yuborishda xato:", err);
      res.status(500).json({ 
        success: false, 
        message: err.message || "Xabar yuborishda xato yuz berdi" 
      });
    }
  });

  router.get("/telegram/user/:login", verifyToken, async (req, res) => {
    try {
      const { login } = req.params;
      const safeLogin = String(login).trim().toLowerCase();
      
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const user = await User.findOne({ login: safeLogin }).select('telegramId shopName');
      if (!user) {
        return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
      }

      res.json({ 
        success: true, 
        telegramId: user.telegramId,
        shopName: user.shopName
      });
    } catch (err) {
      console.error("❌ Foydalanuvchi ma'lumotlarini olishda xato:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.put("/telegram/user/:login", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { login } = req.params;
      const { telegramId } = req.body;
      const safeLogin = String(login).trim().toLowerCase();
      
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      const user = await User.findOneAndUpdate(
        { login: safeLogin },
        { telegramId: telegramId || null },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: "Foydalanuvchi topilmadi" });
      }

      res.json({ success: true, message: "Telegram ID saqlandi", telegramId: user.telegramId });
    } catch (err) {
      console.error("❌ Foydalanuvchi ma'lumotlarini yangilashda xato:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get("/telegram/status", verifyToken, async (req, res) => {
    try {
      const apiId = process.env.TELEGRAM_API_ID;
      const apiHash = process.env.TELEGRAM_API_HASH;
      const sessionString = process.env.TELEGRAM_SESSION_STRING;
      
      const isConfigured = apiId && apiHash && sessionString;
      const isConnected = telegramClient && telegramClient.connected;
      
      res.json({
        configured: isConfigured,
        connected: isConnected,
        message: isConfigured 
          ? (isConnected ? "Telegram ulangan" : "Telegram konfiguratsiyasi bor, lekin ulanmagan") 
          : "Telegram konfiguratsiyasi yo'q. .env faylini to'ldiring."
      });
    } catch (err) {
      res.status(500).json({ configured: false, connected: false, message: err.message });
    }
  });

  const sendDailyReport = async (userLogin) => {
    try {
      console.log(`🔍 ${userLogin} uchun hisobot yig'ilmoqda...`);
      
      const user = await User.findOne({ login: userLogin });
      if (!user) {
        throw new Error(`Foydalanuvchi topilmadi: ${userLogin}`);
      }
      
      if (!user.telegramId) {
        throw new Error(`Foydalanuvchida Telegram ID saqlanmagan: ${userLogin}. Iltimos, AdminMenu'da saqlang!`);
      }

      console.log(`✅ Foydalanuvchi topildi, Telegram ID: ${user.telegramId}`);

      const sales = await Sale.find({ login: userLogin }).sort({ soldAt: -1 }).limit(100).lean();
      const debts = await Debt.find({ login: userLogin }).lean();
      
      const totalSales = sales.reduce((sum, s) => sum + (s.total || 0), 0);
      const totalProfit = sales.reduce((sum, s) => sum + ((s.price || 0) - (s.basePrice || 0)) * (s.quantity || 1), 0);
      const totalDebt = debts.reduce((sum, d) => sum + (d.amount || 0), 0);
      const itemsSold = sales.reduce((sum, s) => sum + (s.quantity || 0), 0);

      const shopName = user.shopName || "Do'kon";
      const now = new Date();
      
      const reportMessage = `📊 ${shopName} - HISOBOT\n` +
        `📅 Sana: ${now.toLocaleString('uz-UZ')}\n\n` +
        `💰 Jami savdo: ${totalSales.toLocaleString()} so'm\n` +
        `📈 Foyda: ${totalProfit.toLocaleString()} so'm\n` +
        `📦 Sotilgan mahsulotlar: ${itemsSold} dona\n` +
        `💳 Jami qarz: ${totalDebt.toLocaleString()} so'm\n` +
        `👤 Qarzdorlar: ${debts.length} ta\n\n` +
        `🤖 ShoxAiPro orqali avtomatik hisobot `

      console.log(`📨 Xabar yuborilmoqda: ${user.telegramId}`);
      await sendReportViaBot(user.telegramId, reportMessage);
      console.log(`✅ ${userLogin} uchun hisobot muvaffaqiyatli yuborildi!`);
    } catch (err) {
      console.error(`❌ ${userLogin} uchun hisobot yuborishda xato:`, err);
      throw err;
    }
  };

  const runDailyReportScheduler = async () => {
    try {
      initReportBot();
      console.log("⏰ Kunlik hisobot scheduler ishga tushdi (har kuni soat 23:59)");
      
      cron.schedule('59 23 * * *', async () => {
        console.log("🔄 Kunlik hisobotlar yuborilmoqda...");
        try {
          const users = await User.find({ telegramId: { $ne: null, $ne: '' } }).select('login telegramId');
          console.log(`📋 ${users.length} ta foydalanuvchi uchun hisobot yuborilmoqda`);
          
          for (const user of users) {
            try {
              await sendDailyReport(user.login);
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
              console.error(`❌ ${user.login} uchun hisobot xatosi:`, err.message);
            }
          }
        } catch (err) {
          console.error("❌ Scheduler xatosi:", err);
        }
      }, {
        timezone: "Asia/Tashkent"
      });
      
    } catch (err) {
      console.error("❌ Schedulerni ishga tushirishda xato:", err);
    }
  };

  const initReportBot = () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken || botToken === 'YOUR_BOT_TOKEN_HERE') {
      console.log("ℹ️ Telegram Report Bot tokeni kiritilmagan, hisobotlar UserBot orqali yuboriladi");
      return null;
    }
    
    try {
      telegramReportBot = new TelegramBot(botToken, { polling: false });
      console.log("✅ Telegram Report Bot ulandi");
      return telegramReportBot;
    } catch (err) {
      console.error("❌ Telegram Report Bot ulanish xatosi:", err.message);
      return null;
    }
  };

  const sendReportViaBot = async (chatId, message) => {
    if (!telegramReportBot) {
      console.log("ℹ️ Report Bot yo'q, UserBot orqali yuborilmoqda");
      await sendTelegramMessage(chatId, message);
      return;
    }
    
    try {
      await telegramReportBot.sendMessage(chatId, message);
      console.log(`✅ Hisobot Report Bot orqali yuborildi: ${chatId}`);
    } catch (err) {
      console.error(`❌ Report Bot xatosi (${chatId}):`, err.message);
      console.log("ℹ️ UserBot orqali qayta urinilmoqda...");
      await sendTelegramMessage(chatId, message);
    }
  };

  router.post("/telegram/test-daily-report", verifyToken, csrfProtection, async (req, res) => {
    try {
      const { login } = req.body;
      if (!login) {
        return res.status(400).json({ message: "Login kiritilmagan" });
      }

      const safeLogin = String(login).trim().toLowerCase();
      if (req.user.login !== safeLogin && req.user.role !== 'admin') {
        return res.status(403).json({ message: "Ruxsat etilmagan!" });
      }

      await sendDailyReport(safeLogin);
      res.json({ success: true, message: "Test hisobot yuborildi" });
    } catch (err) {
      console.error("❌ Test hisobot yuborishda xato:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  if (process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_SESSION_STRING) {
    setTimeout(() => {
      initReportBot();
      runDailyReportScheduler();
    }, 5000);
  }
  
  return router;
};
