const mongoose = require('mongoose');

// 🔹 Audit log schema
const auditSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  login: { type: String, required: true }, // endi userId emas, login saqlanadi
  action: { type: String, required: true },
  status: { type: String, required: true },
  details: { type: Object, default: {} },
  deviceId: { type: String } // Logout uchun
});

// 🔹 Audit modeli
const AuditLog = mongoose.model('AuditLog', auditSchema);

// 🔹 Foydalanuvchi harakatlarini log qilish
async function logUserAction({ login, action, status, details = {} }) {
  const logEntry = { login, action, status, details };

  try {
    await AuditLog.create(logEntry);
  } catch (err) {
    console.error('❌ MongoDB ga audit log yozishda xato:', err);
  }
}

// 🔹 Logout log
async function logLogout({ login, deviceId }) {
  const logEntry = { login, action: 'LOGOUT', status: 'SUCCESS', deviceId };

  try {
    await AuditLog.create(logEntry);
  } catch (err) {
    console.error('❌ MongoDB ga audit logout yozishda xato:', err);
  }
}

module.exports = {
  logUserAction,
  logLogout
};
