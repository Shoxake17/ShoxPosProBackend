const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const cardFile = path.join(__dirname, "..", "card.json");

// 📌 Check card
router.post('/check-card', (req, res) => {
  const { id } = req.body;
  
  if (!id) {
    return res.status(400).json({ exists: false, message: 'Card ID kerak' });
  }

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      const raw = fs.readFileSync(cardFile, "utf-8");
      cards = JSON.parse(raw);
    } catch (err) {
      console.error('❌ Card faylni o\'qishda xato:', err);
      return res.status(500).json({ exists: false, message: 'Fayl xatosi' });
    }
  }

  const card = cards.find(c => c.id === id);
  if (card) {
    return res.json({ exists: true, data: card });
  }
  
  return res.json({ exists: false });
});

// 📌 Add cashback to card
router.put('/add-cashback', (req, res) => {
  const { id, amount } = req.body;
  
  if (!id || typeof amount !== "number") {
    return res.status(400).json({ 
      success: false, 
      message: 'ID va amount (raqam) kerak' 
    });
  }

  if (amount <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Amount musbat son bo\'lishi kerak' 
    });
  }

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      const raw = fs.readFileSync(cardFile, "utf-8");
      cards = JSON.parse(raw);
    } catch (err) {
      console.error('❌ Card faylni o\'qishda xato:', err);
      cards = [];
    }
  }

  let card = cards.find(c => c.id === id);
  
  if (!card) {
    // Yangi card yaratish
    card = { 
      id, 
      balance: 0, 
      createdAt: new Date().toISOString(),
      transactions: []
    };
    cards.push(card);
  }

  // Balansni yangilash
  card.balance = (card.balance || 0) + amount;
  
  // Tranzaksiya tarixini saqlash
  if (!card.transactions) card.transactions = [];
  card.transactions.push({
    amount,
    date: new Date().toISOString(),
    type: 'cashback'
  });

  try {
    fs.writeFileSync(cardFile, JSON.stringify(cards, null, 2), "utf-8");
    console.log(`✅ Card ${id} ga ${amount} cashback qo'shildi`);
    
    res.json({ 
      success: true, 
      balance: card.balance,
      message: 'Cashback muvaffaqiyatli qo\'shildi'
    });
  } catch (err) {
    console.error('❌ Faylga yozishda xato:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Faylga yozishda xatolik' 
    });
  }
});

// 📌 Get card balance
router.get('/card-balance/:id', (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Card ID kerak' });
  }

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      const raw = fs.readFileSync(cardFile, "utf-8");
      cards = JSON.parse(raw);
    } catch (err) {
      console.error('❌ Card faylni o\'qishda xato:', err);
      return res.status(500).json({ error: 'Fayl xatosi' });
    }
  }

  const card = cards.find(c => c.id === id);
  
  if (!card) {
    return res.status(404).json({ 
      error: 'Card topilmadi',
      balance: 0 
    });
  }

  res.json({ 
    id: card.id,
    balance: card.balance || 0,
    createdAt: card.createdAt,
    transactions: card.transactions || []
  });
});

// 📌 Use cashback (balance'dan ayirish)
router.post('/use-cashback', (req, res) => {
  const { id, amount } = req.body;

  if (!id || typeof amount !== "number") {
    return res.status(400).json({ 
      success: false, 
      message: 'ID va amount kerak' 
    });
  }

  if (amount <= 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Amount musbat son bo\'lishi kerak' 
    });
  }

  let cards = [];
  if (fs.existsSync(cardFile)) {
    try {
      const raw = fs.readFileSync(cardFile, "utf-8");
      cards = JSON.parse(raw);
    } catch (err) {
      console.error('❌ Card faylni o\'qishda xato:', err);
      return res.status(500).json({ success: false, message: 'Fayl xatosi' });
    }
  }

  const card = cards.find(c => c.id === id);

  if (!card) {
    return res.status(404).json({ 
      success: false, 
      message: 'Card topilmadi' 
    });
  }

  if (card.balance < amount) {
    return res.status(400).json({ 
      success: false, 
      message: 'Balansda yetarli mablag\' yo\'q',
      balance: card.balance 
    });
  }

  card.balance -= amount;

  if (!card.transactions) card.transactions = [];
  card.transactions.push({
    amount: -amount,
    date: new Date().toISOString(),
    type: 'usage'
  });

  try {
    fs.writeFileSync(cardFile, JSON.stringify(cards, null, 2), "utf-8");
    console.log(`✅ Card ${id} dan ${amount} ishlatildi`);
    
    res.json({ 
      success: true, 
      balance: card.balance,
      message: 'Cashback muvaffaqiyatli ishlatildi'
    });
  } catch (err) {
    console.error('❌ Faylga yozishda xato:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Faylga yozishda xatolik' 
    });
  }
});

module.exports = router;