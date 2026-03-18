const express = require('express');
const router = express.Router();
const axios = require('axios');
// Boyagi metrics.js dan metrika obyektini chaqirib olamiz
const { totalCashbackGiven } = require('./metrics'); 

const SHOXPAY_BACKEND_URL = process.env.SHOXPAY_BACKEND_URL || 'http://localhost:4000';
const SHOXPOSPRO_SECRET   = process.env.SHOXPOSPRO_SECRET   || 'shoxpospro-secret-2024';

router.post('/register', async (req, res) => {
  try {
    const { receiptId, totalAmount, storeName } = req.body;

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

module.exports = router;