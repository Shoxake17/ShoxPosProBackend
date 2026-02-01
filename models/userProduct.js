const mongoose = require("mongoose");

const userProductSchema = new mongoose.Schema({
  login: { type: String, required: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  category: { type: String, default: "" }
});

module.exports = mongoose.model("UserProduct", userProductSchema);
