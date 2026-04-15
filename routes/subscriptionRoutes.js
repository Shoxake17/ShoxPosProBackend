'use strict';

const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/verifyToken');
const { cacheMiddleware, invalidateUserCache, CACHE_TTL } = require('../middleware/redisCache');
const User = require('../models/User');
const { sendToUser } = require('../socket');

// Obuna ma'lumotlarini olish - 10 daqiqa cache
router.get('/current', verifyToken, cacheMiddleware(CACHE_TTL.LONG), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    // Trial muddati tugaganligini tekshiramiz
    let subscription = user.subscription;
    if (subscription?.isTrial && subscription?.trialEndDate) {
      const now = new Date();
      if (now > new Date(subscription.trialEndDate)) {
        subscription.plan = 'free';
        subscription.isTrial = false;
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              'subscription.plan': 'free',
              'subscription.isTrial': false
            }
          }
        );
      }
    }

    res.json({
      success: true,
      subscription: subscription || { plan: 'free', isTrial: false }
    });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// Obuna rejasini yangilash (bu joyda to'lov integratsiyasi bo'lishi mumkin)
router.post('/change-plan', verifyToken, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['free', 'basic', 'pro'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Noto\'g\'ri reja' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });
    }

    user.subscription.plan = plan;
    user.subscription.isTrial = false;
    await user.save();

    // 🗑️ 1. Cache invalidatsiya - eski subscription cache'larini tozalash
    await invalidateCache(`GET:/api/subscription/current`);
    
    // 🗑️ 2. User cache'larini ham tozalash (reja o'zgarganda barcha ma'lumotlarni yangilash kerak)
    await invalidateUserCache(user.login);

    // Real-time yangilash: foydalanuvchining barcha qurilmalariga xabar yuborish
    sendToUser(user.login, 'subscriptionChanged', { subscription: user.subscription });

    res.json({
      success: true,
      message: 'Obuna rejasini muvaffaqiyatli yangilandi',
      subscription: user.subscription
    });
  } catch (err) {
    console.error('Change plan error:', err);
    res.status(500).json({ success: false, message: 'Server xatosi' });
  }
});

// Obuna rejalari haqida ma'lumot - 10 daqiqa cache
router.get('/plans', cacheMiddleware(CACHE_TTL.LONG), (req, res) => {
  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      period: 'month',
      features: [
        'Menu saxifasi',
        'MaxsulotBazasi saxifasi',
        'Sotish terminal saxifasi',
        'Sotilgan maxsulotlar ro\'yhati',
        'Til va Mavzu (Theme) sozlamalari',
        'Logout funksiyasi'
      ]
    },
    {
      id: 'basic',
      name: 'Basic',
      price: 49000,
      period: 'month',
      features: [
        'Barcha Free rejasi funksiyalari',
        'Qarzlar saxifasi',
        'Chat saxifasi',
        'Sozlamalarning barcha funksiyalari'
      ]
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 99000,
      period: 'month',
      features: [
        'Barcha Basic rejasi funksiyalari',
        'Kirim bazasi',
        'Hisobotlar',
        'AI yordamchisi',
        'Maxsulot qo\'shish',
        'Barcha cheklovlarsiz foydalanish',
        'Maxsus qo\'llab-quvvatlash'
      ]
    }
  ];

  res.json({ success: true, plans });
});

module.exports = router;
