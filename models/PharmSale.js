const mongoose = require("mongoose");

const pharmSaleSchema = new mongoose.Schema(
  {
    login: { type: String, required: true, index: true },
    items: [
      {
        barcode: { type: String, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        basePrice: { type: Number, default: 0 },
        total: { type: Number, required: true },
        dosage: { type: String, default: "" },
        manufacturer: { type: String, default: "" },
      },
    ],
    totalAmount: { type: Number, required: true },
    paymentMethod: { type: String, enum: ["naqd", "plastik", "qarz"], default: "naqd" },
    soldAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PharmSale", pharmSaleSchema, "pharmsales");
