// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  barcode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  basePrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 }, // <-- muhim: qo'shildi!
  addedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);