const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../data/cards.json');


// JSON faylni o'qish
function readCards() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
  }
  const raw = fs.readFileSync(filePath);
  return JSON.parse(raw);
}

// JSON faylga yozish
function writeCards(cards) {
  fs.writeFileSync(filePath, JSON.stringify(cards, null, 2));
}

// Karta ID saqlash
function saveCard(id, ownerTelegramId) {
    
  const cards = readCards();
  const exists = cards.find(card => card.id === id);
  
  if (exists) return false;

  const newCard = {
    id,
    createdAt: new Date().toISOString(),
    status: "active",
    balance: 0,
    ownerTelegramId // 🆕 egasining Telegram ID si
  };

  cards.push(newCard);
  writeCards(cards);
  return true;
}



function checkCard(id) {
  const cards = readCards();
  const card = cards.find(card => card.id === id);
  return card || null;
}



// Karta ID tekshirish
function checkCardsByOwner(ownerTelegramId) {
  const cards = readCards();
  return cards.filter(card => card.ownerTelegramId === ownerTelegramId);
}


function deleteCard(id) {
  const cards = readCards();
  const index = cards.findIndex(card => card.id === id);
  if (index === -1) return false;

  cards.splice(index, 1);
  writeCards(cards);
  return true;
}



function updateBalance(id, newBalance) {
  const cards = readCards();
  const index = cards.findIndex(card => card.id === id);
  if (index === -1) return null;

  cards[index].balance = newBalance;
  writeCards(cards);
  return cards[index];
}

module.exports = {
  saveCard,
  checkCard,
  checkCardsByOwner,
  updateBalance,
  deleteCard,
  readCards
};

