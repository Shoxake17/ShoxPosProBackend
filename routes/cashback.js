// cashback.js fayli (to'liq yangilangan versiya)
const express = require('express');
const router = express.Router();
const axios = require('axios');

// ✅ YANGI - faqat Telegram check uchun alohida endpoint
router.post('/telegram-check/:login', async (req, res) => {
    try {
        const { sales, totalAmount } = req.body;
        const login = req.params.login;

        console.log("=== TELEGRAM CHECK ===", { login, totalAmount, sales });

        if (!sales || !Array.isArray(sales) || sales.length === 0) {
            return res.status(400).json({ success: false, message: "Sales bo'sh" });
        }

        const shortId = Math.floor(1000 + Math.random() * 9000).toString();

        try {
            await axios.post('http://telegram_bot:5001/api/internal/register-sale', {
                shortId,
                totalAmount: totalAmount || 0,
                products: sales,
                secretKey: process.env.INTERNAL_SECRET || "Shoxrux_Secret_2026"
            }, { timeout: 5000 });
            console.log("✅ Bot backendga yuborildi, shortId:", shortId);
        } catch (botErr) {
            console.warn("⚠️ Bot o'chiq, lekin shortId berildi:", botErr.message);
        }

        return res.json({ success: true, shortId });

    } catch (error) {
        console.error("telegram-check xatosi:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;