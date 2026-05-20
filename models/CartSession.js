const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const CartSessionSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), required: true, unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
 items: [{
    id:    { type: String, default: '' },
    name:  { type: String, default: '' },
    price: { type: Number, default: 0 },
    emoji: { type: String, default: '📦' },
  }],
  emojis: [{ type: String }],
  total: { type: Number, default: 0 },
  sent: { type: Boolean, default: false },
}, { timestamps: true });

CartSessionSchema.index({ id: 1 });
CartSessionSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model('CartSession', CartSessionSchema);