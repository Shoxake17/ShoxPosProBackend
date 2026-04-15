const express = require("express");
const verifyToken = require('../middleware/verifyToken');
const { cacheMiddleware, invalidateUserCache, CACHE_TTL } = require('../middleware/redisCache');
const Debt = require('../models/Debt');

module.exports = (csrfProtection) => {
  const router = express.Router();

// Barcha qarzlarni olish - 3 daqiqa cache
router.get("/debts/:login", verifyToken, cacheMiddleware(CACHE_TTL.MEDIUM), async (req, res) => {
  try {
    const { login } = req.params;
    
    // 🛡️ A01: Broken Access Control
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    const debts = await Debt.find({ login: safeLogin }).sort({ lastPayment: -1 }).lean();

    const formattedDebts = debts.map(debt => ({
      id: debt._id.toString(),
      name: debt.name,
      phone: debt.phone,
      amount: debt.amount,
      lastPayment: new Date(debt.lastPayment).toISOString().split('T')[0]
    }));

    res.json(formattedDebts);
  } catch (err) {
    console.error("Qarzlarni olishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// Yangi qarz qo'shish
router.post("/debts/:login", verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login } = req.params;
    const { name, phone, amount } = req.body;

    // 🛡️ A01: Broken Access Control
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    if (!name || !name.trim() || !phone || !amount || amount <= 0) {
      return res.status(400).json({ message: "Ma'lumotlar to'liq emas yoki noto'g'ri" });
    }

    const newDebt = await Debt.create({
      login: safeLogin,
      name: name.trim(),
      phone,
      amount: Number(amount)
    });

    res.json({
      id: newDebt._id.toString(),
      name: newDebt.name,
      phone: newDebt.phone,
      amount: newDebt.amount,
      lastPayment: new Date(newDebt.lastPayment).toISOString().split('T')[0]
    });
  } catch (err) {
    console.error("Qarz qo'shishda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

// To'lov qilish (qisman yoki to'liq)
router.post("/debts/pay/:login", verifyToken, csrfProtection, async (req, res) => {
  try {
    const { login } = req.params;
    const { debtId, paymentAmount } = req.body;

    // 🛡️ A01: Broken Access Control
    const safeLogin = String(login).trim().toLowerCase();
    if (req.user.login !== safeLogin && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Ruxsat etilmagan!" });
    }

    if (!debtId || !paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "To'lov ma'lumotlari noto'g'ri" });
    }

    const debt = await Debt.findOne({ _id: debtId, login: safeLogin });

    if (!debt) {
      return res.status(404).json({ message: "Qarz topilmadi" });
    }

    const paid = Number(paymentAmount);

    if (paid >= debt.amount) {
      // To'liq to'landi — o'chirib tashlaymiz
      await Debt.findOneAndDelete({ _id: debtId, login: safeLogin });
      res.json({ action: "fully_paid" });
    } else {
      // Qisman to'lov
      debt.amount -= paid;
      debt.lastPayment = new Date();
      await debt.save();

      res.json({
        action: "partial",
        amount: debt.amount,
        lastPayment: new Date(debt.lastPayment).toISOString().split('T')[0]
      });
    }
  } catch (err) {
    console.error("To'lovda xato:", err);
    res.status(500).json({ message: "Server xatosi" });
  }
});

  return router;
};