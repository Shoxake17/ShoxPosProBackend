// models/QurtOrderLedger.js
'use strict';

const mongoose = require('mongoose');

/**
 * Qurt buyurtmasi tasdiqlanganda ombordan AYIRILGAN miqdor yozuvi.
 *
 * Nega kerak: buyurtma keyin (admin tomonidan) bekor qilinsa, ayirilgan qoldiq
 * aynan BIR MARTA qaytarilishi shart. `orderId` yagona — takroriy tasdiq yoki
 * takroriy bekor xabari qoldiqni ikki marta ayirmaydi/qaytarmaydi.
 */
const qurtOrderLedgerSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  login: { type: String, required: true, index: true },
  items: [{
    _id: false,
    barcode: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
  }],
  state: { type: String, enum: ['reserved', 'restored'], default: 'reserved' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('QurtOrderLedger', qurtOrderLedgerSchema);
