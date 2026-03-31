const express = require('express');
const router = express.Router();
const User = require('../models/User');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const config = require('../config');

// Cloudinary konfiguratsiyasi
console.log("CLOUDINARY_CLOUD_NAME:", config.CLOUDINARY_CLOUD_NAME ? "SET" : "NOT SET");
cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key:    config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'shoxpospro_avatars',
      allowed_formats: ['jpg', 'png', 'jpeg'],
      public_id: `avatar_${req.body.login}_${Date.now()}`,
      transformation: [{ width: 250, height: 250, crop: 'fill' }]
    };
  },
});

const upload = multer({ storage: storage });

// Socket.io userSockets tracker
const userSockets = {};

module.exports = (io) => {
  // 📌 Profil ma'lumotlarini olish
  router.get('/profile', async (req, res) => {
    try {
      // req.user verifyToken middleware orqali keladi deb hisoblaymiz
      const login = req.query.login || (req.user && req.user.login);
      if (!login) return res.status(400).json({ error: "Login kerak" });

      const user = await User.findOne({ login }, "login firstName lastName phoneNumber avatarUrl uniqueChatId role");
      if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });

      res.json(user);
    } catch (err) {
      res.status(500).json({ error: "Server xatosi" });
    }
  });

  // 📌 Profilni tahrirlash
  router.put('/profile', (req, res, next) => {
    console.log("DEBUG: profile update request received");
    next();
  }, (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) {
        console.error("CRITICAL: Multer/Cloudinary upload error:", err);
        return res.status(500).json({ error: "Rasm yuklashda xato", details: err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      console.log("Profile update triggered for:", req.body.login);
      console.log("Request Body:", req.body);
      console.log("Request File:", req.file);
      
      const { login, firstName, lastName, phoneNumber } = req.body;
      
      if (!login) {
        console.error("Login is missing in request body");
        return res.status(400).json({ error: "Login kerak" });
      }

      // Foydalanuvchini topish
      const user = await User.findOne({ login });
      if (!user) {
        console.error("User not found:", login);
        return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      }

      // Ma'lumotlarni yangilash
      if (firstName)   user.firstName   = firstName;
      if (lastName)    user.lastName    = lastName;
      if (phoneNumber) user.phoneNumber = phoneNumber;
      
      // Rasm yuklangan bo'lsa
      if (req.file) {
        console.log("✅ File received and uploaded to Cloudinary:", req.file.path);
        user.avatarUrl = req.file.path;
      } else {
        console.log("⚠️ No file received in this request");
      }

      // Agar ID hali yo'q bo'lsa (eski foydalanuvchilar uchun)
      if (!user.uniqueChatId) {
        let isUnique = false;
        while (!isUnique) {
          const newId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
          const existing = await User.findOne({ uniqueChatId: newId });
          if (!existing) {
            user.uniqueChatId = newId;
            isUnique = true;
          }
        }
        console.log("Generated new uniqueChatId for user:", user.uniqueChatId);
      }

      await user.save();
      console.log("User saved successfully to MongoDB");

      res.json({ 
        message: "Profil muvaffaqiyatli yangilandi", 
        user: {
          login: user.login,
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          avatarUrl: user.avatarUrl,
          uniqueChatId: user.uniqueChatId
        }
      });
    } catch (err) {
      console.error("CRITICAL: Profile update error:", err);
      res.status(500).json({ error: "Server xatosi", details: err.message });
    }
  });

  // 📌 Foydalanuvchini qidirish (ID orqali)
  router.get('/search', async (req, res) => {
    try {
      const { query, searcherLogin } = req.query;
      if (!query) return res.status(400).json({ error: "Qidiruv so'rovi kerak" });

      const searcher = await User.findOne({ login: searcherLogin });
      
      let users;
      if (searcher && searcher.role === 'admin') {
        // Admin hamma narsani qidirishi mumkin (ID, ism, login)
        users = await User.find({
          $or: [
            { uniqueChatId: query },
            { login: { $regex: query, $options: 'i' } },
            { firstName: { $regex: query, $options: 'i' } }
          ],
          login: { $ne: searcherLogin }
        }, "login firstName lastName avatarUrl uniqueChatId role");
      } else {
        // Oddiy foydalanuvchi faqat aniq 10 xonali ID orqali topadi
        users = await User.find({
          uniqueChatId: query,
          login: { $ne: searcherLogin }
        }, "login firstName lastName avatarUrl uniqueChatId role");
      }

      res.json(users);
    } catch (err) {
      res.status(500).json({ error: "Server xatosi" });
    }
  });
  // 📌 Get user status
  router.get('/status', async (req, res) => {
    const login = req.query.login;
    if (!login) return res.status(400).json({ error: "Login kerak" });

    try {
      const user = await User.findOne({ login }, "-password");
      if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });

      res.json(user);
    } catch (err) {
      console.error("❌ user-status xatosi:", err);
      res.status(500).json({ error: "Server xatosi" });
    }
  });

  // 📌 Activate user
  router.post('/activate', async (req, res) => {
    const { login } = req.body;

    try {
      const user = await User.findOneAndUpdate(
        { login },
        { blocked: false, active: true },
        { new: true }
      );

      if (!user) {
        return res.json({ message: "Foydalanuvchi topilmadi!" });
      }

      const socketIds = userSockets[login];
      if (socketIds) {
        socketIds.forEach(id => io.to(id).emit('userActivated'));
      }

      res.json({ message: `${login} blokdan chiqarildi va aktiv qilindi.` });
    } catch (err) {
      console.error("❌ Activate qilish xatosi:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 📌 Block user
  router.post('/block', async (req, res) => {
    const { login } = req.body;

    try {
      const user = await User.findOneAndUpdate(
        { login },
        { blocked: true, active: false },
        { new: true }
      );

      if (!user) {
        return res.json({ message: "Foydalanuvchi topilmadi!" });
      }

      const socketIds = userSockets[login];
      if (socketIds) {
        socketIds.forEach(id => io.to(id).emit('forceLogout'));
      }

      res.json({ message: `${login} bloklandi.` });
    } catch (err) {
      console.error("❌ Block qilish xatosi:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 📌 Get active users
  router.get('/active', async (req, res) => {
    try {
      const users = await User.find({}, "-password");
      res.json(users);
    } catch (err) {
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // 📌 Check status
  router.post('/check-status', async (req, res) => {
    const { login, deviceId } = req.body;

    try {
      const user = await User.findOne({ login });

      if (!user) {
        return res.json({ active: false, reason: "Foydalanuvchi topilmadi" });
      }

      if (user.blocked) {
        return res.json({ active: false, reason: "Siz bloklangansiz!" });
      }

      if (
        user.desktopDeviceId !== deviceId &&
        user.mobileDeviceId !== deviceId
      ) {
        return res.json({ active: false, reason: "Noto'g'ri sessiya!" });
      }

      return res.json({ active: user.active });
    } catch (err) {
      console.error("❌ Status tekshirish xatosi:", err);
      res.status(500).json({ active: false, reason: "Server xatosi" });
    }
  });

  // 📌 Confirm login
  router.post('/confirm-login', async (req, res) => {
    const { login, deviceId, confirm } = req.body;

    if (!login) return res.status(400).json({ message: "❌ Login kerak" });

    try {
      const user = await User.findOne({ login });
      if (!user) return res.status(404).json({ message: "❌ Foydalanuvchi topilmadi" });

      if (!confirm) {
        return res.json({ message: "🚫 Qurilma rad etildi, kirish bekor qilindi." });
      }

      const oldDeviceIds = [];
      if (user.mobileDeviceId && user.mobileDeviceId !== deviceId) oldDeviceIds.push(user.mobileDeviceId);
      if (user.desktopDeviceId && user.desktopDeviceId !== deviceId) oldDeviceIds.push(user.desktopDeviceId);

      if (/mobile/i.test(req.headers['user-agent'] || "")) {
        user.mobileDeviceId = deviceId;
      } else {
        user.desktopDeviceId = deviceId;
      }
      
      user.active = true;
      await user.save();

      oldDeviceIds.forEach(oldId => {
        const socketIds = userSockets[login] || [];
        const targetSockets = socketIds.filter(sid => sid !== deviceId);
        targetSockets.forEach(sid => io.to(sid).emit("requestDeviceConfirm", { login, newDeviceId: deviceId }));
      });

      res.json({ message: "✅ Qurilma tasdiqlandi va sessiya o'tkazildi." });

    } catch (err) {
      console.error("❌ confirm-login xatosi:", err);
      res.status(500).json({ message: "Server xatosi" });
    }
  });

  // Socket.io tracking
  io.on('connection', (socket) => {
    socket.on('registerUser', ({ login }) => {
      if (!userSockets[login]) userSockets[login] = [];
      if (!userSockets[login].includes(socket.id)) {
        userSockets[login].push(socket.id);
      }
      console.log(`📲 ${login} socket ro'yxatga olindi: ${socket.id}`);
    });

    socket.on('disconnect', () => {
      for (const login in userSockets) {
        userSockets[login] = userSockets[login].filter(id => id !== socket.id);
        if (userSockets[login].length === 0) {
          delete userSockets[login];
        }
      }
    });
  });

  return router;
};