const express = require('express');
const router = express.Router();
const DeviceSession = require('../models/DeviceSession');
const verifyToken = require('../middleware/verifyToken');

// ====================================================================
// 🛡️ SANITIZERS
// ====================================================================
function sanitizeLogin(value) {
  if (!value || typeof value !== 'string') throw new Error("login noto'g'ri");
  if (!/^[a-zA-Z0-9_\-\.]{1,64}$/.test(value)) throw new Error("login formati noto'g'ri");
  return value.toLowerCase().trim();
}

function sanitizeObjectId(value) {
  if (!value || typeof value !== 'string') throw new Error("id noto'g'ri");
  if (!/^[a-fA-F0-9]{24}$/.test(value)) throw new Error("id formati noto'g'ri");
  return value;
}

function sanitizeDeviceId(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^[a-zA-Z0-9\-_]{1,128}$/.test(value)) throw new Error("deviceId formati noto'g'ri");
  return value;
}

function sanitizeString(value, field = 'field', maxLen = 128) {
  if (!value || typeof value !== 'string') return null;
  if (/\$/.test(value)) throw new Error(`${field} da noto'g'ri belgi mavjud`);
  if (value.length > maxLen) throw new Error(`${field} juda uzun`);
  return value.trim();
}

// ====================================================================
// 🔍 GET — foydalanuvchi sessiyalari
// ====================================================================
router.get('/:login', verifyToken, async (req, res) => {
  let safeLogin;
  try {
    safeLogin = sanitizeLogin(req.params.login);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // ✅ Faqat o'z sessiyasini ko'ra oladi
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  try {
    // ✅ $eq bilan — taint uziladi
    const sessions = await DeviceSession.find({ login: { $eq: safeLogin } });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================================================================
// ➕ POST — sessiya yaratish yoki yangilash
// ====================================================================
router.post('/', verifyToken, async (req, res) => {
  let safeLogin, safeDeviceId, safeDeviceType, safeDeviceOS;

  try {
    safeLogin      = sanitizeLogin(req.body.login);
    safeDeviceId   = sanitizeDeviceId(req.body.deviceId);
    safeDeviceType = sanitizeString(req.body.deviceType, 'deviceType', 64);
    safeDeviceOS   = sanitizeString(req.body.deviceOS, 'deviceOS', 64);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (!safeDeviceId) {
    return res.status(400).json({ error: 'deviceId majburiy' });
  }

  // ✅ Faqat o'z sessiyasini yarata oladi
  if (req.user.login !== safeLogin && req.user.role !== 'admin') {
    return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  try {
    // ✅ Faqat ruxsat etilgan maydonlar — req.body to'g'ridan-to'g'ri emas
    const session = await DeviceSession.findOneAndUpdate(
      {
        login:    { $eq: safeLogin },
        deviceId: { $eq: safeDeviceId }
      },
      {
        $set: {
          deviceType: safeDeviceType || 'unknown',
          deviceOS:   safeDeviceOS   || 'unknown',
          lastActive: new Date(),
          active:     true
        }
      },
      { upsert: true, new: true }
    );
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// ====================================================================
// ✏️ PUT — sessiyani yangilash
// ====================================================================
router.put('/:id', verifyToken, async (req, res) => {
  let safeId;
  try {
    safeId = sanitizeObjectId(req.params.id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // ✅ req.body to'g'ridan-to'g'ri emas — faqat ruxsat etilgan maydonlar
  let safeDeviceType, safeDeviceOS;
  try {
    safeDeviceType = sanitizeString(req.body.deviceType, 'deviceType', 64);
    safeDeviceOS   = sanitizeString(req.body.deviceOS, 'deviceOS', 64);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    // ✅ Avval sessiyani topib, egasini tekshiramiz
    const existing = await DeviceSession.findById({ $eq: safeId });
    if (!existing) return res.status(404).json({ error: 'Sessiya topilmadi' });

    if (req.user.login !== existing.login && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Ruxsat yo'q" });
    }

    const updateData = {};
    if (safeDeviceType) updateData.deviceType = safeDeviceType;
    if (safeDeviceOS)   updateData.deviceOS   = safeDeviceOS;
    updateData.lastActive = new Date();

    // ✅ _id bilan $eq — faqat tekshirilgan maydonlar
    const updated = await DeviceSession.findOneAndUpdate(
      { _id: { $eq: safeId } },
      { $set: updateData },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ====================================================================
// ❌ DELETE — sessiyani o'chirish
// ====================================================================
router.delete('/:id', verifyToken, async (req, res) => {
  let safeId;
  try {
    safeId = sanitizeObjectId(req.params.id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    // ✅ Avval egasini tekshiramiz
    const existing = await DeviceSession.findById({ $eq: safeId });
    if (!existing) return res.status(404).json({ error: 'Sessiya topilmadi' });

    if (req.user.login !== existing.login && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Ruxsat yo'q" });
    }

    await DeviceSession.deleteOne({ _id: { $eq: safeId } });
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;