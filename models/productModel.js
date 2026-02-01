const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  barcode: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },           // Sotuv narxi
  basePrice: { type: Number, default: 0 },       // Ulgurji narx
  quantity: { type: Number, default: 0 },        // Sotuvda qolgan miqdor (MaxsulotBazasi)
  incomingQuantity: { type: Number, default: 0 }, // Kirim miqdori (KirimBazasi)
}, { timestamps: true });