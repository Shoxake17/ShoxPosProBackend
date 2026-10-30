// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true }, // <-- muhim: qo'shildi!
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: "" },
  price: { type: Number, default: 0 },
  basePrice: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  incomingQuantity: { type: Number, default: 0 }, // KirimBazasi uchun
  sold: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now },

  // ── QURT do'konlari uchun qo'shimcha maydonlar (mijoz ilovasidagi Qurt sahifasi) ──
  // Faqat OnDex'da kategoriyasi `qurt` bo'lgan do'konlar yozadi (`routes/loginProducts.js`).
  imageUrl:    { type: String, default: "" },   // OnDex ombori manzili (mijoz ilovasi shundan oladi)
  description: { type: String, default: "" },   // tavsif
  composition: { type: String, default: "" },   // tarkibi
  weightGrams: { type: Number, default: 0 },    // nechi grammligi
  // OnDex'ga yuborilganmi. `false`/yo'q — yuborilishi kerak (`services/qurtSync.js` qayta urinadi).
  qurtSynced:  { type: Boolean },
}, { timestamps: true });

// Har bir foydalanuvchi uchun unikal barcode (login + barcode)
productSchema.index({ login: 1, barcode: 1 }, { unique: true });

// ─────────────────────────────────────────────────────────────────────
// Qurt: HAR QANDAY yozuv (qo'shish, narx, qoldiq, o'chirish — qaysi marshrut
// bo'lishidan qat'i nazar) OnDex bilan solishtirishni ishga tushiradi.
// Mantiq `services/qurtSync.js` da: u mahsulotning HOZIRGI holatini o'qib
// yuboradi yoki o'chiradi (idempotent), shuning uchun har bir marshrutga alohida
// chaqiruv qo'shish va birortasini unutish xavfi yo'q. Qurt bo'lmagan do'konlar
// uchun hech narsa qilmaydi. (Lazy require: servis modelni ham o'qiydi.)
// ─────────────────────────────────────────────────────────────────────
function keyFromFilter(filter) {
  if (!filter) return null;
  const pick = (v) => (v && typeof v === 'object' && typeof v.$eq === 'string' ? v.$eq : v);
  const login = pick(filter.login);
  const barcode = pick(filter.barcode);
  return typeof login === 'string' && typeof barcode === 'string' ? { login, barcode } : null;
}
function notify(key) {
  if (!key) return;
  try { require('../services/qurtSync').schedule(key.login, key.barcode); } catch (_) { /* servis yo'q bo'lsa jim */ }
}
productSchema.post('save', function () { notify({ login: this.login, barcode: this.barcode }); });
for (const op of ['findOneAndUpdate', 'findOneAndDelete', 'updateOne']) {
  productSchema.post(op, function () { notify(keyFromFilter(this.getFilter())); });
}
productSchema.post('deleteOne', { document: false, query: true }, function () {
  notify(keyFromFilter(this.getFilter()));
});

module.exports = mongoose.model("Product", productSchema, "products");
