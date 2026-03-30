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
  password: { 
    type: String, 
    required: true,
    select: false
  },
  role: { 
    type: String, 
    enum: ['admin', 'cashier'], 
    default: 'cashier' 
  },
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
  }

}, { 
  timestamps: true 
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