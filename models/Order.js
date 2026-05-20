const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const OrderSchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  orderId: { type: String, unique: true },
  storeId: { type: String },
  status:  { type: String, default: 'pending' },
}, { timestamps: true });
module.exports = mongoose.model('Order', OrderSchema);