// middleware/checkBlockedUser.js

const User = require('../models/User');

/**
 * Bloklangan foydalanuvchilarni tekshirish middleware
 */
const checkBlockedUser = async (req, res, next) => {
  try {
    const { login } = req.body;

    if (!login) {
      return next(); // Login yo'q bo'lsa, keyingi middleware'ga o'tkazamiz
    }

    // Foydalanuvchini topish
    const user = await User.findOne({ 
      login: login.toLowerCase().trim() 
    }).select('blocked login');

    // Agar foydalanuvchi bloklangan bo'lsa
    if (user && user.blocked) {
      return res.status(403).json({
        success: false,
        blocked: true,
        message: "Sizning hisobingiz bloklangan. Administrator bilan bog'laning.",
        contact: "Murojaat uchun: admin@shoxpospro.uz"
      });
    }

    // Bloklanmagan bo'lsa, davom ettiramiz
    next();
  } catch (err) {
    console.error("[checkBlockedUser] Xato:", err);
    // Xatolik bo'lsa ham login jarayonini davom ettiramiz
    next();
  }
};

module.exports = checkBlockedUser;