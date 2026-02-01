// utils/messageCleaner.js
module.exports.scheduleDelete = function(bot, chatId, messageId, delayMs = 60 * 60 * 1000) {
  setTimeout(() => {
    bot.deleteMessage(chatId, messageId)
      .then(() => console.log(`🧹 Xabar o‘chirildi: ${messageId}`))
      .catch(err => console.warn(`⚠️ Xabarni o‘chirishda xatolik: ${err.message}`));
  }, delayMs);
};
