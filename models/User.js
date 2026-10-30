// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  login: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  // Parol ENDI YO'Q: kirish OnDex orqali (yagona kirish). Maydon eski
  // hujjatlar uchun qoldi va hech qachon to'ldirilmaydi.
  password: {
    type: String,
    required: false,
    select: false
  },

  // OnDex akkaunti bilan bog'lanish. `ondexPhone` — admin do'kon hisobini
  // ochganda kiritadi (raqamlar, masalan 998901234567); do'konchi OnDex
  // orqali birinchi marta kirganda `ondexUserId` ulanadi va shundan keyin
  // kimlik SHU id bo'yicha taniladi (telefon o'zgarsa ham).
  ondexUserId: { type: String, unique: true, sparse: true, default: undefined },
  ondexPhone:  { type: String, trim: true, index: true, default: undefined },
  // OnDex'da hamkor akkaunti (restoran/do'kon) bo'lsa — rol va muassasa ID'si.
  // Hisob SHU orqali avtomatik ochiladi (admin OnDex panelidan ro'yxatdan o'tkazadi).
  ondexPartnerRole: { type: String, enum: ['store', 'restaurant'], default: undefined },
  ondexEntityId:    { type: String, trim: true, default: undefined },
  // Do'kon kategoriyasi (OnDex belgilaydi): qaysi sahifa/API ochiqligini
  // `services/storeAccess.js` shundan hal qiladi. Har kirishda yangilanadi.
  ondexStoreCategory: { type: String, enum: ['qurt', 'store', 'pharmacy'], default: undefined },
  role: { 
    type: String, 
    enum: ['admin', 'cashier'], 
    default: 'cashier' 
  },
  subscription: {
    plan: { 
      type: String, 
      enum: ['free', 'basic', 'pro'], 
      default: 'pro' 
    },
    trialEndDate: { type: Date },
    isTrial: { type: Boolean, default: true },
    startDate: { type: Date, default: Date.now }
  },
  shopName: {
    type: String,
    trim: true,
    default: null
  },
  shopType: { 
    type: String, 
    default: "" 
  },
  shopCategories: [{ 
    type: String 
  }],
  isDeleted: { 
    type: Boolean, 
    default: false 
  },

  email: { 
    type: String, 
    unique: true, 
    sparse: true 
  },
  name: { 
    type: String 
  },

  // Hozirgi faol qurilma
  activeDevice: {
    deviceId:   { type: String, default: null },
    deviceType: { type: String, default: "unknown" },
    deviceOS:   { type: String, default: "unknown" },
    lastLogin:  { type: Date }
  },

  // Qurilmalar ro'yxati
  devices: [{
    deviceId:   { type: String, required: true },
    deviceType: { type: String, required: true }, 
    deviceOS:   { type: String, required: true },
    deviceModel: { type: String, default: null },
    location:    { type: String, default: null },
    ip:      { type: String, default: null },
    isActive:   { type: Boolean, default: true },
    lastLogin:  { type: Date, default: Date.now },
    isSuspicious: { type: Boolean, default: false },
    isTrusted:  { type: Boolean, default: false },

    // ✅ YANGI — kick-device va blacklist uchun
    token:    { type: String, default: null },  // JWT token saqlanadi
    kickedAt: { type: Date, default: null },    // Qachon chiqarilgani

    biometric: {
      enabled:      { type: Boolean, default: false },
      credentialId: { type: String },
      publicKey:    { type: String },
      counter:      { type: Number, default: 0 },
      enabledAt:    { type: Date }
    }
  }],

  blocked: { 
    type: Boolean, 
    default: false 
  },

  googleAuthSecret: { 
    type: String, 
    default: null 
  },
  googleAuthEnabled: { 
    type: Boolean, 
    default: false 
  },

  loginAttempts: { 
    type: Number, 
    default: 0 
  },
  blockedDevices: [{ 
    deviceId: String, 
    lockUntil: Date 
  }],

  isSecret: { 
    type: Boolean, 
    default: false 
  },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  avatarUrl: { type: String, default: null },
  uniqueChatId: { 
    type: String, 
    unique: true, 
    sparse: true 
  },
  telegramId: {
    type: String,
    trim: true,
    default: null
  },
  pushSubscriptions: [{
    type: mongoose.Schema.Types.Mixed,
    default: null
  }]
}, { 
  timestamps: true 
});

// ✅ 10 xonali unikal ID yaratish
userSchema.pre('save', async function(next) {
  if (!this.uniqueChatId) {
    let isUnique = false;
    while (!isUnique) {
      const newId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
      const existing = await mongoose.models.User.findOne({ uniqueChatId: newId });
      if (!existing) {
        this.uniqueChatId = newId;
        isUnique = true;
      }
    }
  }
  next();
});

// Parolni hashlash
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Parolni solishtirish
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);