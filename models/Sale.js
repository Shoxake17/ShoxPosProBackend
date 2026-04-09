const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true, default: 0 },
  basePrice: { type: Number, default: 0 },
  total: { type: Number, required: true },
  category: { type: String, default: '' },
  paymentMethod: { type: String, default: 'cash' },
  soldAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Compound index - tezroq qidiruv uchun
saleSchema.index({ login: 1, soldAt: -1 });

module.exports = mongoose.model("Sale", saleSchema, "sales");