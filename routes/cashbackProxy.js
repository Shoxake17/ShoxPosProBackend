// ============================================
// ShoxPosPro Backend: routes/cashbackProxy.js
// Port: localhost:3000
// ============================================
// server.js yoki app.js ga qo'shing:
//   app.use('/api/cashback', require('./routes/cashbackProxy'));
// ============================================

const express = require('express');
const router = express.Router();
const axios = require('axios'); // npm install axios

const SHOXPAY_BACKEND_URL = process.env.SHOXPAY_BACKEND_URL || 'http://localhost:4000';
const SHOXPOSPRO_SECRET   = process.env.SHOXPOSPRO_SECRET   || 'shoxpospro-secret-2024';

// ─────────────────────────────────────────────
// POST /api/cashback/register
// Chek chiqarilganda ShoxPosPro Frontend chaqiradi
// Bu route ShoxPay backendga forward qiladi
// Body: { receiptId, totalAmount, storeName }
// ─────────────────────────────────────────────
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

    return res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      // ShoxPay backend xatosi
      return res.status(err.response.status).json(err.response.data);
    }
    console.error('ShoxPay backend bilan ulanib bo\'lmadi:', err.message);
    // ShoxPay backend ishlamasa ham chek chiqishiga to'sqinlik qilmasin
    return res.status(200).json({
      success: false,
      message: 'Cashback ro\'yxatga olinmadi (ShoxPay bilan ulanish xatosi), lekin sotuv yakunlandi',
    });
  }
});

module.exports = router;