const TelegramBot = require('node-telegram-bot-api');
const bot5 = new TelegramBot(process.env.BOT5_TOKEN, { polling: true });

const ADMIN_ID = '1109793017';
const userCodes = new Map();   // chatId => code
const userList = new Map();    // chatId => { username, name, phone, status }
const userStep = new Map();    // chatId => step

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// /start komandasi
bot5.onText(/\/start/, msg => {
  const chatId = msg.chat.id.toString();
  const username = msg.from.username;

  if (chatId === ADMIN_ID) {
    const code = generateCode();
    userCodes.set(chatId, code);
    bot5.sendMessage(chatId, `🔐 Sizning admin kodingiz: ${code}`);
    return;
  }

  if (!username) {
    bot5.sendMessage(chatId, `⚠️ Iltimos, Telegram username qo‘shing va qayta /start bosing.`);
    return;
  }

  userStep.set(chatId, 'awaiting_name');
  bot5.sendMessage(chatId, `👤 Iltimos, ismingizni kiriting:`);
});

// Message handler
bot5.on('message', msg => {
  const chatId = msg.chat.id.toString();
  const username = msg.from.username;

  if (chatId === ADMIN_ID || msg.text?.startsWith('/start')) return;

  const step = userStep.get(chatId);

  // 1. Ismni qabul qilish
  if (step === 'awaiting_name') {
    const name = msg.text.trim();
    userList.set(chatId, { username, name });
    userStep.set(chatId, 'awaiting_phone');

    bot5.sendMessage(chatId, `📞 Endi telefon raqamingizni yuboring:`, {
      reply_markup: {
        keyboard: [
          [{ text: '📲 Raqamni yuborish', request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return;
  }

  // 2. Telefon raqamni kontakt orqali qabul qilish
  if (step === 'awaiting_phone') {
    if (!msg.contact || !msg.contact.user_id) {
      bot5.sendMessage(chatId, `⚠️ Iltimos, raqamni "📲 Raqamni yuborish" tugmasi orqali yuboring. Matn ko‘rinishidagi raqam qabul qilinmaydi.`);
      return;
    }

    const phone = msg.contact.phone_number;
    const userData = userList.get(chatId);
    userData.phone = phone;
    userData.status = 'pending';
    userList.set(chatId, userData);
    userStep.delete(chatId);

    bot5.sendMessage(chatId, `⏳ Admin javobini kuting.`);

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Tasdiqlash', callback_data: `approve_${chatId}` },
            { text: '❌ Rad qilish', callback_data: `reject_${chatId}` }
          ]
        ]
      }
    };

    const allPending = Array.from(userList.entries())
      .filter(([_, data]) => data.status === 'pending')
      .map(([id, data]) => `• ${data.name} | ${data.username} | ${data.phone} (ID: ${id})`)
      .join('\n');

    bot5.sendMessage(ADMIN_ID, `📥 Yangi foydalanuvchi:\nIsm: ${userData.name}\nUsername: ${userData.username}\nTel: ${userData.phone}\nID: ${chatId}`, opts);
    bot5.sendMessage(ADMIN_ID, `📊 Jami kutilayotgan foydalanuvchilar: ${userList.size}\n${allPending}`);
  }
});

// 🔘 Admin tugmalarini boshqarish
bot5.on('callback_query', query => {
  const chatId = query.message.chat.id.toString();
  const data = query.data;

  if (chatId !== ADMIN_ID) return;

  const [action, targetId] = data.split('_');
  const userData = userList.get(targetId);

  if (!userData) return;

  if (action === 'approve') {
    const code = generateCode();
    userCodes.set(targetId, code);
    userData.status = 'approved';
    userList.set(targetId, userData);

    bot5.sendMessage(targetId, `✅ Siz tasdiqlandingiz. Botdan foydalanishingiz mumkin.\n🔐 Kod: ${code}`);
    bot5.sendMessage(ADMIN_ID, `✅ ${userData.name} (ID: ${targetId}) tasdiqlandi.`);
  }

  if (action === 'reject') {
    userData.status = 'rejected';
    userList.set(targetId, userData);

    bot5.sendMessage(targetId, `❌ Siz rad qilindingiz. Botdan foydalanish huquqi berilmadi.`);
    bot5.sendMessage(ADMIN_ID, `❌ ${userData.name} (ID: ${targetId}) rad qilindi.`);
  }
});

// 🔐 Kodni tekshiruvchi funksiya
function verifyCode(chatId, code) {
  return userCodes.get(chatId) === code;
}

module.exports = { verifyCode };
