// routes/authenticatorRoutes.js
const express = require('express');
const router = express.Router();
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');

// BARCHA Google Auth endpointlari JWT bilan himoyalangan (Settings sahifasi uchun)
router.use(verifyToken);

// Setup
router.post('/setup', async (req, res) => {
  const login = req.user.login;
  if (!login) return res.status(400).json({ message: "Login topilmadi" });

  const secret = speakeasy.generateSecret({
    name: `ShoxPosPro (${login})`,
    length: 32
  });

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  await User.findOneAndUpdate({ login }, { 
    googleAuthSecret: secret.base32,
    googleAuthEnabled: false 
  });

  res.json({ qrCodeUrl, secret: secret.base32 });
});

// Verify
router.post('/verify', async (req, res) => {
  const { token } = req.body;
  const login = req.user.login;

  const user = await User.findOne({ login });

  if (!user || !user.googleAuthSecret) {
    return res.status(400).json({ success: false, message: 'Secret topilmadi' });
  }

  const verified = speakeasy.totp.verify({
    secret: user.googleAuthSecret,
    encoding: 'base32',
    token: token,
    window: 2
  });

  if (verified) {
    await User.findOneAndUpdate({ login }, { googleAuthEnabled: true });
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, message: 'Kod noto\'g\'ri' });
  }
});

// Status
router.get('/status', async (req, res) => {
  try {
    const login = req.user.login;
    if (!login) return res.status(401).json({ message: 'Autentifikatsiya kerak' });

    const user = await User.findOne({ login });
    if (!user) return res.status(404).json({ message: 'Foydalanuvchi topilmadi' });

    res.json({ enabled: user.googleAuthEnabled || false });
  } catch (error) {
    console.error('Status xatosi:', error);
    res.status(500).json({ message: 'Server xatosi' });
  }
});

// Disable
router.post('/disable', async (req, res) => {
  const login = req.user.login;
  await User.findOneAndUpdate({ login }, {
    googleAuthEnabled: false,
    googleAuthSecret: null
  });
  res.json({ success: true });
});

module.exports = router;