const mongoose = require("mongoose");

const importedProductSchema = new mongoose.Schema({
  name: String,
  barcode: { type: String, required: true },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  category: { type: String, default: "" },
  addedAt: { type: Date, default: Date.now }
});

// aniq kolleksiya nomini berib qo'yamiz
module.exports = mongoose.model("ImportedProduct", importedProductSchema, "products");
