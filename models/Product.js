// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true }, // <-- muhim: qo'shildi!
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  basePrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  incomingQuantity: { type: Number, default: 0 }, // KirimBazasi uchun
  sold: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Har bir foydalanuvchi uchun unikal barcode (login + barcode)
productSchema.index({ login: 1, barcode: 1 }, { unique: true });

module.exports = mongoose.model("Product", productSchema, "products");