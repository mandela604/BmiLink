const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ActivitySchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), required: true, unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
  type: { type: String, enum: ['visit', 'order_tap', 'cart'], required: true },
  productId: { type: String, default: null },
  productName: { type: String, default: null },
  userAgent: { type: String, default: null },
  items: { type: Array, default: null },
  ipHash: { type: String, default: null },
}, { timestamps: true });

ActivitySchema.index({ id: 1 });
ActivitySchema.index({ storeId: 1, createdAt: -1 });
ActivitySchema.index({ storeId: 1, type: 1 });

module.exports = mongoose.model('Activity', ActivitySchema);