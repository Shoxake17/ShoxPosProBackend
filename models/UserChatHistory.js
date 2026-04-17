// models/UserChatHistory.js
const mongoose = require('mongoose');
const UserChatHistorySchema = new mongoose.Schema({
  roomId: { 
    type: String, 
    required: true, 
    index: true 
  },
  bucketId: { 
    type: Number, 
    required: true, 
    default: 0 
  },
  // 🛡️ Xabarlar shifrlangan va siqilgan blob ichida saqlanadi
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

// Room va bucketId bo'yicha qidirishni tezlashtirish
UserChatHistorySchema.index({ roomId: 1, bucketId: -1 });

module.exports = mongoose.model('UserChatHistory', UserChatHistorySchema);
