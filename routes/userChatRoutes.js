const express = require('express');
const mongoose = require('mongoose');
const UserChatHistory = require('../models/UserChatHistory');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const { encryptAndCompress, decryptAndDecompress } = require('../utils/chatCrypto');

module.exports = (csrfProtection, io) => {
  const router = express.Router();

  /**
   * 🛡️ RoomId yaratish (Alifbo tartibida)
   */
  function getRoomId(user1, user2) {
    return [user1, user2].sort().join('_');
  }

  /**
   * 📝 Xabarni saqlash (Bucket Pattern)
   */
  async function saveMessageToDB(sender, receiver, content) {
    const roomId = getRoomId(sender, receiver);
    try {
      let bucket = await UserChatHistory.findOne({ roomId, isFull: false }).sort({ bucketId: -1 });

      let messages = [];
      if (bucket) {
        try {
          messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
        } catch (e) {
          messages = [];
        }
      } else {
        const lastBucket = await UserChatHistory.findOne({ roomId }).sort({ bucketId: -1 });
        const newBucketId = lastBucket ? lastBucket.bucketId + 1 : 0;
        bucket = new UserChatHistory({ roomId, bucketId: newBucketId, encryptedMessages: '' });
      }

      messages.push({
        sender,
        content,
        timestamp: new Date()
      });

      bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
      bucket.count = messages.length;

      if (bucket.count >= 200) { // Chat xabarlari uchun 200 ta yetarli
        bucket.isFull = true;
      }

      await bucket.save();
      return true;
    } catch (err) {
      console.error('❌ Chat saqlashda xato:', err.message);
      return false;
    }
  }

  /**
   * 📌 Foydalanuvchilar ro'yxatini olish
   */
  router.get('/users', verifyToken, async (req, res) => {
    try {
      const currentUserRole = req.user.role;
      const currentUserLogin = req.user.login;

      let query = { isDeleted: false };

      // ✅ Agar foydalanuvchi admin bo'lmasa:
      // 1. O'zini ko'rishi kerak
      // 2. Barcha Adminlarni ko'rishi kerak (Support uchun)
      // 3. isSecret: false bo'lgan boshqa foydalanuvchilarni ko'rishi kerak
      if (currentUserRole !== 'admin') {
        query.$or = [
          { login: currentUserLogin },
          { role: 'admin' },
          { isSecret: false }
        ];
      }

      const users = await User.find(query, 'login name role isSecret').lean();
      
      // Har bir foydalanuvchi uchun oxirgi xabarni topish
      const usersWithLastMsg = await Promise.all(users.map(async (u) => {
        const roomId = getRoomId(req.user.login, u.login);
        const lastBucket = await UserChatHistory.findOne({ roomId }).sort({ bucketId: -1 });
        
        let lastMessage = '';
        if (lastBucket) {
          try {
            const messages = JSON.parse(decryptAndDecompress(lastBucket.encryptedMessages));
            if (messages.length > 0) {
              lastMessage = messages[messages.length - 1].content;
            }
          } catch (e) {}
        }
        
        return { ...u, lastMessage };
      }));

      res.json(usersWithLastMsg);
    } catch (err) {
      res.status(500).json({ error: 'Foydalanuvchilarni olishda xato' });
    }
  });

  /**
   * 📌 Profilni yashirish (Secret toggle)
   */
  router.post('/toggle-secret', verifyToken, async (req, res) => {
    try {
      const user = await User.findOne({ login: req.user.login });
      if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
      
      user.isSecret = !user.isSecret;
      await user.save();
      
      res.json({ success: true, isSecret: user.isSecret });
    } catch (err) {
      res.status(500).json({ error: 'Xatolik yuz berdi' });
    }
  });

  /**
   * 📌 Chat tarixini butunlay o'chirish
   */
  router.post('/delete-history', verifyToken, async (req, res) => {
    const { withUser } = req.body;
    const currentUser = req.user.login;
    const roomId = getRoomId(currentUser, withUser);

    try {
      // Bu xonaga tegishli barcha bucketlarni o'chirish
      await UserChatHistory.deleteMany({ roomId });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Tarixni o\'chirishda xato' });
    }
  });

  /**
   * 📌 Chat tarixini yuklash
   */
  router.get('/history/:withUser', verifyToken, async (req, res) => {
    const currentUser = req.user.login;
    const withUser = req.params.withUser;
    const roomId = getRoomId(currentUser, withUser);

    try {
      const buckets = await UserChatHistory.find({ roomId }).sort({ bucketId: 1 }).lean();
      const allMessages = [];

      for (const bucket of buckets) {
        try {
          const messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
          allMessages.push(...messages);
        } catch (e) {
          console.error(`Bucket ${bucket.bucketId} o'qishda xato`);
        }
      }
      res.json(allMessages);
    } catch (err) {
      res.status(500).json({ error: 'Tarixni yuklashda xato' });
    }
  });

  /**
   * 📌 Xabar yuborish (API orqali - fallback)
   */
  router.post('/send', verifyToken, csrfProtection, async (req, res) => {
    const { receiver, content } = req.body;
    const sender = req.user.login;

    if (!receiver || !content) return res.status(400).json({ error: 'Ma\'lumotlar to\'liq emas' });

    const saved = await saveMessageToDB(sender, receiver, content);
    if (saved) {
      // Socket orqali yuborish socket.js da amalga oshiriladi
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Xabarni saqlashda xato' });
    }
  });

  /**
   * 📌 Xabarni tahrirlash
   */
  router.post('/edit', verifyToken, csrfProtection, async (req, res) => {
    const { withUser, timestamp, newContent } = req.body;
    const currentUser = req.user.login;
    const roomId = getRoomId(currentUser, withUser);

    try {
      // Xabar qaysi bucketda ekanligini topish (timestamp bo'yicha)
      // Bizda timestamp millisekundlarda yoki Date object bo'lishi mumkin
      const searchDate = new Date(timestamp);
      
      const buckets = await UserChatHistory.find({ roomId }).sort({ bucketId: -1 });
      
      let found = false;
      for (const bucket of buckets) {
        let messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
        const msgIdx = messages.findIndex(m => 
          m.sender === currentUser && 
          new Date(m.timestamp).getTime() === searchDate.getTime()
        );

        if (msgIdx !== -1) {
          messages[msgIdx].content = newContent;
          messages[msgIdx].isEdited = true;
          messages[msgIdx].editedAt = new Date();
          
          bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
          await bucket.save();
          found = true;
          break;
        }
      }

      if (found) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Xabar topilmadi yoki tahrirlashga ruxsat yo\'q' });
      }
    } catch (err) {
      console.error('❌ Xabarni tahrirlashda xato:', err.message);
      res.status(500).json({ error: 'Server xatosi' });
    }
  });

  return { router, saveMessageToDB };
};
