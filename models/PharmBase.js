const mongoose = require("mongoose");

const pharmBaseSchema = new mongoose.Schema({
  barcode: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  basePrice: { type: Number, default: 0 },
  
  // Dorilar uchun qo'shimcha maydonlar
  dosage: { type: String, default: "" },
  manufacturer: { type: String, default: "" },
  storageCondition: { type: String, default: "" },
  sideEffects: { type: String, default: "" },
  description: { type: String, default: "" },
  composition: { type: String, default: "" },
  dosageForm: { type: String, default: "" },
  isPrescriptionRequired: { type: Boolean, default: false },
  
  addedAt: { type: Date, default: Date.now },
  
}, { timestamps: true });

module.exports = mongoose.model("PharmBase", pharmBaseSchema, "pharm_base");
