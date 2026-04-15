'use strict';

const User = require('../models/User');

// Reja imkoniyatlarini belgilash
const PLAN_PERMISSIONS = {
  free: {
    pages: ['menu', 'products', 'scanner', 'sales', 'settings'],
    settingsFeatures: ['languages', 'theme', 'logout']
  },
  basic: {
    pages: ['menu', 'products', 'scanner', 'sales', 'debts', 'settings', 'chat'],
    settingsFeatures: ['all']
  },
  pro: {
    pages: ['all'],
    settingsFeatures: ['all']
  }
};

// Foydalanuvchi rejasini tekshirish va yangilash
const checkAndUpdatePlan = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;

  // Trial muddati tugaganini tekshiramiz
  if (user.subscription?.isTrial && user.subscription?.trialEndDate) {
    const now = new Date();
    if (now > new Date(user.subscription.trialEndDate)) {
      user.subscription.plan = 'free';
      user.subscription.isTrial = false;
      await user.save();
    }
  }

  return user;
};

// Sahifa/reja ruxsatini tekshirish uchun middleware
const checkPageAccess = (requiredPage) => {
  return async (req, res, next) => {
    try {
      const user = await checkAndUpdatePlan(req.user.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
      }

      const plan = user.subscription?.plan || 'free';
      const permissions = PLAN_PERMISSIONS[plan];

      // Pro rejada hamma saxifa mavjud
      if (permissions.pages.includes('all')) {
        req.user.subscription = user.subscription;
        return next();
      }

      // Boshqa rejalar uchun tekshiramiz
      if (!permissions.pages.includes(requiredPage)) {
        return res.status(403).json({ 
          success: false, 
          message: 'Bu saxifaga kirish uchun obuna rejangizni yangilang' 
        });
      }

      req.user.subscription = user.subscription;
      next();
    } catch (err) {
      console.error('Subscription check error:', err);
      return res.status(500).json({ success: false, message: 'Server xatosi' });
    }
  };
};

// Obuna rejasini olish
const getPlanPermissions = (plan) => {
  return PLAN_PERMISSIONS[plan] || PLAN_PERMISSIONS.free;
};

module.exports = {
  checkPageAccess,
  getPlanPermissions,
  checkAndUpdatePlan
};
