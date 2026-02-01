const Jimp = require("jimp");
const QrCode = require("qrcode-reader");
const redis = require("../utils/redis");

// 🔍 QR kodni dekodlash
async function decodeQR(buffer) {
  const image = await Jimp.read(buffer);
  return new Promise((resolve, reject) => {
    const qr = new QrCode();
    qr.callback = (err, value) => {
      if (err || !value) return reject(err || "QR topilmadi");
      resolve(value.result);
    };
    try {
      qr.decode(image.bitmap);
    } catch (err) {
      reject("QR decodingda xatolik");
    }
  });
}

// 📦 QR JSONni parse qilish
function parseQR(raw) {
  try {
    const parsed = JSON.parse(raw);
    const { id, cashback } = parsed;
    if (!id || cashback === undefined || cashback === null) {
      return { error: "❌ QR kodda kerakli ma'lumotlar yo‘q." };
    }
    if (isNaN(parseFloat(cashback))) {
      return { error: "❌ Cashback qiymati noto‘g‘ri formatda." };
    }
    return { id, cashback: parseFloat(cashback) };
  } catch (err) {
    return { error: "❌ QR koddagi ma'lumot noto‘g‘ri formatda." };
  }
}

// 🧮 Cashbackni hisoblash va Redisga yozish
async function applyCashback(userId, id, cashback) {
  const used = await redis.get(`usedQR:${id}`);
  if (used) {
    return { success: false, message: "⚠️ Bu QR kod allaqachon ishlatilgan." };
  }

  const key = `cashback:${userId}`;
  const previous = parseFloat(await redis.get(key) || "0");
  const updated = previous + cashback;

  // 📝 Audit log: QRni kim ishlatdi, qachon, qancha
  await redis.set(`usedQR:${id}`, JSON.stringify({
    usedBy: userId,
    usedAt: Date.now(),
    cashback
  }));

  await redis.set(key, updated.toFixed(2));

  return {
    success: true,
    message: `✅ Sizga ${cashback} so‘m keshbek ajratildi.\n🆔 Chek ID: ${id}`,
    totalCashback: updated
  };
}

// 🔁 Asosiy handler
async function handleQrCashback(buffer, userId) {
  let raw;
  try {
    raw = await decodeQR(buffer);
  } catch (err) {
    return { success: false, message: "⚠️ QR kodni o‘qib bo‘lmadi." };
  }

  const { id, cashback, error } = parseQR(raw);
  if (error) return { success: false, message: error };

  return await applyCashback(userId, id, cashback);
}

module.exports = { handleQrCashback };
