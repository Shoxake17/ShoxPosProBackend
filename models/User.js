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
    enum: ['admin', 'cashier', 'seller', 'user'], 
    default: 'cashier' 
  },
  isDeleted: { 
    type: Boolean, 
    default: false 
  },

  // Qo'shimcha ma'lumotlar
  email: { 
    type: String, 
    unique: true, 
    sparse: true 
  },
  name: { 
    type: String 
  },

  // Qurilma ma'lumotlari (hozirgi faol qurilma)
  activeDevice: {
    deviceId: { type: String, default: null },
    deviceType: { type: String, default: "unknown" },
    deviceOS: { type: String, default: "unknown" },
    lastLogin: { type: Date }
  },

  // Qurilmalar ro'yxati
  devices: [{
    deviceId: { type: String, required: true },
    deviceType: { type: String, required: true }, 
    deviceOS: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: Date.now },
    isSuspicious: { type: Boolean, default: false },
    isTrusted: { type: Boolean, default: false },
    
    biometric: {
      enabled: { type: Boolean, default: false },
      credentialId: { type: String },
      publicKey: { type: String }, // WebAuthn public key
      counter: { type: Number, default: 0 }, // Replay attack oldini olish uchun
      enabledAt: { type: Date }
    }
  }],

  // Bloklanganmi?
  blocked: { 
    type: Boolean, 
    default: false 
  },



  //  Authenticator
googleAuthSecret: { 
    type: String, 
    default: null 
  },
  googleAuthEnabled: { 
    type: Boolean, 
    default: false 
  },
  // Noto'g'ri kirish urinishlari
  loginAttempts: { 
    type: Number, 
    default: 0 
  },
  blockedDevices: [{ 
    deviceId: String, 
    lockUntil: Date 
  }]

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