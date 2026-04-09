const mongoose = require("mongoose");

const debtSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  amount: { type: Number, required: true },
  lastPayment: { type: Date, default: Date.now }
}, { timestamps: true });

// Har bir foydalanuvchi uchun alohida qarzlar (login bo'yicha filterlanadi)
debtSchema.index({ login: 1, lastPayment: -1 });

module.exports = mongoose.model("Debt", debtSchema, "debts");
