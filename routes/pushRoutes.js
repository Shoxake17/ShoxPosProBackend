// routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { normalizeSubscription } = require('../utils/pushSubscription');

// Subscribe saqlash
router.post('/subscribe', async (req, res) => {
  try {
    const login = req.user?.login;
    // SSRF himoyasi: faqat rasmiy push xizmatlari (utils/pushSubscription.js).
    const subscription = normalizeSubscription(req.body && req.body.subscription);
    if (!login || !subscription) {
      return res.status(400).json({ success: false, message: 'Push obunasi yaroqsiz' });
    }
    await User.findOneAndUpdate(
      { login: { $eq: login } },
      { $set: { pushSubscription: subscription } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[push] subscribe:', err && err.message);
    res.status(500).json({ success: false });
  }
});

// Unsubscribe
router.post('/unsubscribe', async (req, res) => {
  try {
    const login = req.user?.login;
    await User.findOneAndUpdate(
      { login: { $eq: login } },
      { $set: { pushSubscription: null } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;