const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Dinamik Qarzlar modeli
function getDebtsModel(login) {
  const collectionName = `debts_${login}`;
  
  // Agar model allaqachon yaratilgan bo'lsa, qaytar
  if (mongoose.models[collectionName]) {
    return mongoose.models[collectionName];
  }

  const debtSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    lastPayment: { type: Date, default: Date.now }
  }, { timestamps: true });

  return mongoose.model(collectionName, debtSchema, collectionName);
}

// Barcha qarzlarni olish
router.get("/debts/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const Debts = getDebtsModel(login);

    const debts = await Debts.find({}).sort({ lastPayment: -1 }).lean();

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
router.post("/debts/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { name, phone, amount } = req.body;

    if (!name || !name.trim() || !phone || !amount || amount <= 0) {
      return res.status(400).json({ message: "Ma'lumotlar to'liq emas yoki noto'g'ri" });
    }

    const Debts = getDebtsModel(login);

    const newDebt = await Debts.create({
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
router.post("/debts/pay/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { debtId, paymentAmount } = req.body;

    if (!debtId || !paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "To'lov ma'lumotlari noto'g'ri" });
    }

    const Debts = getDebtsModel(login);
    const debt = await Debts.findById(debtId);

    if (!debt) {
      return res.status(404).json({ message: "Qarz topilmadi" });
    }

    const paid = Number(paymentAmount);

    if (paid >= debt.amount) {
      // To'liq to'landi — o'chirib tashlaymiz
      await Debts.findByIdAndDelete(debtId);
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

// Muhim: router ni eksport qilish
module.exports = router;