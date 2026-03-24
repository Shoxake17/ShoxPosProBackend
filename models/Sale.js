const mongoose = require('mongoose');

const SaleSchema = new mongoose.Schema({
  login: { type: String, required: true, index: true },
  barcode: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true, default: 0 },
  total: { type: Number, required: true },
  category: { type: String, default: '' },
}, { 
  timestamps: true,
  // Collection nomi dinamik bo'lishi uchun shu o'chiriladi
});

// Compound index - tezroq qidiruv uchun
SaleSchema.index({ login: 1, soldAt: -1 });

// ✅ EXPORT: Schema va model yaratish funksiyasi
module.exports = {
  SaleSchema,
  
  // Login bo'yicha dinamik model yaratish
  getSaleModel: (login) => {
    const collectionName = `sales-${login}`; 
    const modelName = `Sale_${login}`;
    
    // Agar model allaqachon mavjud bo'lsa, uni qaytaradi
    if (mongoose.models[modelName]) {
      return mongoose.models[modelName];
    }
    
    // Yangi model yaratadi (3-parametr collection nomini belgilaydi)
    return mongoose.model(modelName, SaleSchema, collectionName);
  }
};