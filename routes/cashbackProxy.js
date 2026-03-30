const express = require('express');
const axios = require('axios');
const verifyToken = require('../middleware/verifyToken');
// Boyagi metrics.js dan metrika obyektini chaqirib olamiz
const { totalCashbackGiven } = require('./metrics'); 

module.exports = (csrfProtection) => {
  const router = express.Router();

const SHOXPAY_BACKEND_URL = process.env.SHOXPAY_BACKEND_URL || 'http://localhost:4000';
const SHOXPOSPRO_SECRET   = process.env.SHOXPOSPRO_SECRET   || 'shoxpospro-secret-2024';

router.post('/register', verifyToken, csrfProtection, async (req, res) => {
  try {
    const { receiptId, totalAmount, storeName } = req.body;
    
    // 🛡️ A10: SSRF prevention - inputs are validated and not used in URL construction directly
    if (!receiptId || typeof totalAmount !== 'number' || !storeName) {
      return res.status(400).json({ success: false, message: 'Ma\'lumotlar noto\'g\'ri' });
    }

    const response = await axios.post(
      `${SHOXPAY_BACKEND_URL}/api/cashback/register`,
      { receiptId, totalAmount, storeName },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SHOXPOSPRO_SECRET,
        },
        timeout: 5000,
      }
    );

    // ✅ MUVAFFAQIYATLI: Grafanadagi keshbek hisoblagichini oshiramiz
    // totalAmount-dan 1% keshbek deb hisoblasak (masalan):
    const cashbackAmount = totalAmount * 0.01; 
    totalCashbackGiven.inc(cashbackAmount);

    return res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    
    // ⚠️ XATOLIK: Bu yerda monitoring orqali xatolarni ham sanash mumkin
    console.error('ShoxPay backend bilan ulanib bo\'lmadi:', err.message);
    
    return res.status(200).json({
      success: false,
      message: 'Cashback ro\'yxatga olinmadi, lekin sotuv yakunlandi',
    });
  }
});

  return router;
};