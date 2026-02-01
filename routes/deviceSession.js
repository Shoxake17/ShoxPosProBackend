const express = require('express');
const router = express.Router();
const DeviceSession = require('../models/DeviceSession');
const verifyToken = require('../middleware/verifyToken');

// 🔍 GET all sessions for a user
router.get('/:login', verifyToken, async (req, res) => {
  try {
    const sessions = await DeviceSession.find({ login: req.params.login });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ➕ POST: create or update session
router.post('/', verifyToken, async (req, res) => {
  const { login, deviceId, deviceType, deviceOS } = req.body;
  try {
    const session = await DeviceSession.findOneAndUpdate(
      { login, deviceId },
      {
        deviceType,
        deviceOS,
        lastActive: new Date(),
        active: true
      },
      { upsert: true, new: true }
    );
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// ✏️ PUT: update session manually
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const updated = await DeviceSession.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ❌ DELETE: remove session
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    await DeviceSession.findByIdAndDelete(req.params.id);
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;


