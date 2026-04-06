// ShoxPosProBackend/routes/cashbackProxy.js
'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto'); // Imzo yasash uchun Node.js ichki moduli
const verifyToken = require('../middleware/verifyToken');
const { totalCashbackGiven } = require('./metrics');

module.exports = (csrfProtection) => {
  const router = express.Router();

  // Environment variables
  const SHOXPAY_BACKEND_URL = process.env.SHOXPAY_BACKEND_URL || 'http://localhost:4000';
  const SHOXPOSPRO_SECRET = process.env.SHOXPOSPRO_SECRET;
  const QR_SECRET_KEY = process.env.QR_SECRET_KEY || 'shox-pos-pro-qr-secret-2026';

  /**
   * 🛡️ HMAC Signature Generator
   * Ma'lumotlarni qalbaki o'zgartirishdan himoya qiladi
   */
  const generateSignature = (receiptId, timestamp) => {
    const data = `${receiptId}|${timestamp}`;
    return crypto
      .createHmac('sha256', QR_SECRET_KEY)
      .update(data)
      .digest('hex')
      .substring(0, 12); // QR kod ixcham bo'lishi uchun 12 ta belgi kifoya
  };

  /**
   * @route   POST /api/cashback/register
   * @desc    Keshbekni ro'yxatga olish va QR imzo yaratish
   * @access  Private (Sotuvchi login qilgan bo'lishi shart)
   */
  router.post('/register', verifyToken, csrfProtection, async (req, res) => {
    // 1. Dastlabki validatsiya
    const { receiptId, totalAmount, storeName } = req.body;
    const timestamp = new Date().toISOString();

    if (!receiptId || !/^\d{12}$/.test(receiptId)) {
      return res.status(400).json({ success: false, message: "Chek ID formati xato" });
    }

    if (typeof totalAmount !== 'number' || totalAmount <= 0) {
      return res.status(400).json({ success: false, message: "Xarid summasi noto'g'ri" });
    }

    try {
      // 2. Xavfsiz imzo yaratish (Faqat bizning backend biladigan kalit bilan)
      const signature = generateSignature(receiptId, timestamp);

      if (!SHOXPOSPRO_SECRET) {
        console.error('❌ XATO: SHOXPOSPRO_SECRET o‘rnatilmagan!');
        return res.status(500).json({ success: false, message: "Tizim sozlamasi xatosi" });
      }

      // 3. ShoxPay Backendga so'rov (Server-to-Server Auth)
      const response = await axios.post(
        `${SHOXPAY_BACKEND_URL}/api/cashback/register`,
        {
          receiptId,
          totalAmount,
          storeName: storeName || 'ShoxPosPro',
          timestamp, // Vaqtni ham yuboramiz
          signature  // Imzoni ham yuboramiz
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': SHOXPOSPRO_SECRET,
          },
          timeout: 6000,
          validateStatus: (status) => status < 500,
        }
      );

      // 4. Muvaffaqiyatli javob bo'lsa, Front-endga imzoli ma'lumotni qaytaramiz
      if (response.data && response.data.success) {
        // Monitoringni yangilash
        const cashbackAmount = Math.floor(totalAmount * 0.01);
        if (totalCashbackGiven?.inc) totalCashbackGiven.inc(cashbackAmount);

        // Frontendga signature va timestamp qaytaramiz, u QR kodni shunga qarab yasaydi
        return res.status(response.status).json({
          ...response.data,
          timestamp,
          signature
        });
      }

      return res.status(response.status).json(response.data);

    } catch (err) {
      console.error(`⚠️ Cashback Proxy ulanish xatosi [${receiptId}]:`, err.message);
      
      // Sotuv to'xtab qolmasligi uchun fallback
      return res.status(200).json({
        success: false,
        message: 'Keshbek ro‘yxatga olinmadi, lekin sotuv yakunlandi',
        error_code: 'CASHBACK_CONNECTION_ERROR'
      });
    }
  });

  return router;
};