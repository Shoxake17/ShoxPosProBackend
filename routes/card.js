const express = require('express');
const router = express.Router();
const { saveCard, checkCard, updateBalance, checkCardsByOwner, blockCard, deleteCard } = require('../models/card');



router.post('/check-id', (req, res) => {
  const { id } = req.body;
  const card = checkCard(id);
  if (card) {
    res.json({ exists: true, data: card });
  } else {
    res.json({ exists: false });
  }
});
router.post('/bot-save-id', (req, res) => {
  const { id, token, ownerTelegramId } = req.body;

  if (token !== process.env.BOT_SECRET) {
    return res.status(403).json({ error: "Token noto‘g‘ri" });
  }

  const success = saveCard(id, ownerTelegramId);
  if (success) {
    console.log(`🟢 Telegram orqali karta qo‘shildi: ${id} (egasi: ${ownerTelegramId})`);
    res.json({ saved: true });
  } else {
    res.json({ saved: false, message: "Karta allaqachon mavjud" });
  }
});

router.post('/check-owner', (req, res) => {
  const { ownerTelegramId } = req.body;

  if (ownerTelegramId === "all") {
    const allCards = require('../models/card').readCards();
    return res.json({ exists: allCards.length > 0, data: allCards });
  }

  const cards = checkCardsByOwner(ownerTelegramId);
  res.json({
    exists: cards.length > 0,
    data: cards
  });
});






router.delete('/delete-card', (req, res) => {
  const { id, token } = req.body;

  if (token !== process.env.BOT_SECRET) {
    return res.status(403).json({ error: "❌ Token noto‘g‘ri" });
  }

  const success = deleteCard(id); // ✅ to‘g‘ri chaqiruv
  if (success) {
    res.json({ deleted: true, message: "Karta o‘chirildi" });
  } else {
    res.status(404).json({ deleted: false, message: "Karta topilmadi" });
  }
});






router.put('/update-balance', (req, res) => {
  const { id, balance, token } = req.body;

  // 🔐 Tokenni tekshiramiz
  if (token !== process.env.UPDATE_SECRET) {
    return res.status(403).json({ error: "❌ Ruxsat yo‘q: noto‘g‘ri token" });
  }

  if (!id || typeof balance !== 'number') {
    return res.status(400).json({ error: "ID va balans raqam bo‘lishi kerak" });
  }

  const updated = updateBalance(id, balance);
  if (updated) {
    res.json({ success: true, message: "Balans yangilandi", data: updated });
  } else {
    res.status(404).json({ success: false, message: "Karta topilmadi" });
  }
});


module.exports = router;
