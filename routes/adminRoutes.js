// routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const verifyToken = require('../middleware/verifyToken');
const { isAdmin } = require('../controllers/authController');

const User = require('../models/User');
const UserSession = require('../models/UserSession');

/**
 * @route   GET /api/admin/users
 * @desc    Login qilgan barcha foydalanuvchilarni ko'rsatish (faqat admin)
 * @access  Private (Admin only)
 */
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  try {
    // Faqat login qilgan (devices mavjud) foydalanuvchilarni olish
    const users = await User.find({ 
      'devices.0': { $exists: true } // Kamida bitta qurilma mavjud
    })
      .select('-password -googleAuthSecret')
      .sort({ 'activeDevice.lastLogin': -1 }) // Oxirgi login bo'yicha
      .lean();

    const formatted = users.map(user => {
      // Oxirgi faol qurilmani topish
      const activeDevice = user.activeDevice || {};
      
      // Birinchi marta login qilgan vaqtni topish (eng eski qurilma)
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
        
        // Faol qurilma ma'lumotlari
        currentDevice: {
          deviceId: activeDevice.deviceId || "—",
          deviceType: activeDevice.deviceType || "—",
          deviceOS: activeDevice.deviceOS || "—",
          lastLogin: activeDevice.lastLogin 
            ? new Date(activeDevice.lastLogin).toISOString() 
            : null
        },
        
        // Jami qurilmalar soni
        devicesCount: user.devices?.length || 0,
        
        // Birinchi login vaqti
        firstLoginAt: firstLogin ? new Date(firstLogin).toISOString() : user.createdAt,
        
        // Hisob yaratilgan vaqt
        createdAt: user.createdAt
      };
    });

    res.json({
      success: true,
      count: formatted.length,
      users: formatted
    });
  } catch (err) {
    console.error("[admin/users] Xato:", err);
    res.status(500).json({ 
      success: false, 
      message: "Foydalanuvchilarni yuklashda xato" 
    });
  }
});

/**
 * @route   POST /api/admin/block-user
 * @desc    Foydalanuvchini bloklash (admin) - REAL-TIME SOCKET.IO BILAN
 * @access  Private (Admin only)
 */
router.post('/block-user', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ 
      success: false,
      message: "User ID majburiy" 
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { 
        blocked: true,
        // Barcha qurilmalarni deaktiv qilish
        $set: { 
          'devices.$[].isActive': false,
          'activeDevice.deviceId': null
        }
      },
      { new: true }
    ).select('-password -googleAuthSecret');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Foydalanuvchi topilmadi" 
      });
    }

    // Sessiyalarni ham bloklash
    await UserSession.updateMany(
      { userId: user._id },
      { isBlocked: true, isActive: false }
    );

    // ⚠️ Socket orqali REAL-TIME force logout yuborish
    try {
      const { io } = require('../server');
      
      if (io) {
        // Yangi event - user:blocked
        io.emit('user:blocked', { 
          login: user.login,
          userId: user._id.toString(),
          reason: 'Admin tomonidan bloklandi',
          timestamp: new Date().toISOString()
        });

        // Eski event ham qo'llab-quvvatlash (backward compatibility)
        io.emit('forceLogout', { 
          login: user.login, 
          reason: 'blocked' 
        });

        console.log(`🔴 [Socket] Force logout yuborildi: ${user.login}`);
      } else {
        console.warn('⚠️ Socket.io topilmadi (module.exports qilinmagandir)');
      }
    } catch (socketErr) {
      console.warn("⚠️ Socket.io xatosi (lekin bloklash bajarildi):", socketErr.message);
    }

    res.json({
      success: true,
      message: `${user.login} bloklandi va barcha sessiyalari tugatildi`,
      user: {
        _id: user._id,
        login: user.login,
        blocked: user.blocked
      }
    });
  } catch (err) {
    console.error("[admin/block-user] Xato:", err);
    res.status(500).json({ 
      success: false,
      message: "Server xatosi" 
    });
  }
});

/**
 * @route   POST /api/admin/unblock-user
 * @desc    Foydalanuvchini blokdan chiqarish
 * @access  Private (Admin only)
 */
router.post('/unblock-user', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ 
      success: false,
      message: "User ID majburiy" 
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { blocked: false },
      { new: true }
    ).select('-password -googleAuthSecret');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Foydalanuvchi topilmadi" 
      });
    }

    // Sessiyalarni unblock qilish (lekin hali active emas)
    await UserSession.updateMany(
      { userId: user._id },
      { isBlocked: false }
    );

    console.log(`✅ [Admin] ${user.login} blokdan chiqarildi`);

    res.json({
      success: true,
      message: `${user.login} blokdan chiqarildi. Qayta login qilishi mumkin.`,
      user: {
        _id: user._id,
        login: user.login,
        blocked: user.blocked
      }
    });
  } catch (err) {
    console.error("[admin/unblock-user] Xato:", err);
    res.status(500).json({ 
      success: false,
      message: "Server xatosi" 
    });
  }
});

/**
 * @route   GET /api/admin/stats
 * @desc    Admin panel uchun umumiy statistika
 * @access  Private (Admin only)
 */
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ 
      'devices.0': { $exists: true } // Login qilgan userlar
    });
    
    const activeUsers = await User.countDocuments({ 
      blocked: false,
      'activeDevice.deviceId': { $ne: null }
    });
    
    const blockedUsers = await User.countDocuments({ blocked: true });

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        blockedUsers,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[admin/stats] Xato:", err);
    res.status(500).json({ 
      success: false,
      message: "Statistikani yuklashda xato" 
    });
  }
});

/**
 * @route   GET /api/admin/user-devices/:userId
 * @desc    Foydalanuvchining barcha qurilmalari
 * @access  Private (Admin only)
 */
router.get('/user-devices/:userId', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('login devices activeDevice')
      .lean();

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Foydalanuvchi topilmadi" 
      });
    }

    res.json({
      success: true,
      login: user.login,
      activeDevice: user.activeDevice,
      devices: user.devices || []
    });
  } catch (err) {
    console.error("[admin/user-devices] Xato:", err);
    res.status(500).json({ 
      success: false,
      message: "Qurilmalarni yuklashda xato" 
    });
  }
});

module.exports = router;