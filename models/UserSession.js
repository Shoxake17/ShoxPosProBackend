const mongoose = require('mongoose');

/**
 * 🔐 Refresh tokenlar sxemasi
 * Har bir qurilmaga bog‘langan refresh tokenlarni saqlaydi.
 */
const refreshTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    trim: true,
  },
  tokenId: {
    type: String,
    required: true,
    trim: true,
  },
  deviceId: {
    type: String,
    required: true,
    trim: true,
  },
  deviceType: {
    type: String,
    default: "Unknown",
  },
  deviceOS: {
    type: String,
    default: "Unknown",
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30, // 30 kun ichida avtomatik o‘chadi
  },
}, { _id: false });

/**
 * 💻 Foydalanuvchi sessiyalari sxemasi
 * Har bir login uchun sessiya, tokenlar va qurilma ma’lumotlarini saqlaydi.
 */
const userSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  deviceId: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  ip: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  lastLogout: {
    type: Date,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  blockedAt: {
    type: Date,
  },
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  tokens: [{
    type: String,
    trim: true,
  }],
  refreshTokens: [refreshTokenSchema],
}, {
  timestamps: true,
});

/**
 * 🧠 Virtual field – sessiya holati (Active yoki Blocked)
 */
userSessionSchema.virtual('status').get(function () {
  if (this.isBlocked) return 'Blocked';
  if (this.isActive) return 'Active';
  return 'Inactive';
});

/**
 * 🧹 Pre-save middleware
 * Sessiya holati o‘zgarganda avtomatik vaqtlarni yangilaydi.
 */
userSessionSchema.pre('save', function (next) {
  if (!this.isNew && this.isModified('isActive')) {
    this.lastLogin = this.isActive ? new Date() : this.lastLogin;
    this.lastLogout = !this.isActive ? new Date() : this.lastLogout;
  }
  next();
});

/**
 * 🧰 Custom methods
 */
userSessionSchema.methods = {
  deactivate() {
    this.isActive = false;
    this.lastLogout = new Date();
    return this.save();
  },
  activate() {
    this.isActive = true;
    this.lastLogin = new Date();
    return this.save();
  },
  block(byUserId) {
    this.isBlocked = true;
    this.blockedAt = new Date();
    this.blockedBy = byUserId || null;
    this.isActive = false;
    return this.save();
  },
  unblock() {
    this.isBlocked = false;
    this.blockedAt = null;
    this.isActive = true;
    return this.save();
  },
};

module.exports = mongoose.model('UserSession', userSessionSchema);
