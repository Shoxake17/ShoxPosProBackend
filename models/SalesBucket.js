const mongoose = require('mongoose');

const salesBucketSchema = new mongoose.Schema({
  login:       { type: String, required: true, index: true },
  periodStart: { type: Date,   required: true, index: true },
  periodEnd:   { type: Date,   required: true },
  data:        { type: Buffer, required: true }, // gzip qilingan JSON
}, { timestamps: true });

// 30 kundan keyin avtomatik o'chadi (TTL index)
salesBucketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

salesBucketSchema.index({ login: 1, periodStart: 1 }, { unique: true });

module.exports = mongoose.model('SalesBucket', salesBucketSchema, "salesbuckets");

