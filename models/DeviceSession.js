const mongoose = require('mongoose');

const deviceSessionSchema = new mongoose.Schema({
  login: { type: String, required: true },
  deviceId: { type: String, required: true },
  deviceType: String,
  deviceOS: String,
  lastActive: { type: Date, default: Date.now },
  active: { type: Boolean, default: true }
});

module.exports = mongoose.model('DeviceSession', deviceSessionSchema);

