const mongoose = require('mongoose');

const shopTypeSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true }, 
  label: { type: String, required: true },              
  icon: { type: String, default: '🛒' },
  categories: [{ type: String }]                        
});

module.exports = mongoose.model('ShopType', shopTypeSchema);