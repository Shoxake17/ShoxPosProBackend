const express = require('express');
const router = express.Router();
const User = require('../models/User');

module.exports = (io) => {
  router.post('/confirm-login', async (req, res) => {
    const { login, deviceId, confirm } = req.body;

    try {
      const user = await User.findOne({ login });
      if (!user) return res.json({ message: '❌ Foydalanuvchi topilmadi' });

      if (confirm) {
        if (/mobile/i.test(req.headers['user-agent'] || "")) {
          user.mobileDeviceId = deviceId;
        } else {
          user.desktopDeviceId = deviceId;
        }
        user.active = true;
        await user.save();

        io.emit('sessionTransferred', { login });
        res.json({ message: '✅ Qurilma tasdiqlandi.' });
      } else {
        res.json({ message: '🚫 Kirish rad etildi.' });
      }
    } catch (err) {
      console.error('❌ confirm-login xatosi:', err);
      res.status(500).json({ message: 'Server xatosi' });
    }
  });

  return router;
};
