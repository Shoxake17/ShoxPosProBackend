const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { isAdmin } = require('../controllers/authController');

const User = require('../models/User');
const UserSession = require('../models/UserSession');

module.exports = (csrfProtection) => {
  const router = express.Router();

/**
 * @route   GET /api/admin/users
 * @desc    Login qilgan barcha foydalanuvchilarni ko'rsatish
 */
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find({ 
      'devices.0': { $exists: true } 
    })
      .select('-password -googleAuthSecret')
      .sort({ 'activeDevice.lastLogin': -1 })
      .lean();

    const formatted = users.map(user => {
      const activeDevice = user.activeDevice || {};
      
      const firstLogin = user.devices?.length > 0 
        ? user.devices.reduce((earliest, device) => {
            const deviceDate = new Date(device.lastLogin || device.createdAt);
            return deviceDate < earliest ? deviceDate : earliest;
          }, new Date(user.devices[0].lastLogin || user.createdAt))
        : user.createdAt;

      return {
        _id: user._id,
        login: user.login,
        role: user.role,
        name: user.name || null,
        email: user.email || null,
        blocked: user.blocked || false,
        currentDevice: {
          deviceId: activeDevice.deviceId || "—",
          deviceType: activeDevice.deviceType || "—",
          deviceOS: activeDevice.deviceOS || "—",
          lastLogin: activeDevice.lastLogin ? new Date(activeDevice.lastLogin).toISOString() : null
        },
        devicesCount: user.devices?.length || 0,
        firstLoginAt: firstLogin ? new Date(firstLogin).toISOString() : user.createdAt,
        createdAt: user.createdAt
      };
    });

    res.json({ success: true, count: formatted.length, users: formatted });
  } catch (err) {
    console.error("[admin/users] Xato:", err);
    res.status(500).json({ success: false, message: "Foydalanuvchilarni yuklashda xato" });
  }
});

/**
 * @route   POST /api/admin/block-user
 * @desc    Foydalanuvchini bloklash va REAL-TIME sessiyadan chiqarish
 */
router.post('/block-user', verifyToken, isAdmin, csrfProtection, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID majburiy" });
  }

  // O'zini o'zi bloklamaslik uchun tekshiruv
  if (userId === req.user.id) {
    return res.status(400).json({ success: false, message: "O'zingizni bloklay olmaysiz!" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { 
        blocked: true,
        $set: { 
          'devices.$[].isActive': false,
          'activeDevice.isActive': false // deviceId ni null qilmaymiz, faqat statusni o'zgartiramiz
        }
      },
      { new: true }
    ).select('-password -googleAuthSecret');

    if (!user) {
      return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi" });
    }

    // Sessiyalarni DB darajasida yopish
    await UserSession.updateMany(
      { userId: user._id },
      { isBlocked: true, isActive: false }
    );

    // REAL-TIME FORCE LOGOUT
    try {
      const { sendToUser } = require('../socket');
      
      // ✅ 1. 'forceLogout' - bu eventni main.tsx kutib turibdi
      sendToUser(user.login, 'forceLogout', { 
        reason: 'Hisobingiz administrator tomonidan bloklandi.' 
      });

      // ✅ 2. 'user:blocked' - bu eventni ham main.tsx kutib turibdi (toast chiqarish uchun)
      sendToUser(user.login, 'user:blocked', { 
        login: user.login,
        reason: 'Administrator tomonidan bloklandi' 
      });

      console.log(`🔴 [Socket] Force logout va Blocked eventlari yuborildi: ${user.login}`);
    } catch (socketErr) {
      console.warn("⚠️ Socket xatosi:", socketErr.message);
    }

    res.json({
      success: true,
      message: `${user.login} bloklandi va sessiyalari tugatildi`,
      user: { _id: user._id, login: user.login, blocked: user.blocked }
    });
  } catch (err) {
    console.error("[admin/block-user] Xato:", err);
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
});

/**
 * @route   POST /api/admin/unblock-user
 * @desc    Foydalanuvchini blokdan chiqarish
 */
router.post('/unblock-user', verifyToken, isAdmin, csrfProtection, async (req, res) => {
  const { userId } = req.body;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { blocked: false },
      { new: true }
    );

    if (!user) return res.status(404).json({ success: false, message: "Foydalanuvchi topilmadi" });

    await UserSession.updateMany({ userId: user._id }, { isBlocked: false });

    res.json({
      success: true,
      message: `${user.login} blokdan chiqarildi.`,
      user: { _id: user._id, login: user.login, blocked: user.blocked }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server xatosi" });
  }
});

/**
 * @route   GET /api/admin/stats
 * @desc    Statistika
 */
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ 'devices.0': { $exists: true } });
    const activeUsers = await User.countDocuments({ blocked: false, 'activeDevice.isActive': true });
    const blockedUsers = await User.countDocuments({ blocked: true });

    res.json({
      success: true,
      stats: { totalUsers, activeUsers, blockedUsers, timestamp: new Date().toISOString() }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Xato" });
  }
});

  return router;
};