// 📦 config/db.js
const mongoose = require('mongoose');
const config = require('./index'); // cleanEnv bilan validatsiyalangan env

const MONGO_URI = config.MONGO_URI;
const DB_NAME = MONGO_URI.split('/').pop().split('?')[0]; // posdb yoki shoxpos

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI);

    const dbName = conn.connection?.db?.databaseName || DB_NAME;
    console.log(`✅ MongoDB '${dbName}' bazasiga ulanish muvaffaqiyatli`);
  } catch (err) {
    console.error('❌ MongoDB ulanishda xatolik:', err.message);

    if (config.NODE_ENV === 'production') {
      console.error('❌ Production rejimda — ilova to‘xtatildi');
      process.exit(1);
    } else {
      console.warn('⚠️ Development rejimda — ilova davom etmoqda');
    }
  }
};

// 🔄 Ulanish holatlari
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB ulanish uzildi');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔄 MongoDB qayta ulandi');
});



module.exports = connectDB;
