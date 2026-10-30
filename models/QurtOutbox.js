// models/QurtOutbox.js
// OnDex'dan o'chirilishi kerak bo'lgan, lekin hozircha o'chirilmagan qurt mahsulotlari.
// (Mahsulot ShoxPos'da o'chirilgach hujjat yo'qoladi, shuning uchun "o'chirilmay qoldi"
// holatini alohida saqlash kerak — aks holda OnDex'da eskirgan mahsulot qolib ketadi.)
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  login: { type: String, required: true },
  barcode: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
schema.index({ login: 1, barcode: 1 }, { unique: true });

module.exports = mongoose.model('QurtOutbox', schema, 'qurtoutbox');
