// routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Subscribe saqlash
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    const login = req.user?.login;
    if (!login || !subscription) {
      return res.status(400).json({ success: false });
    }
    await User.findOneAndUpdate(
      { login },
      { pushSubscription: subscription }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Unsubscribe
router.post('/unsubscribe', async (req, res) => {
  try {
    const login = req.user?.login;
    await User.findOneAndUpdate(
      { login },
      { pushSubscription: null }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;