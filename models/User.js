// models/User.js
//
// Merchant web paneli hisobi. KIMLIK OnDex'da (yagona kirish, OIDC): parol,
// 2FA, passkey, qurilmalar, sessiyalar, obuna — hammasi OnDex markazida.
// Bu yerda faqat OnDex akkauntiga bog'lanish va POS (kassa) sozlamalari.
//
// 2026-11-12 tozalash: eski o'z-auth maydonlari (password/bcrypt, devices[]
// ichidagi JWT token va biometric kalit, googleAuthSecret, loginAttempts,
// blockedDevices), obuna (free/basic/pro, trial), role (admin/cashier),
// email, uniqueChatId, telegramId, isSecret OLIB TASHLANDI. Bazadagi eski
// qiymatlar `scripts/migrations/2026-11-12-drop-dead-user-fields.js` bilan
// o'chiriladi (sxemadan olib tashlash ularni bazadan O'CHIRMAYDI).
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Tenant kaliti (OnDex telefon raqami). Har bir so'rov SHU bilan cheklanadi.
  login: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  // OnDex akkaunti bilan bog'lanish. `ondexPhone` — admin do'kon hisobini
  // ochganda kiritadi (raqamlar, masalan 998901234567); do'konchi OnDex
  // orqali birinchi marta kirganda `ondexUserId` ulanadi va shundan keyin
  // kimlik SHU id bo'yicha taniladi (telefon o'zgarsa ham).
  ondexUserId: { type: String, unique: true, sparse: true, default: undefined },
  ondexPhone:  { type: String, trim: true, index: true, default: undefined },
  // OnDex'da hamkor akkaunti (restoran/do'kon) bo'lsa — rol va muassasa ID'si.
  ondexPartnerRole: { type: String, enum: ['store', 'restaurant'], default: undefined },
  ondexEntityId:    { type: String, trim: true, default: undefined },
  // Do'kon kategoriyasi (OnDex belgilaydi): qaysi sahifa/API ochiqligini
  // `services/storeAccess.js` shundan hal qiladi. Har kirishda yangilanadi.
  ondexStoreCategory: { type: String, enum: ['qurt', 'store', 'pharmacy'], default: undefined },

  shopName: { type: String, trim: true, default: null },
  shopType: { type: String, default: "" },
  shopCategories: [{ type: String }],

  // Kirish taqiqlari (merchantAccount.denyReason).
  isDeleted: { type: Boolean, default: false },
  blocked:   { type: Boolean, default: false },

  // Profil (OnDex'dan sinxronlanadi — partnerProfile.js).
  name:        { type: String },
  firstName:   { type: String, trim: true },
  lastName:    { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  avatarUrl:   { type: String, default: null },

  // Web Push obunasi (yangi qurt buyurtmasi xabari, routes/pushRoutes.js va
  // routes/storeOrders.js). Ilgari sxemada `pushSubscriptions` (ko'plik)
  // turardi, kod esa `pushSubscription` ga yozardi — Mongoose sxemada yo'q
  // maydonni jimgina tashlab yuborardi, ya'ni xabar HECH QACHON kelmasdi.
  pushSubscription: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
