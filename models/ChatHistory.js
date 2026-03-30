// models/ChatHistory.js
const mongoose = require('mongoose');

/**
 * AI Chat tarixi uchun Bucket Pattern modeli.
 * Har bir hujjat (document) bir nechta xabarlarni o'z ichiga oladi (masalan, 50 tagacha).
 * Bu MongoDB indexlari hajmini kamaytiradi va o'qish tezligini oshiradi.
 */
const ChatHistorySchema = new mongoose.Schema({
  login: { 
    type: String, 
    required: true, 
    index: true 
  },
  bucketId: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  // 🛡️ Xabarlar butunlay shifrlangan blob ichida saqlanadi (Space + Security optimization)
  encryptedMessages: { 
    type: String, 
    required: true 
  },
  count: { 
    type: Number, 
    default: 0 
  },
  isFull: { 
    type: Boolean, 
    default: false 
  }
}, { 
  timestamps: true 
});

// User va bucketId bo'yicha qidirishni tezlashtirish
ChatHistorySchema.index({ login: 1, bucketId: -1 });

module.exports = mongoose.model('ChatHistory', ChatHistorySchema);
