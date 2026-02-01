const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Socket.io userSockets tracker
const userSockets = {};

module.exports = (io) => {
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