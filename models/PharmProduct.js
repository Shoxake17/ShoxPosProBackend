const mongoose = require("mongoose");

const pharmProductSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  basePrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  incomingQuantity: { type: Number, default: 0 },
  sold: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now },
  
  // Dorilar uchun qo'shimcha maydonlar
  dosage: { type: String, default: "" },           // Doza (masalan: 500mg)
  manufacturer: { type: String, default: "" },    // Ishlab chiqaruvchi
  expiryDate: { type: Date, default: null },      // Yaroqlilik muddati
  batchNumber: { type: String, default: "" },     // Partiya raqami
  isPrescriptionRequired: { type: Boolean, default: false }, // Retsept kerakmi?
  storageCondition: { type: String, default: "" }, // Saqlash sharti (masalan: 2-8°C)
  description: { type: String, default: "" },     // Tavsif
  dosageForm: { type: String, default: "" },      // Dori shakli (tabletka, sirop, vial, krem)
  shelfNumber: { type: String, default: "" },     // Shkaf raqami
  rowNumber: { type: String, default: "" },       // Qator raqami
  
}, { timestamps: true });

pharmProductSchema.index({ login: 1, barcode: 1 }, { unique: true });

module.exports = mongoose.model("PharmProduct", pharmProductSchema, "pharmproducts");
