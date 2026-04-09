const mongoose = require("mongoose");

const productBaseSchema = new mongoose.Schema({
  barcode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  basePrice: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("ProductBase", productBaseSchema, "products_base");
