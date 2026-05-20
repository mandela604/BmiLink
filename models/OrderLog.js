// models/OrderLog.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const OrderLogSchema = new mongoose.Schema({
  id:           { type: String, default: () => uuidv4(), unique: true },
  storeId:      { type: String, required: true, ref: 'Store' },
  ownerId:      { type: String, required: true, ref: 'User' },
  productId:    { type: String, default: null, ref: 'Product' },
  productName:  { type: String, default: 'Unknown', trim: true, maxlength: 200 },
  productEmoji: { type: String, default: '📦', maxlength: 8 },
  qty:          { type: Number, default: 1, min: 1 },
  amount:       { type: Number, required: true, min: 0 },
  buyerWa:      { type: String, default: '', trim: true, maxlength: 20 },
  buyerName:    { type: String, default: '', trim: true, maxlength: 100 },
  note:         { type: String, default: '', trim: true, maxlength: 500 },
}, { timestamps: true, versionKey: false });

OrderLogSchema.index({ id: 1 });
OrderLogSchema.index({ storeId: 1, createdAt: -1 });
OrderLogSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('OrderLog', OrderLogSchema);